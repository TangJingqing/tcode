import process from 'node:process'
import { runAgentTurn } from './agent-loop.js'
import {
  SLASH_COMMANDS,
  findMatchingSlashCommands,
  tryHandleLocalCommand,
} from './cli-commands.js'
import { loadHistoryEntries, saveHistoryEntries } from './history.js'
import { parseLocalToolShortcut } from './local-tool-shortcuts.js'
import {
  PermissionDecision,
  PermissionManager,
  PermissionRequest,
  PermissionPromptResult,
} from './permissions.js'
import { buildSystemPrompt } from './prompt.js'
import { parseInputChunk, type ParsedInputEvent } from './tui/input-parser.js'
import {
  clearScreen,
  enterAlternateScreen,
  exitAlternateScreen,
  getPermissionPromptMaxScrollOffset,
  hideCursor,
  renderBanner,
  renderInputPrompt,
  renderPermissionPrompt,
  renderSlashMenu,
  renderStatusLine,
  renderToolPanel,
  renderTranscript,
  getTranscriptMaxScrollOffset,
  showCursor,
  type TranscriptEntry,
} from './ui.js'
import type { RuntimeConfig } from './config.js'
import type { ToolRegistry } from './tool.js'
import type { ChatMessage, ModelAdapter } from './types.js'

type TtyAppArgs = {
  runtime: RuntimeConfig | null
  tools: ToolRegistry
  model: ModelAdapter
  messages: ChatMessage[]
  cwd: string
  permissions: PermissionManager
}

type PendingApproval = {
  request: PermissionRequest
  resolve: (result: PermissionPromptResult) => void
  detailsExpanded: boolean
  detailsScrollOffset: number
  selectedChoiceIndex: number
  feedbackMode: boolean
  feedbackInput: string
}

type ScreenState = {
  input: string
  cursorOffset: number
  transcript: TranscriptEntry[]
  transcriptScrollOffset: number
  selectedSlashIndex: number
  status: string | null
  activeTool: string | null
  recentTools: Array<{ name: string; status: 'success' | 'error' }>
  history: string[]
  historyIndex: number
  historyDraft: string
  nextEntryId: number
  pendingApproval: PendingApproval | null
}

type TranscriptEntryDraft =
  | Omit<Extract<TranscriptEntry, { kind: 'user' }>, 'id'>
  | Omit<Extract<TranscriptEntry, { kind: 'assistant' }>, 'id'>
  | Omit<Extract<TranscriptEntry, { kind: 'progress' }>, 'id'>
  | Omit<Extract<TranscriptEntry, { kind: 'tool' }>, 'id'>

function getMaxTranscriptScrollOffset(state: ScreenState): number {
  return getTranscriptMaxScrollOffset(state.transcript)
}

function scrollTranscriptBy(
  state: ScreenState,
  delta: number,
): boolean {
  const nextOffset = Math.max(
    0,
    Math.min(
      getMaxTranscriptScrollOffset(state),
      state.transcriptScrollOffset + delta,
    ),
  )

  if (nextOffset === state.transcriptScrollOffset) {
    return false
  }

  state.transcriptScrollOffset = nextOffset
  return true
}

function jumpTranscriptToEdge(
  state: ScreenState,
  target: 'top' | 'bottom',
): boolean {
  const nextOffset = target === 'top' ? getMaxTranscriptScrollOffset(state) : 0
  if (nextOffset === state.transcriptScrollOffset) {
    return false
  }

  state.transcriptScrollOffset = nextOffset
  return true
}

function historyUp(state: ScreenState): boolean {
  if (state.history.length === 0 || state.historyIndex <= 0) {
    return false
  }

  if (state.historyIndex === state.history.length) {
    state.historyDraft = state.input
  }

  state.historyIndex -= 1
  state.input = state.history[state.historyIndex] ?? ''
  state.cursorOffset = state.input.length
  return true
}

