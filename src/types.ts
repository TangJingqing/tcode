export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
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

export type ToolCall = {
  id: string
  toolName: string
  input: unknown
}

export type AgentStep =
  | {
      type: 'assistant'
      content: string
    }
  | {
      type: 'tool_calls'
      calls: ToolCall[]
      content?: string
    }

export interface ModelAdapter {
  next(messages: ChatMessage[]): Promise<AgentStep>
}
