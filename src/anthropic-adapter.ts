import type { ToolRegistry } from './tool.js'
import type {
  ChatMessage,
  ModelAdapter,
  ProviderThinkingBlock,
  ProviderUsage,
  StepDiagnostics,
  ToolCall,
} from './types.js'
import type { RuntimeConfig } from './config.js'
import { resolveMaxOutputTokens } from './utils/context.js'

const DEFAULT_MAX_RETRIES = 4
const BASE_RETRY_DELAY_MS = 500
const MAX_RETRY_DELAY_MS = 8_000

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: string; [key: string]: unknown }

type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: AnthropicContentBlock[]
}

type AnthropicUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, Math.max(0, ms))
  })
}

function getRetryLimit(): number {
  const value = Number(process.env.TCODE_MAX_RETRIES)
  if (!Number.isFinite(value) || value < 0) {
    return DEFAULT_MAX_RETRIES
  }
  return Math.floor(value)
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600)
}

function parseRetryAfterMs(retryAfter: string | null): number | null {
  if (!retryAfter) return null
  const asSeconds = Number(retryAfter)
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.floor(asSeconds * 1000)
  }

  const at = Date.parse(retryAfter)
  if (!Number.isFinite(at)) {
    return null
  }
  return Math.max(0, at - Date.now())
}

function getRetryDelayMs(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null) {
    return retryAfterMs
  }
  const base = Math.min(
    BASE_RETRY_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1)),
    MAX_RETRY_DELAY_MS,
  )
  const jitter = Math.random() * 0.25 * base
  return Math.floor(base + jitter)
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) {
    return {}
  }
  try {
    return JSON.parse(text)
  } catch {
    return { error: { message: text.trim() } }
  }
}

function extractErrorMessage(data: unknown, status: number): string {
  if (typeof data === 'string' && data.trim()) {
    return data.trim()
  }

  if (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof data.error === 'object' &&
    data.error !== null &&
    'message' in data.error &&
    typeof data.error.message === 'string' &&
    data.error.message.trim()
  ) {
    return data.error.message.trim()
  }

  if (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof data.error === 'string' &&
    data.error.trim()
  ) {
    return data.error.trim()
  }

  if (
    typeof data === 'object' &&
    data !== null &&
    'message' in data &&
    typeof data.message === 'string' &&
    data.message.trim()
  ) {
    return data.message.trim()
  }

  return `Model request failed: ${status}`
}

function isTextBlock(block: AnthropicContentBlock): block is Extract<AnthropicContentBlock, {
  type: 'text'
}> {
  return block.type === 'text' && typeof block.text === 'string'
}

function isToolUseBlock(block: AnthropicContentBlock): block is Extract<AnthropicContentBlock, {
  type: 'tool_use'
}> {
  return (
    block.type === 'tool_use' &&
    typeof block.id === 'string' &&
    typeof block.name === 'string'
  )
}

function isThinkingBlock(block: AnthropicContentBlock): block is ProviderThinkingBlock {
  return block.type === 'thinking' || block.type === 'redacted_thinking'
}

// 解析助手文本头部的 <progress>/<final> 标记，区分“仍在进行”与“已完成”。
function parseAssistantText(content: string): {
  content: string
  kind?: 'final' | 'progress'
} {
  const trimmed = content.trim()
  if (!trimmed) {
    return { content: '' }
  }

  const markers: Array<{
    prefix: string
    kind: 'final' | 'progress'
  }> = [
    { prefix: '<final>', kind: 'final' },
    { prefix: '[FINAL]', kind: 'final' },
    { prefix: '<progress>', kind: 'progress' },
    { prefix: '[PROGRESS]', kind: 'progress' },
  ]

  for (const marker of markers) {
    if (trimmed.startsWith(marker.prefix)) {
      const rawContent = trimmed.slice(marker.prefix.length).trim()
      const closingTag =
        marker.kind === 'progress'
          ? /<\/progress>/gi
          : /<\/final>/gi
      return {
        content: rawContent.replace(closingTag, '').trim(),
        kind: marker.kind,
      }
    }
  }

  return { content: trimmed }
}