function historyDown(state: ScreenState): boolean {
  if (state.historyIndex >= state.history.length) {
    return false
  }

  state.historyIndex += 1
  state.input =
    state.historyIndex === state.history.length
      ? state.historyDraft
      : (state.history[state.historyIndex] ?? '')
  state.cursorOffset = state.input.length
  return true
}

function getVisibleCommands(input: string) {
  if (!input.startsWith('/')) return []
  if (input === '/') return SLASH_COMMANDS
  const matches = findMatchingSlashCommands(input)
  return SLASH_COMMANDS.filter(command => matches.includes(command.usage))
}

function pushTranscriptEntry(
  state: ScreenState,
  entry: TranscriptEntryDraft,
): number {
  const id = state.nextEntryId++
  state.transcript.push({ id, ...entry })
  return id
}

function updateToolEntry(
  state: ScreenState,
  entryId: number,
  status: 'running' | 'success' | 'error',
  body: string,
): void {
  const entry = state.transcript.find(
    item => item.id === entryId && item.kind === 'tool',
  )

  if (!entry || entry.kind !== 'tool') {
    return
  }

  entry.status = status
  entry.body = body
  entry.collapsed = false
  entry.collapsedSummary = undefined
  entry.collapsePhase = undefined
}

function setToolEntryCollapsePhase(
  state: ScreenState,
  entryId: number,
  phase: 1 | 2 | 3,
): void {
  const entry = state.transcript.find(
    item => item.id === entryId && item.kind === 'tool',
  )
  if (!entry || entry.kind !== 'tool' || entry.status === 'running') {
    return
  }
  entry.collapsePhase = phase
}

function collapseToolEntry(
  state: ScreenState,
  entryId: number,
  summary: string,
): void {
  const entry = state.transcript.find(
    item => item.id === entryId && item.kind === 'tool',
  )
  if (!entry || entry.kind !== 'tool' || entry.status === 'running') {
    return
  }
  entry.collapsePhase = undefined
  entry.collapsed = true
  entry.collapsedSummary = summary
}

function summarizeCollapsedToolBody(output: string): string {
  const line = output
    .split('\n')
    .map(item => item.trim())
    .find(Boolean)
  if (!line) {
    return 'output collapsed'
  }
  if (line.length > 140) {
    return `${line.slice(0, 140)}...`
  }
  return line
}

function scheduleToolAutoCollapse(
  state: ScreenState,
  entryId: number,
  output: string,
  rerender: () => void,
): void {
  const summary = summarizeCollapsedToolBody(output)
  const frames: Array<1 | 2> = [1, 2]
  frames.forEach((phase, idx) => {
    setTimeout(() => {
      setToolEntryCollapsePhase(state, entryId, phase)
      rerender()
    }, 110 * (idx + 1))
  })
  setTimeout(() => {
    collapseToolEntry(state, entryId, summary)
    rerender()
  }, 320)
}

