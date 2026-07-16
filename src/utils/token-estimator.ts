import type { ChatMessage, ProviderUsage } from '../types.js'
import { getModelContextWindow } from './model-context.js'

export type TokenAccountingSource =
  | 'provider_usage'
  | 'provider_usage_plus_estimate'
  | 'estimate_only'

export type TokenAccountingResult = {
  totalTokens: number
  providerUsageTokens: number
  estimatedTokens: number
  source: TokenAccountingSource
  isExact: boolean
  usageBoundary?: {
    messageIndex: number
    messageId?: string
  }
  stale?: boolean
  reason?: string
}

export type ContextStats = {
  estimatedTokens: number
  totalTokens: number
  providerUsageTokens: number
  contextWindow: number
  effectiveInput: number
  utilization: number
  warningLevel: 'normal' | 'warning' | 'critical' | 'blocked'
  accounting: TokenAccountingResult
}

// 英文为主的 chars/token 基准（拉丁字母、数字、符号为主）
const CHARS_PER_TOKEN_BASE: Record<string, number> = {
  system: 3.5,
  user: 3.0,
  assistant_thinking: 3.0,
  assistant: 3.5,
  assistant_progress: 3.5,
  assistant_tool_call: 2.5,
  tool_result: 2.0,
  context_summary: 3.5,
  snip_boundary: 3.5,
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
    case 'snip_boundary':
      return message.content
    case 'assistant_thinking':
      try {
        return JSON.stringify(message.blocks)
      } catch {
        return ''
      }
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

function messageProviderUsage(message: ChatMessage): ProviderUsage | undefined {
  if (
    (message.role === 'assistant' ||
      message.role === 'assistant_progress' ||
      message.role === 'assistant_tool_call') &&
    message.providerUsage &&
    !message.usageStale
  ) {
    return message.providerUsage
  }
  return undefined
}

function staleUsageReason(messages: ChatMessage[]): string | undefined {
  for (const message of messages) {
    if (
      (message.role === 'assistant' ||
        message.role === 'assistant_progress' ||
        message.role === 'assistant_tool_call') &&
      message.providerUsage &&
      message.usageStale
    ) {
      return message.usageStaleReason ?? 'provider usage was marked stale'
    }
  }
  return undefined
}

function messageBoundaryId(message: ChatMessage): string | undefined {
  if (message.role === 'assistant_tool_call') return message.toolUseId
  return undefined
}

export function tokenCountWithEstimation(messages: ChatMessage[]): TokenAccountingResult {
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = messageProviderUsage(messages[i])
    if (!usage) continue

    const tailMessages = messages.slice(i + 1)
    const estimatedTokens = estimateMessagesTokens(tailMessages)
    return {
      totalTokens: usage.totalTokens + estimatedTokens,
      providerUsageTokens: usage.totalTokens,
      estimatedTokens,
      source: estimatedTokens > 0 ? 'provider_usage_plus_estimate' : 'provider_usage',
      isExact: estimatedTokens === 0,
      usageBoundary: {
        messageIndex: i,
        messageId: messageBoundaryId(messages[i]),
      },
    }
  }

  const reason = staleUsageReason(messages)
  const estimatedTokens = estimateMessagesTokens(messages)
  return {
    totalTokens: estimatedTokens,
    providerUsageTokens: 0,
    estimatedTokens,
    source: 'estimate_only',
    isExact: false,
    stale: Boolean(reason),
    reason: reason ?? 'no provider usage available',
  }
}

export function markProviderUsageStale(
  message: ChatMessage,
  reason: string,
): ChatMessage {
  if (
    (message.role === 'assistant' ||
      message.role === 'assistant_progress' ||
      message.role === 'assistant_tool_call') &&
    message.providerUsage
  ) {
    return {
      ...message,
      usageStale: true,
      usageStaleReason: reason,
    }
  }
  return message
}

export function computeContextStats(
  messages: ChatMessage[],
  model: string,
): ContextStats {
  const window = getModelContextWindow(model)
  const accounting = tokenCountWithEstimation(messages)
  const utilization = Math.min(1, accounting.totalTokens / window.effectiveInput)

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
    estimatedTokens: accounting.estimatedTokens,
    totalTokens: accounting.totalTokens,
    providerUsageTokens: accounting.providerUsageTokens,
    contextWindow: window.contextWindow,
    effectiveInput: window.effectiveInput,
    utilization,
    warningLevel,
    accounting,
  }
}

export { CLEAR_MARKER }