function toTextBlock(text: string): AnthropicContentBlock {
  return { type: 'text', text }
}

function normalizeAnthropicUsage(usage: AnthropicUsage | undefined): ProviderUsage | undefined {
  if (!usage) return undefined
  const inputTokens =
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  const outputTokens = usage.output_tokens ?? 0
  const totalTokens = inputTokens + outputTokens
  if (totalTokens <= 0) return undefined
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    source: 'anthropic',
  }
}

// 进度消息回传给模型时重新包裹 <progress>，让模型保持上下文。
function toAssistantText(message: Extract<ChatMessage, {
  role: 'assistant' | 'assistant_progress'
}>): string {
  if (message.role === 'assistant_progress') {
    return `<progress>\n${message.content}\n</progress>`
  }

  return message.content
}

function pushAnthropicMessage(
  messages: AnthropicMessage[],
  role: 'user' | 'assistant',
  block: AnthropicContentBlock,
): void {
  const last = messages.at(-1)
  if (last?.role === role) {
    last.content.push(block)
    return
  }

  messages.push({ role, content: [block] })
}

function isAssistantTextMessage(
  message: ChatMessage,
): message is Extract<ChatMessage, { role: 'assistant' | 'assistant_progress' }> {
  return message.role === 'assistant' || message.role === 'assistant_progress'
}

function normalizeLegacyThinkingToolRounds(messages: ChatMessage[]): ChatMessage[] {
  const normalized: ChatMessage[] = []

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    if (message.role !== 'assistant_thinking') {
      normalized.push(message)
      continue
    }

    let cursor = i + 1
    const textMessages: ChatMessage[] = []
    while (cursor < messages.length && isAssistantTextMessage(messages[cursor])) {
      textMessages.push(messages[cursor])
      cursor += 1
    }

    const toolCalls: ChatMessage[] = []
    const toolResults: ChatMessage[] = []
    while (cursor + 1 < messages.length) {
      const toolCall = messages[cursor]
      const toolResult = messages[cursor + 1]
      if (
        toolCall.role !== 'assistant_tool_call' ||
        toolResult.role !== 'tool_result' ||
        toolCall.toolUseId !== toolResult.toolUseId
      ) {
        break
      }
      toolCalls.push(toolCall)
      toolResults.push(toolResult)
      cursor += 2
    }

    if (toolCalls.length > 1) {
      normalized.push(message, ...textMessages, ...toolCalls, ...toolResults)
      i = cursor - 1
      continue
    }

    normalized.push(message)
  }

  return normalized
}

function toAnthropicMessages(messages: ChatMessage[]): {
  system: string
  messages: AnthropicMessage[]
} {
  const system = messages
    .filter(message => message.role === 'system')
    .map(message => message.content)
    .join('\n\n')

  const converted: AnthropicMessage[] = []
  const normalizedMessages = normalizeLegacyThinkingToolRounds(messages)

  for (const message of normalizedMessages) {
    if (message.role === 'system') continue

    if (message.role === 'user') {
      pushAnthropicMessage(converted, 'user', toTextBlock(message.content))
      continue
    }

    if (message.role === 'assistant_thinking') {
      for (const block of message.blocks) {
        pushAnthropicMessage(converted, 'assistant', block)
      }
      continue
    }

    if (message.role === 'assistant' || message.role === 'assistant_progress') {
      pushAnthropicMessage(
        converted,
        'assistant',
        toTextBlock(toAssistantText(message)),
      )
      continue
    }

    if (message.role === 'assistant_tool_call') {
      pushAnthropicMessage(converted, 'assistant', {
        type: 'tool_use',
        id: message.toolUseId,
        name: message.toolName,
        input: message.input,
      })
      continue
    }

    if (message.role === 'context_summary') {
      pushAnthropicMessage(converted, 'user', toTextBlock(
        `[Context Summary from earlier conversation]\n${message.content}`,
      ))
      continue
    }

    pushAnthropicMessage(converted, 'user', {
      type: 'tool_result',
      tool_use_id: message.toolUseId,
      content: message.content,
      is_error: message.isError,
    })
  }

  return { system, messages: converted }
}

