const RESET = '\u001b[0m'
const DIM = '\u001b[2m'
const CYAN = '\u001b[36m'
const REVERSE = '\u001b[7m'

export function renderInputPrompt(input: string, cursorOffset: number): string {
  const offset = Math.max(0, Math.min(cursorOffset, input.length))
  const before = input.slice(0, offset)
  const current = input[offset] ?? ' '
  const after = input.slice(Math.min(offset + 1, input.length))
  return `${CYAN}>${RESET} ${before}${REVERSE}${current}${RESET}${after}${DIM}${input ? '' : ' ask tcode to inspect, edit, or run commands'}${RESET}`
}
