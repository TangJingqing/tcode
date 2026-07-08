type ParsedKeyName =
  | 'return'
  | 'tab'
  | 'backspace'
  | 'delete'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'pageup'
  | 'pagedown'
  | 'home'
  | 'end'
  | 'escape'

type ParsedInputEvent =
  | {
      kind: 'key'
      name: ParsedKeyName
      ctrl: boolean
      meta: boolean
    }
  | {
      kind: 'text'
      text: string
      ctrl: boolean
      meta: boolean
    }
  | {
      kind: 'wheel'
      direction: 'up' | 'down'
    }

function isMultilinePasteChunk(input: string): boolean {
  return /[\r\n]/.test(input) && /[^\r\n]/.test(input)
}

type ParseResult = {
  events: ParsedInputEvent[]
  rest: string
}

const ESC = ''
const CTRL_CHAR_TO_NAME: Record<string, string> = {
  '': 'a',
  '': 'c',
  '': 'e',
  '': 'n',
  '': 'o',
  '': 'p',
  '': 'u',
}

function maybeNeedMoreForEscapeSequence(input: string): boolean {
  if (!input.startsWith(ESC)) return false

  if (input === ESC) return true
  // Wait only for known-incomplete CSI prefixes.
  // If an unexpected character appears (for example "[\r"), do not
  // block the parser forever; let parseEscapeSequence fall back.
  if (input === '[') return true
  if (/^\[[<\d;?]*$/.test(input)) {
    return true
  }
  if (input.startsWith('O') && input.length < 3) {
    return true
  }

  return false
}

function parseEscapeSequence(input: string): {
  event: ParsedInputEvent | null
  length: number
} | null {
  let match = /^\[<(\d+);(\d+);(\d+)([Mm])/.exec(input)
  if (match) {
    const button = Number(match[1])
    const length = match[0].length
    if ((button & 0x43) === 0x40) {
      return { event: { kind: 'wheel', direction: 'up' }, length }
    }
    if ((button & 0x43) === 0x41) {
      return { event: { kind: 'wheel', direction: 'down' }, length }
    }
    return { event: null, length }
  }

  if (/^\[M.../.test(input)) {
    const seq = input.slice(0, 6)
    const button = seq.charCodeAt(3) - 32
    if ((button & 0x43) === 0x40) {
      return { event: { kind: 'wheel', direction: 'up' }, length: 6 }
    }
    if ((button & 0x43) === 0x41) {
      return { event: { kind: 'wheel', direction: 'down' }, length: 6 }
    }
    return { event: null, length: 6 }
  }

  match = /^\[(?:1;(\d+))?([ABCDHF])/.exec(input)
  if (match) {
    const modifier = Number(match[1] ?? '1')
    const meta = modifier === 3
    const ctrl = modifier === 5
    const nameMap: Record<string, ParsedKeyName> = {
      A: 'up',
      B: 'down',
      C: 'right',
      D: 'left',
      H: 'home',
      F: 'end',
    }
    return {
      event: {
        kind: 'key',
        name: nameMap[match[2]],
        ctrl,
        meta,
      },
      length: match[0].length,
    }
  }

  match = /^\[(\d+)~/.exec(input)
  if (match) {
    const nameMap: Record<string, ParsedKeyName> = {
      '1': 'home',
      '3': 'delete',
      '4': 'end',
      '5': 'pageup',
      '6': 'pagedown',
      '7': 'home',
      '8': 'end',
    }
    const name = nameMap[match[1]]
    if (!name) return { event: null, length: match[0].length }
    return {
      event: { kind: 'key', name, ctrl: false, meta: false },
      length: match[0].length,
    }
  }

  match = /^O([ABCDHF])/.exec(input)
  if (match) {
    const nameMap: Record<string, ParsedKeyName> = {
      A: 'up',
      B: 'down',
      C: 'right',
      D: 'left',
      H: 'home',
      F: 'end',
    }
    return {
      event: {
        kind: 'key',
        name: nameMap[match[1]],
        ctrl: false,
        meta: false,
      },
      length: match[0].length,
    }
  }

  if (input.startsWith('\t')) {
    return {
      event: { kind: 'key', name: 'tab', ctrl: false, meta: true },
      length: 2,
    }
  }

  if (input.length >= 2) {
    const char = input[1]
    if (char !== '[' && char !== 'O') {
      return {
        event: { kind: 'text', text: char, ctrl: false, meta: true },
        length: 2,
      }
    }
  }

  return {
    event: { kind: 'key', name: 'escape', ctrl: false, meta: false },
    length: 1,
  }
}

export function parseInputChunk(
  previousRest: string,
  chunk: Buffer | string,
): ParseResult {
  const chunkText = String(chunk)
  const input = previousRest + chunkText
  const treatNewlinesAsText = isMultilinePasteChunk(chunkText)
  const events: ParsedInputEvent[] = []
  let index = 0

  while (index < input.length) {
    const remaining = input.slice(index)

    if (/^\[<\d+;\d+;\d+[Mm]/.test(remaining)) {
      index += remaining.match(/^\[<\d+;\d+;\d+[Mm]/)?.[0].length ?? 1
      continue
    }

    if (remaining[0] === ESC) {
      if (maybeNeedMoreForEscapeSequence(remaining)) {
        return { events, rest: remaining }
      }

      const parsed = parseEscapeSequence(remaining)
      if (parsed) {
        if (parsed.event) events.push(parsed.event)
        index += parsed.length
        continue
      }
    }

    const char = remaining[0]
    if (!char) break

    if (char === '\r' || char === '\n') {
      if (treatNewlinesAsText) {
        events.push({ kind: 'text', text: '\n', ctrl: false, meta: false })
      } else {
        events.push({ kind: 'key', name: 'return', ctrl: false, meta: false })
      }
      if (
        (char === '\r' && remaining[1] === '\n') ||
        (char === '\n' && remaining[1] === '\r')
      ) {
        index += 2
      } else {
        index += 1
      }
      continue
    }

    if (char === '\t') {
      events.push({ kind: 'key', name: 'tab', ctrl: false, meta: false })
      index += 1
      continue
    }

    if (char === '' || char === '\b') {
      events.push({ kind: 'key', name: 'backspace', ctrl: false, meta: false })
      index += 1
      continue
    }

    if (char >= '' && char <= '') {
      const name = CTRL_CHAR_TO_NAME[char]
      if (name) {
        events.push({ kind: 'text', text: name, ctrl: true, meta: false })
      }
      index += 1
      continue
    }

    if (char < ' ') {
      index += 1
      continue
    }

    events.push({ kind: 'text', text: char, ctrl: false, meta: false })
    index += 1
  }

  return { events, rest: '' }
}

export type { ParsedInputEvent }
