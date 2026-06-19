import type { ToolRegistry } from './tool.js'
import type { ChatMessage, ModelAdapter } from './types.js'
import type { PermissionManager } from './permissions.js'

function isUserTextMessage(
  message: ChatMessage,
): message is Extract<ChatMessage, { role: 'user' }> {
  return message.role === 'user'
}

function userRequestedAction(messages: ChatMessage[]): boolean {
  const lastUser = [...messages]
    .reverse()
    .find(
      (message): message is Extract<ChatMessage, { role: 'user' }> =>
        isUserTextMessage(message) &&
        !message.content.startsWith('Continue immediately with tool use.'),
    )

  if (!lastUser) return false

  const text = lastUser.content.trim().toLowerCase()
  if (!text) return false

  const actionHints = [
    '改',
    '修改',
    '优化',
    '生成',
    '创建',
    '实现',
    '完善',
    '修复',
    '做一个',
    '写一个',
    'build',
    'create',
    'edit',
    'update',
    'modify',
    'fix',
    'implement',
    'improve',
    'optimize',
    'generate',
  ]

  return actionHints.some(hint => text.includes(hint))
}

function looksLikeClarifyingQuestion(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return false

  const lower = trimmed.toLowerCase()
  const asksDirectQuestion =
    trimmed.endsWith('?') ||
    trimmed.endsWith('？') ||
    lower.includes('would you like') ||
    lower.includes('what would you like') ||
    trimmed.includes('请告诉我') ||
    trimmed.includes('请选择')

  if (!asksDirectQuestion) {
    return false
  }

  const userAddressingHints = [
    '你',
    '您',
    'would you',
    'do you',
    'which',
    'what',
    'prefer',
    'want',
    'choose',
    'confirm',
  ]

  const decisionHints = [
    '希望',
    '想要',
    '选择',
    '确认',
    '决定',
    '偏好',
    'prefer',
    'want',
    'choose',
    'confirm',
    'decide',
    'preference',
  ]

  return (
    userAddressingHints.some(hint => lower.includes(hint) || trimmed.includes(hint)) &&
    decisionHints.some(hint => lower.includes(hint) || trimmed.includes(hint))
  )
}

function shouldAutoContinueAssistant(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return false

  const lower = trimmed.toLowerCase()
  const starters = [
    "let me ",
    "i'll ",
    'i will ',
    'next, ',
    'now i will ',
    '我来',
    '让我',
    '接下来我会',
    '现在我来',
    '我先',
  ]

  const actionHints = [
    '优化',
    '修改',
    '创建',
    '检查',
    'read',
    'inspect',
    'update',
    'modify',
    'optimize',
    'create',
    'fix',
  ]

  const planHints = [
    '我会',
    '我将',
    '计划',
    '步骤',
    '接下来',
    '然后',
    'let me',
    "i'll",
    'i will',
    'plan',
    'steps',
    'next',
    'then',
  ]

  const hasNumberedPlan =
    /^\s*1\.\s+/m.test(trimmed) ||
    /^\s*-\s+/m.test(trimmed) ||
    /^\s*•\s+/m.test(trimmed)

  const looksLikePreface =
    trimmed.endsWith(':') ||
    trimmed.endsWith('：') ||
    starters.some(prefix => lower.startsWith(prefix) || trimmed.startsWith(prefix))

  const looksLikePlan =
    hasNumberedPlan || planHints.some(hint => lower.includes(hint) || trimmed.includes(hint))

  if (looksLikeClarifyingQuestion(trimmed)) {
    return false
  }

  if (!looksLikePreface && !looksLikePlan) {
    return false
  }

  return actionHints.some(hint => lower.includes(hint) || trimmed.includes(hint))
}

export async function runAgentTurn(args: {
  model: ModelAdapter
  tools: ToolRegistry
  messages: ChatMessage[]
  cwd: string
  permissions?: PermissionManager
  maxSteps?: number
  onToolStart?: (toolName: string, input: unknown) => void
  onToolResult?: (toolName: string, output: string, isError: boolean) => void
  onAssistantMessage?: (content: string) => void
}): Promise<ChatMessage[]> {
  const maxSteps = args.maxSteps ?? 6
  let messages = args.messages
  let autoContinueCount = 0

  for (let step = 0; step < maxSteps; step++) {
    const next = await args.model.next(messages)

    if (next.type === 'assistant') {
      args.onAssistantMessage?.(next.content)
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: next.content,
      }
      const withAssistant: ChatMessage[] = [
        ...messages,
        assistantMessage,
      ]

      if (
        autoContinueCount < 2 &&
        userRequestedAction(messages) &&
        shouldAutoContinueAssistant(next.content)
      ) {
        autoContinueCount += 1
        messages = [
          ...withAssistant,
          <ChatMessage>{
            role: 'user',
            content:
              'Continue immediately with tool use. The user asked you to act, so do not stop at a preface, plan, or recommendation list. Inspect files, edit files, run tools, and only summarize after you have actually started the work.',
          },
        ]
        continue
      }

      return withAssistant
    }

    if (next.content && looksLikeClarifyingQuestion(next.content)) {
      args.onAssistantMessage?.(next.content)
      return [
        ...messages,
        { role: 'assistant', content: next.content },
      ]
    }

    if (next.content) {
      args.onAssistantMessage?.(next.content)
      messages = [
        ...messages,
        { role: 'assistant', content: next.content },
      ]
    }

    for (const call of next.calls) {
      args.onToolStart?.(call.toolName, call.input)
      const result = await args.tools.execute(
        call.toolName,
        call.input,
        { cwd: args.cwd, permissions: args.permissions },
      )
      args.onToolResult?.(call.toolName, result.output, !result.ok)

      messages = [
        ...messages,
        {
          role: 'assistant_tool_call',
          toolUseId: call.id,
          toolName: call.toolName,
          input: call.input,
        },
        {
          role: 'tool_result',
          toolUseId: call.id,
          toolName: call.toolName,
          content: result.ok ? result.output : result.output,
          isError: !result.ok,
        },
      ]
    }
  }

  return [
    ...messages,
    {
      role: 'assistant',
      content: `达到最大工具步数限制，已停止当前回合。`,
    },
  ]
}