function truncateForDisplay(text: string, max = 180): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}...`
}

function summarizeToolInput(toolName: string, input: unknown): string {
  if (typeof input === 'string') {
    return truncateForDisplay(input.replace(/\s+/g, ' ').trim())
  }

  if (typeof input === 'object' && input !== null) {
    const maybePath = (input as { path?: unknown }).path
    const pathPart =
      typeof maybePath === 'string' && maybePath.trim()
        ? ` path=${maybePath}`
        : ''

    if (toolName === 'patch_file') {
      const count = Array.isArray((input as { replacements?: unknown }).replacements)
        ? (input as { replacements: unknown[] }).replacements.length
        : 0
      return `patch_file${pathPart} replacements=${count}`
    }

    if (toolName === 'edit_file') {
      return `edit_file${pathPart}`
    }

    if (toolName === 'read_file') {
      const offset = (input as { offset?: unknown }).offset
      const limit = (input as { limit?: unknown }).limit
      return `read_file${pathPart}${offset !== undefined ? ` offset=${String(offset)}` : ''}${limit !== undefined ? ` limit=${String(limit)}` : ''}`
    }

    if (toolName === 'run_command') {
      const command = (input as { command?: unknown }).command
      return `run_command${typeof command === 'string' ? ` ${truncateForDisplay(command, 120)}` : ''}`
    }
  }

  try {
    return truncateForDisplay(JSON.stringify(input))
  } catch {
    return truncateForDisplay(String(input))
  }
}

type AggregatedEditProgress = {
  entryId: number
  toolName: string
  path: string
  total: number
  completed: number
  errors: number
  lastOutput: string
}

function isFileEditTool(toolName: string): boolean {
  return (
    toolName === 'edit_file' ||
    toolName === 'patch_file' ||
    toolName === 'modify_file' ||
    toolName === 'write_file'
  )
}

function extractPathFromToolInput(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) {
    return null
  }
  if (!('path' in input)) {
    return null
  }
  const value = (input as { path?: unknown }).path
  return typeof value === 'string' && value.trim() ? value : null
}

function renderScreen(args: TtyAppArgs, state: ScreenState): void {
  clearScreen()
  console.log(
    renderBanner(args.runtime, args.cwd, args.permissions.getSummary()),
  )
  console.log('')

  if (state.transcript.length > 0) {
    console.log(renderTranscript(state.transcript, state.transcriptScrollOffset))
    console.log('')
  }

  console.log(renderInputPrompt(state.input, state.cursorOffset))

  const commands = getVisibleCommands(state.input)
  if (commands.length > 0) {
    console.log('')
    console.log(
      renderSlashMenu(
        commands,
        Math.min(state.selectedSlashIndex, commands.length - 1),
      ),
    )
  }

  if (state.pendingApproval) {
    console.log('')
    console.log(
      renderPermissionPrompt(state.pendingApproval.request, {
        expanded: state.pendingApproval.detailsExpanded,
        scrollOffset: state.pendingApproval.detailsScrollOffset,
        selectedChoiceIndex: state.pendingApproval.selectedChoiceIndex,
        feedbackMode: state.pendingApproval.feedbackMode,
        feedbackInput: state.pendingApproval.feedbackInput,
      }),
    )
  }

  console.log('')
  console.log(renderToolPanel(state.activeTool, state.recentTools))
  console.log('')
  console.log(renderStatusLine(state.status))
}

async function refreshSystemPrompt(args: TtyAppArgs): Promise<void> {
  args.messages[0] = {
    role: 'system',
    content: await buildSystemPrompt(args.cwd, args.permissions.getSummary()),
  }
}

async function executeToolShortcut(
  args: TtyAppArgs,
  state: ScreenState,
  toolName: string,
  input: unknown,
  rerender: () => void,
): Promise<void> {
  state.status = `Running ${toolName}...`
  state.activeTool = toolName
  const entryId = pushTranscriptEntry(state, {
    kind: 'tool',
    toolName,
    status: 'running',
    body: summarizeToolInput(toolName, input),
  })
  rerender()

  const result = await args.tools.execute(toolName, input, {
    cwd: args.cwd,
    permissions: args.permissions,
  })

  state.recentTools.push({
    name: toolName,
    status: result.ok ? 'success' : 'error',
  })
  updateToolEntry(
    state,
    entryId,
    result.ok ? 'success' : 'error',
    result.ok ? result.output : `ERROR: ${result.output}`,
  )
  collapseToolEntry(
    state,
    entryId,
    summarizeCollapsedToolBody(
      result.ok ? result.output : `ERROR: ${result.output}`,
    ),
  )
  state.activeTool = null
  state.status = null
  state.transcriptScrollOffset = 0
}

async function handleInput(
  args: TtyAppArgs,
  state: ScreenState,
  rerender: () => void,
): Promise<boolean> {
  const input = state.input.trim()
  if (!input) return false
  if (input === '/exit') return true

  if (state.history.at(-1) !== input) {
    state.history.push(input)
    await saveHistoryEntries(state.history)
  }
  state.historyIndex = state.history.length
  state.historyDraft = ''

  if (input === '/tools') {
    pushTranscriptEntry(state, {
      kind: 'assistant',
      body: args.tools
        .list()
        .map(tool => `${tool.name}: ${tool.description}`)
        .join('\n'),
    })
    return false
  }

  const localCommandResult = await tryHandleLocalCommand(input, { tools: args.tools })
  if (localCommandResult !== null) {
    pushTranscriptEntry(state, {
      kind: 'assistant',
      body: localCommandResult,
    })
    return false
  }

  const toolShortcut = parseLocalToolShortcut(input)
  if (toolShortcut) {
    await executeToolShortcut(
      args,
      state,
      toolShortcut.toolName,
      toolShortcut.input,
      rerender,
    )
    return false
  }

  if (input.startsWith('/')) {
    const matches = findMatchingSlashCommands(input)
    pushTranscriptEntry(state, {
      kind: 'assistant',
      body:
        matches.length > 0
          ? `未识别命令。你是不是想输入：\n${matches.join('\n')}`
          : '未识别命令。输入 /help 查看可用命令。',
    })
    return false
  }

  await refreshSystemPrompt(args)
  args.messages.push({ role: 'user', content: input })
  pushTranscriptEntry(state, {
    kind: 'user',
    body: input,
  })
  state.transcriptScrollOffset = 0
  state.status = 'Thinking...'
  rerender()

  const pendingToolEntries = new Map<string, number[]>()
  const aggregatedEditByEntryId = new Map<number, AggregatedEditProgress>()
  const aggregatedEditByKey = new Map<string, AggregatedEditProgress>()

  args.permissions.beginTurn()
  try {
    const nextMessages = await runAgentTurn({
      model: args.model,
      tools: args.tools,
      messages: args.messages,
      cwd: args.cwd,
      permissions: args.permissions,
      maxSteps: 8,
      onAssistantMessage(content) {
        pushTranscriptEntry(state, {
          kind: 'assistant',
          body: content,
        })
        state.transcriptScrollOffset = 0
        rerender()
      },
      onProgressMessage(content) {
        pushTranscriptEntry(state, {
          kind: 'progress',
          body: content,
        })
        state.transcriptScrollOffset = 0
        rerender()
      },
      onToolStart(toolName, toolInput) {
        state.status = `Running ${toolName}...`
        state.activeTool = toolName

        // 将同一文件上的重复编辑聚合为一条进度记录。
        const editPath = isFileEditTool(toolName)
          ? extractPathFromToolInput(toolInput)
          : null
        if (editPath) {
          const key = `${toolName}:${editPath}`
          const existing = aggregatedEditByKey.get(key)
          if (existing) {
            existing.total += 1
            const queue = pendingToolEntries.get(toolName) ?? []
            queue.push(existing.entryId)
            pendingToolEntries.set(toolName, queue)
            updateToolEntry(
              state,
              existing.entryId,
              'running',
              `Aggregated ${toolName} for ${existing.path}\nCompleted: ${existing.completed}/${existing.total}`,
            )
            state.transcriptScrollOffset = 0
            rerender()
            return
          }

          const entryId = pushTranscriptEntry(state, {
            kind: 'tool',
            toolName,
            status: 'running',
            body: summarizeToolInput(toolName, toolInput),
          })
          const aggregated: AggregatedEditProgress = {
            entryId,
            toolName,
            path: editPath,
            total: 1,
            completed: 0,
            errors: 0,
            lastOutput: '',
          }
          aggregatedEditByEntryId.set(entryId, aggregated)
          aggregatedEditByKey.set(key, aggregated)
          const queue = pendingToolEntries.get(toolName) ?? []
          queue.push(entryId)
          pendingToolEntries.set(toolName, queue)
          state.transcriptScrollOffset = 0
          rerender()
          return
        }

        const entryId = pushTranscriptEntry(state, {
          kind: 'tool',
          toolName,
          status: 'running',
          body: summarizeToolInput(toolName, toolInput),
        })
        const pending = pendingToolEntries.get(toolName) ?? []
        pending.push(entryId)
        pendingToolEntries.set(toolName, pending)
        state.transcriptScrollOffset = 0
        rerender()
      },
      onToolResult(toolName, output, isError) {
        const pending = pendingToolEntries.get(toolName) ?? []
        const entryId = pending.shift()
        pendingToolEntries.set(toolName, pending)

        if (entryId === undefined) {
          state.recentTools.push({
            name: toolName,
            status: isError ? 'error' : 'success',
          })
          state.activeTool = null
          state.status = 'Thinking...'
          rerender()
          return
        }

        const aggregated = aggregatedEditByEntryId.get(entryId)
        if (aggregated && aggregated.toolName === toolName) {
          aggregated.completed += 1
          if (isError) {
            aggregated.errors += 1
          }
          aggregated.lastOutput = output
          const done = aggregated.completed >= aggregated.total
          if (done) {
            state.recentTools.push({
              name: `${toolName} x${aggregated.total}`,
              status: aggregated.errors > 0 ? 'error' : 'success',
            })
          }
          const aggregatedBody = done
            ? [
                `Aggregated ${toolName} for ${aggregated.path}`,
                `Operations: ${aggregated.total}, errors: ${aggregated.errors}`,
                `Last result: ${aggregated.lastOutput}`,
              ].join('\n')
            : `Aggregated ${toolName} for ${aggregated.path}\nCompleted: ${aggregated.completed}/${aggregated.total}`
          updateToolEntry(
            state,
            entryId,
            aggregated.errors > 0 ? 'error' : done ? 'success' : 'running',
            aggregatedBody,
          )
          if (done) {
            scheduleToolAutoCollapse(state, entryId, aggregatedBody, rerender)
            aggregatedEditByEntryId.delete(entryId)
            aggregatedEditByKey.delete(`${toolName}:${aggregated.path}`)
          }
        } else {
          state.recentTools.push({
            name: toolName,
            status: isError ? 'error' : 'success',
          })
          const body = isError ? `ERROR: ${output}` : output
          updateToolEntry(
            state,
            entryId,
            isError ? 'error' : 'success',
            body,
          )
          scheduleToolAutoCollapse(state, entryId, body, rerender)
        }

        state.activeTool = null
        state.status = 'Thinking...'
        rerender()
      },
    })
    args.messages.length = 0
    args.messages.push(...nextMessages)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    args.messages.push({
      role: 'assistant',
      content: `请求失败: ${message}`,
    })
    pushTranscriptEntry(state, {
      kind: 'assistant',
      body: `请求失败: ${message}`,
    })
    state.transcriptScrollOffset = 0
  } finally {
    args.permissions.endTurn()
  }

  state.status = null
  return false
}

function createPermissionPromptHandler(
  state: ScreenState,
  rerender: () => void,
): (request: PermissionRequest) => Promise<PermissionPromptResult> {
  return request =>
    new Promise(resolve => {
      state.pendingApproval = {
        request,
        resolve,
        detailsExpanded: false,
        detailsScrollOffset: 0,
        selectedChoiceIndex: 0,
        feedbackMode: false,
        feedbackInput: '',
      }
      state.status = 'Waiting for approval...'
      rerender()
    })
}

export async function runTtyApp(args: TtyAppArgs): Promise<void> {
  enterAlternateScreen()
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
  }
  hideCursor()

  const state: ScreenState = {
    input: '',
    cursorOffset: 0,
    transcript: [],
    transcriptScrollOffset: 0,
    selectedSlashIndex: 0,
    status: null,
    activeTool: null,
    recentTools: [],
    history: await loadHistoryEntries(),
    historyIndex: 0,
    historyDraft: '',
    nextEntryId: 1,
    pendingApproval: null,
  }
  state.historyIndex = state.history.length

  const permissionArgs: TtyAppArgs = {
    ...args,
    permissions: new PermissionManager(
      args.cwd,
      createPermissionPromptHandler(state, () => renderScreen(permissionArgs, state)),
    ),
  }
  await permissionArgs.permissions.whenReady()
  await refreshSystemPrompt(permissionArgs)

  renderScreen(permissionArgs, state)

  await new Promise<void>(resolve => {
    let finished = false
    let inputRemainder = ''

    const cleanup = () => {
      process.stdin.off('data', onData)
      process.stdin.off('end', onEnd)
      process.stdin.off('close', onClose)
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false)
      }
      showCursor()
      exitAlternateScreen()
      process.stdin.pause()
      process.stdout.write('tcode exited.\n')
    }

    const finish = () => {
      if (finished) return
      finished = true
      cleanup()
      resolve()
    }

    const handleEvent = async (event: ParsedInputEvent) => {
      try {
        if (state.pendingApproval) {
          const pending = state.pendingApproval

          // 反馈子模式：采集自由文本并回传给模型。
          if (pending.feedbackMode) {
            if (event.kind === 'key' && event.name === 'escape') {
              pending.feedbackMode = false
              pending.feedbackInput = ''
              renderScreen(permissionArgs, state)
              return
            }

            if (event.kind === 'key' && event.name === 'return') {
              const feedback = pending.feedbackInput.trim()
              state.pendingApproval = null
              state.status = null
              pending.resolve({ decision: 'deny_with_feedback', feedback })
              renderScreen(permissionArgs, state)
              return
            }

            if (event.kind === 'key' && event.name === 'backspace') {
              if (pending.feedbackInput.length > 0) {
                pending.feedbackInput = pending.feedbackInput.slice(0, -1)
                renderScreen(permissionArgs, state)
              }
              return
            }

            if (event.kind === 'text' && !event.ctrl && !event.meta) {
              pending.feedbackInput += event.text
              renderScreen(permissionArgs, state)
            }

            return
          }

          // 控制组合键加字母键可切换完整差异视图（仅编辑请求可用）。
          if (event.kind === 'text' && event.ctrl && event.text === 'o') {
            if (pending.request.kind === 'edit') {
              pending.detailsExpanded = !pending.detailsExpanded
              pending.detailsScrollOffset = 0
              renderScreen(permissionArgs, state)
            }
            return
          }

          // 在展开的差异视图中使用滚轮、上翻页或下翻页进行滚动。
          if (pending.detailsExpanded) {
            const scrollBy = (delta: number): void => {
              const maxOffset = getPermissionPromptMaxScrollOffset(pending.request, {
                expanded: true,
              })
              const next = Math.max(
                0,
                Math.min(maxOffset, pending.detailsScrollOffset + delta),
              )
              if (next !== pending.detailsScrollOffset) {
                pending.detailsScrollOffset = next
                renderScreen(permissionArgs, state)
              }
            }

            if (event.kind === 'wheel') {
              scrollBy(event.direction === 'up' ? -3 : 3)
              return
            }
            if (event.kind === 'key' && event.name === 'pageup') {
              scrollBy(-8)
              return
            }
            if (event.kind === 'key' && event.name === 'pagedown') {
              scrollBy(8)
              return
            }
          }

          // 方向键导航：移动当前选中项。
          if (
            event.kind === 'key' &&
            (event.name === 'up' || event.name === 'down') &&
            !event.meta
          ) {
            const total = pending.request.choices.length
            if (total > 0) {
              const delta = event.name === 'up' ? -1 : 1
              pending.selectedChoiceIndex =
                (pending.selectedChoiceIndex + delta + total) % total
              renderScreen(permissionArgs, state)
            }
            return
          }

          // 处理所选项；若为反馈选项则切换到文本反馈子模式。
          const applyChoice = (decision: PermissionDecision): void => {
            if (decision === 'deny_with_feedback') {
              pending.feedbackMode = true
              pending.feedbackInput = ''
              renderScreen(permissionArgs, state)
              return
            }
            state.pendingApproval = null
            state.status = null
            pending.resolve({ decision })
            renderScreen(permissionArgs, state)
          }

          // 字母快捷键：无论当前选中项为何，都可直接选择对应选项。
          const keyChar = event.kind === 'text' && !event.ctrl && !event.meta ? event.text : ''
          const choice = pending.request.choices.find(item => item.key === keyChar)
          if (choice) {
            applyChoice(choice.decision)
            return
          }

          // 回车确认当前选中项。
          if (event.kind === 'key' && event.name === 'return') {
            const total = pending.request.choices.length
            const selected =
              total > 0
                ? pending.request.choices[
                    ((pending.selectedChoiceIndex % total) + total) % total
                  ]
                : undefined
            if (selected) {
              applyChoice(selected.decision)
            }
            return
          }

          // 退出键执行“仅拒绝一次”。
          if (event.kind === 'key' && event.name === 'escape') {
            state.pendingApproval = null
            state.status = null
            pending.resolve({ decision: 'deny_once' })
            renderScreen(permissionArgs, state)
            return
          }

          return
        }

        const visibleCommands = getVisibleCommands(state.input)

        if (event.kind === 'text' && event.ctrl && event.text === 'c') {
          finish()
          return
        }

        if (event.kind === 'wheel') {
          if (
            event.direction === 'up'
              ? scrollTranscriptBy(state, 3)
              : scrollTranscriptBy(state, -3)
          ) {
            renderScreen(permissionArgs, state)
          }
          return
        }

        if (event.kind === 'key' && event.name === 'return') {
          if (visibleCommands.length > 0) {
            const selected =
              visibleCommands[
                Math.min(state.selectedSlashIndex, visibleCommands.length - 1)
              ]
            if (selected && state.input.trim() !== selected.usage) {
              state.input = selected.usage
              state.cursorOffset = state.input.length
              state.selectedSlashIndex = 0
              renderScreen(permissionArgs, state)
              return
            }
          }

          const shouldExit = await handleInput(
            permissionArgs,
            state,
            () => renderScreen(permissionArgs, state),
          )
          state.input = ''
          state.cursorOffset = 0
          state.selectedSlashIndex = 0
          if (shouldExit) {
            finish()
            return
          }
          renderScreen(permissionArgs, state)
          return
        }

        if (event.kind === 'key' && event.name === 'backspace') {
          if (state.cursorOffset > 0) {
            state.input =
              state.input.slice(0, state.cursorOffset - 1) +
              state.input.slice(state.cursorOffset)
            state.cursorOffset -= 1
          }
          state.selectedSlashIndex = 0
          renderScreen(permissionArgs, state)
          return
        }

        if (event.kind === 'key' && event.name === 'delete') {
          state.input =
            state.input.slice(0, state.cursorOffset) +
            state.input.slice(state.cursorOffset + 1)
          state.selectedSlashIndex = 0
          renderScreen(permissionArgs, state)
          return
        }

        if (event.kind === 'key' && event.name === 'tab') {
          if (visibleCommands.length > 0) {
            const selected =
              visibleCommands[
                Math.min(state.selectedSlashIndex, visibleCommands.length - 1)
              ]
            if (selected) {
              state.input = selected.usage
              state.cursorOffset = state.input.length
              state.selectedSlashIndex = 0
              renderScreen(permissionArgs, state)
            }
          }
          return
        }

        if (event.kind === 'text' && event.ctrl && event.text === 'p') {
          if (historyUp(state)) {
            renderScreen(permissionArgs, state)
          }
          return
        }

        if (event.kind === 'text' && event.ctrl && event.text === 'n') {
          if (historyDown(state)) {
            renderScreen(permissionArgs, state)
          }
          return
        }

        if (event.kind === 'key' && event.name === 'up') {
          if (visibleCommands.length > 0) {
            state.selectedSlashIndex =
              (state.selectedSlashIndex - 1 + visibleCommands.length) %
              visibleCommands.length
            renderScreen(permissionArgs, state)
          } else if (event.meta) {
            if (scrollTranscriptBy(state, 1)) {
              renderScreen(permissionArgs, state)
            }
          } else if (historyUp(state)) {
            renderScreen(permissionArgs, state)
          }
          return
        }

        if (event.kind === 'key' && event.name === 'down') {
          if (visibleCommands.length > 0) {
            state.selectedSlashIndex =
              (state.selectedSlashIndex + 1) % visibleCommands.length
              renderScreen(permissionArgs, state)
          } else if (event.meta) {
            if (scrollTranscriptBy(state, -1)) {
              renderScreen(permissionArgs, state)
            }
          } else if (historyDown(state)) {
            renderScreen(permissionArgs, state)
          }
          return
        }

        if (event.kind === 'key' && event.name === 'pageup') {
          if (scrollTranscriptBy(state, 8)) {
            renderScreen(permissionArgs, state)
          }
          return
        }

        if (event.kind === 'key' && event.name === 'pagedown') {
          if (scrollTranscriptBy(state, -8)) {
            renderScreen(permissionArgs, state)
          }
          return
        }

        if (event.kind === 'key' && event.name === 'left') {
          state.cursorOffset = Math.max(0, state.cursorOffset - 1)
          renderScreen(permissionArgs, state)
          return
        }

        if (event.kind === 'key' && event.name === 'right') {
          state.cursorOffset = Math.min(state.input.length, state.cursorOffset + 1)
          renderScreen(permissionArgs, state)
          return
        }

        if (event.kind === 'text' && event.ctrl && event.text === 'u') {
          state.input = ''
          state.cursorOffset = 0
          state.selectedSlashIndex = 0
          renderScreen(permissionArgs, state)
          return
        }

        if (event.kind === 'text' && event.ctrl && event.text === 'a') {
          if (!state.input) {
            if (jumpTranscriptToEdge(state, 'top')) {
              renderScreen(permissionArgs, state)
            }
            return
          }

          state.cursorOffset = 0
          renderScreen(permissionArgs, state)
          return
        }

        if (event.kind === 'text' && event.ctrl && event.text === 'e') {
          if (!state.input) {
            if (jumpTranscriptToEdge(state, 'bottom')) {
              renderScreen(permissionArgs, state)
            }
            return
          }

          state.cursorOffset = state.input.length
          renderScreen(permissionArgs, state)
          return
        }

        if (event.kind === 'key' && event.name === 'escape') {
          state.input = ''
          state.cursorOffset = 0
          state.selectedSlashIndex = 0
          renderScreen(permissionArgs, state)
          return
        }

        if (event.kind === 'text' && !event.ctrl) {
          state.input =
            state.input.slice(0, state.cursorOffset) +
            event.text +
            state.input.slice(state.cursorOffset)
          state.cursorOffset += event.text.length
          state.selectedSlashIndex = 0
          state.historyIndex = state.history.length
          renderScreen(permissionArgs, state)
        }
      } catch (error) {
        pushTranscriptEntry(state, {
          kind: 'assistant',
          body: error instanceof Error ? error.message : String(error),
        })
        state.input = ''
        state.cursorOffset = 0
        state.selectedSlashIndex = 0
        state.status = null
        renderScreen(permissionArgs, state)
      }
    }

    const onData = (chunk: Buffer | string) => {
      const parsed = parseInputChunk(inputRemainder, chunk)
      inputRemainder = parsed.rest
      void (async () => {
        for (const event of parsed.events) {
          await handleEvent(event)
        }
      })()
    }

    const onEnd = () => finish()
    const onClose = () => finish()
    process.stdin.on('data', onData)
    process.stdin.once('end', onEnd)
    process.stdin.once('close', onClose)
  })
}
