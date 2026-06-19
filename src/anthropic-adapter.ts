import type { ToolRegistry } from './tool.js'
import type { ChatMessage, ModelAdapter, ToolCall } from './types.js'
import type { RuntimeConfig } from './config.js'

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: AnthropicContentBlock[]
}

function toTextBlock(text: string): AnthropicContentBlock {
  return { type: 'text', text }
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

function toAnthropicMessages(messages: ChatMessage[]): {
  system: string
  messages: AnthropicMessage[]
} {
  const system = messages
    .filter(message => message.role === 'system')
    .map(message => message.content)
    .join('\n\n')

  const converted: AnthropicMessage[] = []

  for (const message of messages) {
    if (message.role === 'system') continue

    if (message.role === 'user') {
      pushAnthropicMessage(converted, 'user', toTextBlock(message.content))
      continue
    }

    if (message.role === 'assistant') {
      pushAnthropicMessage(converted, 'assistant', toTextBlock(message.content))
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

  async next(messages: ChatMessage[]) {
    const runtime = await this.getRuntimeConfig()
    const payload = toAnthropicMessages(messages)
    const url = `${runtime.baseUrl.replace(/\/$/, '')}/v1/messages`

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    }

    if (runtime.authToken) {
      headers.Authorization = `Bearer ${runtime.authToken}`
    } else if (runtime.apiKey) {
      headers['x-api-key'] = runtime.apiKey
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: runtime.model,
        max_tokens: 4096,
        system: payload.system,
        messages: payload.messages,
        tools: this.tools.list().map(tool => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        })),
      }),
    })

    const data = (await response.json()) as {
      error?: { message?: string }
      content?: Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: unknown }
      >
    }

    if (!response.ok) {
      throw new Error(data.error?.message || `Model request failed: ${response.status}`)
    }

    const toolCalls: ToolCall[] = []
    const textParts: string[] = []

    for (const block of data.content ?? []) {
      if (block.type === 'text') {
        textParts.push(block.text)
        continue
      }

      if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          toolName: block.name,
          input: block.input,
        })
      }
    }

    if (toolCalls.length > 0) {
      return {
        type: 'tool_calls' as const,
        calls: toolCalls,
        content: textParts.join('\n').trim() || undefined,
      }
    }

    return {
      type: 'assistant' as const,
      content: textParts.join('\n').trim() || '(empty response)',
    }
  }
}
