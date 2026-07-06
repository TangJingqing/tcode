import type { AgentTracer } from './tracing.js'

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'assistant_progress'; content: string }
  | {
      role: 'assistant_tool_call'
      toolUseId: string
      toolName: string
      input: unknown
    }
  | {
      role: 'tool_result'
      toolUseId: string
      toolName: string
      content: string
      isError: boolean
    }
  | {
      role: 'context_summary'
      content: string
      compressedCount: number
      timestamp: number
    }

export type ToolCall = {
  id: string
  toolName: string
  input: unknown
}

export type StepDiagnostics = {
  stopReason?: string
  blockTypes?: string[]
  ignoredBlockTypes?: string[]
}

export type AgentStep =
  | {
      type: 'assistant'
      content: string
      kind?: 'final' | 'progress'
      diagnostics?: StepDiagnostics
    }
  | {
      type: 'tool_calls'
      calls: ToolCall[]
      content?: string
      contentKind?: 'progress'
      diagnostics?: StepDiagnostics
    }

export interface ModelAdapter {
  next(
    messages: ChatMessage[],
    context?: {
      tracer?: AgentTracer
      stepIndex?: number
    },
  ): Promise<AgentStep>
}

export type CompressionResult = {
  messages: ChatMessage[]
  summary: Extract<ChatMessage, { role: 'context_summary' }>
  removedCount: number
  tokensBefore: number
  tokensAfter: number
}
