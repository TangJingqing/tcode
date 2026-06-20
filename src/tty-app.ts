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
}

function summarizeToolInput(input: unknown): string {
  if (typeof input === 'string') {
    return input
  }

  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
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
        mode: state.pendingApproval.feedbackMode,
        input: state.pendingApproval.feedbackInput,
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
    body: summarizeToolInput(input),
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

  const localCommandResult = await tryHandleLocalCommand(input)
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
      onToolStart(toolName, toolInput) {
        state.status = `Running ${toolName}...`
        state.activeTool = toolName
        const entryId = pushTranscriptEntry(state, {
          kind: 'tool',
          toolName,
          status: 'running',
          body: summarizeToolInput(toolInput),
        })
        const pending = pendingToolEntries.get(toolName) ?? []
        pending.push(entryId)
        pendingToolEntries.set(toolName, pending)
        state.transcriptScrollOffset = 0
        rerender()
      },
      onToolResult(toolName, output, isError) {
        state.recentTools.push({
          name: toolName,
          status: isError ? 'error' : 'success',
        })
        const pending = pendingToolEntries.get(toolName) ?? []
        const entryId = pending.shift()
        pendingToolEntries.set(toolName, pending)
        if (entryId !== undefined) {
          updateToolEntry(
            state,
            entryId,
            isError ? 'error' : 'success',
            isError ? `ERROR: ${output}` : output,
          )
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

          // Feedback sub-mode: capture free text to hand back to the model.
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

          const keyChar = event.kind === 'text' && !event.ctrl && !event.meta ? event.text : ''
          const choice = pending.request.choices.find(item => item.key === keyChar)

          if (choice) {
            // Defer denials-with-feedback to the text capture sub-mode.
            if (choice.decision === 'deny_with_feedback') {
              pending.feedbackMode = true
              pending.feedbackInput = ''
              renderScreen(permissionArgs, state)
              return
            }

            state.pendingApproval = null
            state.status = null
            pending.resolve({ decision: choice.decision })
            renderScreen(permissionArgs, state)
            return
          }

          if (event.kind === 'key' && (event.name === 'escape' || event.name === 'return')) {
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
