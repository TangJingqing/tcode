import path from 'node:path'
import process from 'node:process'
import type { RuntimeConfig } from '../config.js'
import type { SlashCommand } from '../cli-commands.js'
import type { PermissionRequest } from '../permissions.js'

const RESET = '[0m'
const DIM = '[2m'
const CYAN = '[36m'
const GREEN = '[32m'
const YELLOW = '[33m'
const RED = '[31m'
const BLUE = '[34m'
const BOLD = '[1m'
const REVERSE = '[7m'
const BRIGHT_GREEN = '[92m'
const BRIGHT_RED = '[91m'

function stripAnsi(input: string): string {
  return input.replace(/\[[0-9;]*m/g, '')
}

function truncatePlain(input: string, width: number): string {
  if (width <= 0) return ''
  if (input.length <= width) return input
  if (width <= 3) return input.slice(0, width)
  return `${input.slice(0, width - 3)}...`
}

function padPlain(input: string, width: number): string {
  const visible = stripAnsi(input).length
  return visible >= width ? input : `${input}${' '.repeat(width - visible)}`
}

function truncatePathMiddle(input: string, width: number): string {
  if (width <= 0 || input.length <= width) return input
  if (width <= 5) return truncatePlain(input, width)

  const keep = width - 3
  const left = Math.ceil(keep / 2)
  const right = Math.floor(keep / 2)
  return `${input.slice(0, left)}...${input.slice(input.length - right)}`
}

export function renderBanner(
  runtime: RuntimeConfig | null,
  cwd: string,
  permissionSummary: string[],
): string {
  const columns = Math.max(60, process.stdout.columns ?? 100)
  const cwdName = path.basename(cwd) || cwd
  const model = runtime?.model ?? 'not-configured'
  const left = `${BOLD}Tcode${RESET} ${DIM}coding agent${RESET}`
  const right = `${DIM}${truncatePlain(model, Math.max(14, Math.floor(columns * 0.26)))}${RESET}`
  const gap = Math.max(2, columns - stripAnsi(left).length - stripAnsi(right).length)
  const topLine = `${left}${' '.repeat(gap)}${right}`
  const projectLine = `${BLUE}${BOLD}${truncatePlain(cwdName, 24)}${RESET} ${DIM}${truncatePathMiddle(
    cwd,
    Math.max(24, columns - cwdName.length - 6),
  )}${RESET}`

  const permissionLine =
    permissionSummary.length > 0
      ? `${DIM}${truncatePlain(permissionSummary.join(' | '), columns)}${RESET}`
      : `${DIM}permissions: ask on sensitive actions${RESET}`

  return [
    `${CYAN}${'='.repeat(columns)}${RESET}`,
    topLine,
    `${GREEN}cwd${RESET} ${projectLine}`,
    `${YELLOW}tips${RESET} ${DIM}/ opens commands | Up/Down history | Alt+Up/Down or PgUp/PgDn scroll${RESET}`,
    permissionLine,
    `${CYAN}${'-'.repeat(columns)}${RESET}`,
  ].join('\n')
}

export function renderStatusLine(status: string | null): string {
  if (!status) return `${DIM}idle${RESET}`
  return `${YELLOW}status${RESET} ${status}`
}

export function renderToolPanel(
  activeTool: string | null,
  recentTools: Array<{ name: string; status: 'success' | 'error' }>,
): string {
  const items: string[] = []

  if (activeTool) {
    items.push(`${YELLOW}running:${RESET} ${activeTool}`)
  }

  if (recentTools.length === 0) {
    items.push(`${DIM}recent: none${RESET}`)
    return `${DIM}tools${RESET}  ${items.join('  ')}`
  }

  for (const tool of recentTools.slice(-5).reverse()) {
    const status = tool.status === 'success' ? `${GREEN}ok${RESET}` : `${RED}err${RESET}`
    items.push(`${status} ${tool.name}`)
  }

  return `${DIM}tools${RESET}  ${items.join('  ')}`
}

export function renderSlashMenu(
  commands: SlashCommand[],
  selectedIndex: number,
): string {
  if (commands.length === 0) {
    return `${DIM}no matching slash commands${RESET}`
  }

  return [
    `${DIM}commands${RESET}`,
    ...commands.map((command, index) => {
      const usage = padPlain(command.usage, 24)
      const prefix =
        index === selectedIndex
          ? `${REVERSE} ${usage} ${RESET}`
          : ` ${usage} `
      return `${prefix} ${DIM}${truncatePlain(command.description, 60)}${RESET}`
    }),
  ].join('\n')
}

type PermissionPromptRenderOptions = {
  expanded?: boolean
  scrollOffset?: number
  feedbackMode?: boolean
  feedbackInput?: string
}

function flattenDetailLines(details: string[]): string[] {
  const lines: string[] = []
  details.forEach((detail, index) => {
    if (index > 0) {
      lines.push('')
    }
    lines.push(...detail.split('\n'))
  })
  return lines
}

function sliceVisibleDetails(
  detailLines: string[],
  expanded: boolean,
  scrollOffset: number,
): { lines: string[]; maxScroll: number; hiddenCount: number } {
  if (!expanded) {
    const collapsedLimit = 16
    if (detailLines.length <= collapsedLimit) {
      return { lines: detailLines, maxScroll: 0, hiddenCount: 0 }
    }
    return {
      lines: detailLines.slice(0, collapsedLimit),
      maxScroll: 0,
      hiddenCount: detailLines.length - collapsedLimit,
    }
  }

  const rows = process.stdout.rows ?? 40
  const expandedWindow = Math.max(8, rows - 20)
  const maxScroll = Math.max(0, detailLines.length - expandedWindow)
  const offset = Math.max(0, Math.min(scrollOffset, maxScroll))
  const start = offset
  const end = Math.min(detailLines.length, start + expandedWindow)
  return {
    lines: detailLines.slice(start, end),
    maxScroll,
    hiddenCount: 0,
  }
}

export function getPermissionPromptMaxScrollOffset(
  request: PermissionRequest,
  options: PermissionPromptRenderOptions = {},
): number {
  const details =
    request.kind === 'edit'
      ? colorizeEditPermissionDetails(request.details)
      : request.details
  const detailLines = flattenDetailLines(details)
  const expanded = options.expanded ?? false
  if (!expanded) {
    return 0
  }
  const rows = process.stdout.rows ?? 40
  const expandedWindow = Math.max(8, rows - 20)
  return Math.max(0, detailLines.length - expandedWindow)
}

export function renderPermissionPrompt(
  request: PermissionRequest,
  options: PermissionPromptRenderOptions = {},
): string {
  const details =
    request.kind === 'edit'
      ? colorizeEditPermissionDetails(request.details)
      : request.details
  const expanded = options.expanded ?? false
  const scrollOffset = options.scrollOffset ?? 0
  const feedbackMode = options.feedbackMode ?? false
  const feedbackInput = options.feedbackInput ?? ''
  const detailLines = flattenDetailLines(details)
  const {
    lines: visibleDetailLines,
    maxScroll,
    hiddenCount,
  } = sliceVisibleDetails(detailLines, expanded, scrollOffset)

  const promptLines = [
    `${YELLOW}${BOLD}Approval Required${RESET}`,
    `${BOLD}${request.summary}${RESET}`,
    ...visibleDetailLines,
  ]

  if (request.kind === 'edit') {
    if (!expanded && hiddenCount > 0) {
      promptLines.push(
        `${DIM}... ${hiddenCount} more line(s) hidden${RESET}`,
        `${DIM}Ctrl+O expand full diff${RESET}`,
      )
    } else if (expanded) {
      promptLines.push(
        `${DIM}Ctrl+O collapse | Wheel/PgUp/PgDn scroll (${Math.max(
          0,
          Math.min(scrollOffset, maxScroll),
        )}/${maxScroll})${RESET}`,
      )
    }
  }

  promptLines.push('')

  if (feedbackMode) {
    promptLines.push(
      `${BOLD}Guidance for the model${RESET} ${DIM}(Enter to send, Esc to cancel)${RESET}`,
      `${CYAN}> ${RESET}${feedbackInput}`,
    )
    return promptLines.join('\n')
  }

  // Single-letter hotkey style (tcode convention), not arrow-key navigation.
  promptLines.push(
    ...request.choices.map(choice => `${BOLD}${choice.key}${RESET} ${choice.label}`),
  )
  return promptLines.join('\n')
}

type DiffLineKind = 'meta' | 'add' | 'remove' | 'context'

type StyledDiffLine = {
  raw: string
  kind: DiffLineKind
  emphasisRange?: { start: number; end: number }
}

function isUnifiedDiffHeader(line: string): boolean {
  return (
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line.startsWith('@@ ')
  )
}

function classifyDiffLine(line: string): DiffLineKind {
  if (isUnifiedDiffHeader(line)) {
    return 'meta'
  }

  if (line.startsWith('+')) {
    return 'add'
  }

  if (line.startsWith('-')) {
    return 'remove'
  }

  return 'context'
}

function computeChangedRange(
  removedText: string,
  addedText: string,
): { remove: { start: number; end: number }; add: { start: number; end: number } } | null {
  if (!removedText || !addedText) {
    return null
  }

  let prefix = 0
  const maxPrefix = Math.min(removedText.length, addedText.length)
  while (
    prefix < maxPrefix &&
    removedText[prefix] === addedText[prefix]
  ) {
    prefix += 1
  }

  let removedSuffix = removedText.length - 1
  let addedSuffix = addedText.length - 1
  while (
    removedSuffix >= prefix &&
    addedSuffix >= prefix &&
    removedText[removedSuffix] === addedText[addedSuffix]
  ) {
    removedSuffix -= 1
    addedSuffix -= 1
  }

  const removeRange = { start: prefix, end: removedSuffix + 1 }
  const addRange = { start: prefix, end: addedSuffix + 1 }
  if (removeRange.start >= removeRange.end || addRange.start >= addRange.end) {
    return null
  }

  return {
    remove: removeRange,
    add: addRange,
  }
}

function applyWordEmphasis(
  content: string,
  color: string,
  emphasisRange?: { start: number; end: number },
): string {
  if (!emphasisRange) {
    return `${color}${content}${RESET}`
  }

  const start = Math.max(0, Math.min(content.length, emphasisRange.start))
  const end = Math.max(start, Math.min(content.length, emphasisRange.end))
  if (start === end) {
    return `${color}${content}${RESET}`
  }

  const before = content.slice(0, start)
  const changed = content.slice(start, end)
  const after = content.slice(end)
  return [
    `${color}${before}`,
    `${BOLD}${changed}${RESET}`,
    `${color}${after}${RESET}`,
  ].join('')
}

function renderStyledDiffLine(line: StyledDiffLine): string {
  if (line.raw.trim() === '') {
    return line.raw
  }

  if (line.kind === 'meta') {
    return `${CYAN}${BOLD}${line.raw}${RESET}`
  }

  if (line.kind === 'add' || line.kind === 'remove') {
    const sign = line.raw.slice(0, 1)
    const content = line.raw.slice(1)
    const color = line.kind === 'add' ? BRIGHT_GREEN : BRIGHT_RED
    const emphasized = applyWordEmphasis(content, color, line.emphasisRange)
    return `${color}${sign}${RESET}${emphasized}`
  }

  return `${DIM}${line.raw}${RESET}`
}

function colorizeUnifiedDiffBlock(block: string): string {
  const lines = block.split('\n')
  const styled: StyledDiffLine[] = lines.map(raw => ({
    raw,
    kind: classifyDiffLine(raw),
  }))

  // Pair adjacent removed/added lines and emphasize changed word spans.
  for (let i = 0; i < styled.length; i += 1) {
    if (styled[i]?.kind !== 'remove') {
      continue
    }

    let removeEnd = i
    while (removeEnd < styled.length && styled[removeEnd]?.kind === 'remove') {
      removeEnd += 1
    }

    let addEnd = removeEnd
    while (addEnd < styled.length && styled[addEnd]?.kind === 'add') {
      addEnd += 1
    }

    const removeCount = removeEnd - i
    const addCount = addEnd - removeEnd
    const pairCount = Math.min(removeCount, addCount)
    for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
      const removeLine = styled[i + pairIndex]
      const addLine = styled[removeEnd + pairIndex]
      if (!removeLine || !addLine) {
        continue
      }

      const removedText = removeLine.raw.slice(1)
      const addedText = addLine.raw.slice(1)
      const ranges = computeChangedRange(removedText, addedText)
      if (!ranges) {
        continue
      }

      removeLine.emphasisRange = ranges.remove
      addLine.emphasisRange = ranges.add
    }

    i = addEnd - 1
  }

  return styled.map(renderStyledDiffLine).join('\n')
}

function looksLikeDiffBlock(detail: string): boolean {
  return (
    detail.includes('\n') &&
    (detail.includes('--- a/') ||
      detail.includes('+++ b/') ||
      detail.includes('@@ '))
  )
}

function colorizeEditPermissionDetails(details: string[]): string[] {
  return details.map(detail => {
    if (looksLikeDiffBlock(detail)) {
      return colorizeUnifiedDiffBlock(detail)
    }
    return detail
  })
}
