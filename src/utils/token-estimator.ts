import type { ChatMessage } from '../types.js'
import { getModelContextWindow, type ModelContextWindow } from './model-context.js'

export type ContextStats = {
  estimatedTokens: number
  contextWindow: number
  effectiveInput: number
  utilization: number
  warningLevel: 'normal' | 'warning' | 'critical' | 'blocked'
}

// 英文为主的 chars/token 基准（拉丁字母、数字、符号为主）
const CHARS_PER_TOKEN_BASE: Record<string, number> = {
  system: 3.5,
  user: 3.0,
  assistant: 3.5,
  assistant_progress: 3.5,
  assistant_tool_call: 2.5,
  tool_result: 2.0,
  context_summary: 3.5,
}

// CJK 字符的 chars/token 基准（中/日/韩文字符在大多数 tokenizer 中 ≈ 1-2 字符/token）
const CJK_CHARS_PER_TOKEN = 1.5

const CLEAR_MARKER = '[Output cleared for context space]'

function isCJKChar(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||     // CJK Unified Ideographs
    (code >= 0x3400 && code <= 0x4dbf) ||     // CJK Extension A
    (code >= 0x20000 && code <= 0x2a6df) ||   // CJK Extension B
    (code >= 0xf900 && code <= 0xfaff) ||     // CJK Compatibility
    (code >= 0x2f800 && code <= 0x2fa1f) ||   // CJK Compatibility Supplement
    (code >= 0x3040 && code <= 0x309f) ||     // Hiragana
    (code >= 0x30a0 && code <= 0x30ff) ||     // Katakana
    (code >= 0xac00 && code <= 0xd7af)        // Hangul
  )
}

function countCJKChars(text: string): number {
  let count = 0
  for (const char of text) {
    const code = char.codePointAt(0)
    if (code !== undefined && isCJKChar(code)) {
      count++
    }
  }
  return count
}

function getMessageText(message: ChatMessage): string {
  switch (message.role) {
    case 'system':
    case 'user':
    case 'assistant':
    case 'assistant_progress':
    case 'tool_result':
    case 'context_summary':
      return message.content
    case 'assistant_tool_call':
      try {
        return JSON.stringify(message.input)
      } catch {
        return ''
      }
    default:
      return ''
  }
}

export function estimateMessageTokens(message: ChatMessage): number {
  const baseRatio = CHARS_PER_TOKEN_BASE[message.role] ?? 3.0
  const text = getMessageText(message)
  if (!text) return 0

  const cjkCount = countCJKChars(text)
  const totalChars = text.length

  if (cjkCount === 0 || totalChars === 0) {
    return Math.ceil(totalChars / baseRatio)
  }

  // 混合文本：CJK 用 1.5 chars/token，其余用对应角色的 baseRatio
  const nonCJKChars = totalChars - cjkCount
  return Math.ceil(cjkCount / CJK_CHARS_PER_TOKEN + nonCJKChars / baseRatio)
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  let total = 0
  for (const message of messages) {
    total += estimateMessageTokens(message)
  }
  return total
}

export function computeContextStats(
  messages: ChatMessage[],
  model: string,
): ContextStats {
  const window = getModelContextWindow(model)
  const estimatedTokens = estimateMessagesTokens(messages)
  const utilization = Math.min(1, estimatedTokens / window.effectiveInput)

  let warningLevel: ContextStats['warningLevel']
  if (utilization >= 0.95) {
    warningLevel = 'blocked'
  } else if (utilization >= 0.85) {
    warningLevel = 'critical'
  } else if (utilization >= 0.50) {
    warningLevel = 'warning'
  } else {
    warningLevel = 'normal'
  }

  return {
    estimatedTokens,
    contextWindow: window.contextWindow,
    effectiveInput: window.effectiveInput,
    utilization,
    warningLevel,
  }
}

export { CLEAR_MARKER }