export class AnthropicModelAdapter implements ModelAdapter {
  constructor(
    private readonly tools: ToolRegistry,
    private readonly getRuntimeConfig: () => Promise<RuntimeConfig>,
  ) {}

  async next(
    messages: ChatMessage[],
    context?: {
      tracer?: import('./tracing.js').AgentTracer
      stepIndex?: number
    },
  ) {
    const runtime = await this.getRuntimeConfig()
    const payload = toAnthropicMessages(messages)
    const url = `${runtime.baseUrl.replace(/\/$/, '')}/v1/messages`
    const maxOutputTokens = resolveMaxOutputTokens(
      runtime.model,
      runtime.maxOutputTokens,
    )

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    }

    if (runtime.authToken) {
      headers.Authorization = `Bearer ${runtime.authToken}`
    } else if (runtime.apiKey) {
      headers['x-api-key'] = runtime.apiKey
    }

    const requestBody = {
      model: runtime.model,
      max_tokens: maxOutputTokens,
      system: payload.system,
      messages: payload.messages,
      tools: this.tools.list().map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      })),
    }

    const startedAt = Date.now()
    await context?.tracer?.record(
      'model_input',
      {
        url,
        request: requestBody,
        headers,
      },
      context.stepIndex,
    )

    let response: Response | null = null
    let data: {
      error?: { message?: string }
      stop_reason?: string
      content?: AnthropicContentBlock[]
      usage?: AnthropicUsage
    } | null = null

    try {
      const maxRetries = getRetryLimit()
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
        })

        data = (await readJsonBody(response)) as {
          error?: { message?: string }
          stop_reason?: string
          content?: AnthropicContentBlock[]
          usage?: AnthropicUsage
        }

        if (response.ok) {
          break
        }

        if (!shouldRetryStatus(response.status) || attempt >= maxRetries) {
          break
        }

        const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'))
        await sleep(getRetryDelayMs(attempt + 1, retryAfterMs))
      }

      if (!response || !data) {
        throw new Error('Model request failed before receiving a response')
      }
    } catch (error) {
      await context?.tracer?.record(
        'error',
        {
          phase: 'model_request',
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        },
        context.stepIndex,
      )
      throw error
    }

    await context?.tracer?.record(
      'model_raw_response',
      {
        durationMs: Date.now() - startedAt,
        status: response.status,
        ok: response.ok,
        response: data,
      },
      context.stepIndex,
    )

    if (!response.ok) {
      throw new Error(extractErrorMessage(data, response.status))
    }

    const toolCalls: ToolCall[] = []
    const textParts: string[] = []
    const thinkingBlocks: ProviderThinkingBlock[] = []
    const blockTypes: string[] = []
    const ignoredBlockTypes = new Set<string>()

    for (const block of data.content ?? []) {
      blockTypes.push(block.type)

      if (isTextBlock(block)) {
        textParts.push(block.text)
        continue
      }

      if (isToolUseBlock(block)) {
        toolCalls.push({
          id: block.id,
          toolName: block.name,
          input: block.input,
        })
        continue
      }

      if (isThinkingBlock(block)) {
        thinkingBlocks.push(block)
        continue
      }

      ignoredBlockTypes.add(block.type)
    }

    const parsedText = parseAssistantText(textParts.join('\n').trim())
    const diagnostics: StepDiagnostics = {
      stopReason: data.stop_reason,
      blockTypes,
      ignoredBlockTypes: [...ignoredBlockTypes],
    }
    const usage = normalizeAnthropicUsage(data.usage)

    if (toolCalls.length > 0) {
      const result = {
        type: 'tool_calls' as const,
        calls: toolCalls,
        content: parsedText.content || undefined,
        contentKind:
          parsedText.kind === 'progress'
            ? ('progress' as const)
            : undefined,
        thinkingBlocks,
        diagnostics,
        usage,
      }
      await context?.tracer?.record('model_output', result, context.stepIndex)
      return result
    }

    const result = {
      type: 'assistant' as const,
      content: parsedText.content,
      kind: parsedText.kind,
      thinkingBlocks,
      diagnostics,
      usage,
    }
    await context?.tracer?.record('model_output', result, context.stepIndex)
    return result
  }
}
