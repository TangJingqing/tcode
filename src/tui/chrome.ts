import path from 'node:path'
import process from 'node:process'
import type { RuntimeConfig } from '../config.js'
import type { SlashCommand } from '../cli-commands.js'
import type { PermissionRequest } from '../permissions.js'

const RESET = '\u001b[0m'
const DIM = '\u001b[2m'
const CYAN = '\u001b[36m'
const GREEN = '\u001b[32m'
const YELLOW = '\u001b[33m'
const RED = '\u001b[31m'
const BLUE = '\u001b[34m'
const BOLD = '\u001b[1m'
const REVERSE = '\u001b[7m'

function stripAnsi(input: string): string {
  return input.replace(/\u001b\[[0-9;]*m/g, '')
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

export function renderPermissionPrompt(request: PermissionRequest): string {
  return [
    `${YELLOW}${BOLD}Approval Required${RESET}`,
    `${BOLD}${request.summary}${RESET}`,
    ...request.details,
    '',
    ...request.choices.map(choice => `${BOLD}${choice.key}${RESET} ${choice.label}`),
  ].join('\n')
}
