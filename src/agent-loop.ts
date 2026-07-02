import type { ToolRegistry } from './tool.js'
import type { ChatMessage, ModelAdapter } from './types.js'
import type { PermissionManager } from './permissions.js'
import type { AgentTracer } from './tracing.js'
import { summarizeAgentStep, summarizeMessages } from './tracing.js'

function looksLikeClarifyingQuestion(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return false

  const lower = trimmed.toLowerCase()
  const hasQuestionMark = /[?？]/.test(trimmed)
  const asksForDecision =
    /请(?:你|您)?(?:确认|选择|决定|告知|说明|回复)|是否|要不要|可否|行吗|可以吗|你(?:希望|想要)|您(?:希望|想要)|请选择|请告诉我/.test(
      trimmed,
    ) ||
    /would you|do you|which|what would you like|prefer|want|choose|confirm|decide|please provide|let me know/.test(
      lower,
    )
  const asksForMissingInfo =
    /请(?:提供|补充)|需要你|还需要|缺少|未提供|告诉我/.test(trimmed) ||
    /provide|share|clarify|missing|need your|tell me/.test(lower)

  if (asksForDecision || asksForMissingInfo) {
    return true
  }

  if (!hasQuestionMark) {
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
    'user',
    'your',
  ]

  return userAddressingHints.some(
    hint => lower.includes(hint) || trimmed.includes(hint),
  )
}

function isEmptyAssistantResponse(content: string): boolean {
  return content.trim().length === 0
}

function shouldTreatAssistantAsProgress(args: {
  kind?: 'final' | 'progress'
  content: string
  sawToolResultThisTurn: boolean
}): boolean {
  if (args.kind === 'progress') {
    return true
  }

  if (args.kind === 'final') {
    return false
  }

  if (!args.sawToolResultThisTurn) {
    return false
  }

  if (looksLikeClarifyingQuestion(args.content)) {
    return false
  }

  return args.content.trim().length > 0
}

function formatDiagnostics(args: {
  stopReason?: string
  blockTypes?: string[]
  ignoredBlockTypes?: string[]
}): string {
  const parts: string[] = []

  if (args.stopReason) {
    parts.push(`stop_reason=${args.stopReason}`)
  }

  if ((args.blockTypes?.length ?? 0) > 0) {
    parts.push(`blocks=${args.blockTypes!.join(',')}`)
  }

  if ((args.ignoredBlockTypes?.length ?? 0) > 0) {
    parts.push(`ignored=${args.ignoredBlockTypes!.join(',')}`)
  }

  return parts.length > 0 ? ` 诊断信息: ${parts.join('; ')}。` : ''
}

function isRecoverableThinkingStop(args: {
  isEmpty: boolean
  stopReason?: string
  ignoredBlockTypes?: string[]
}): boolean {
  if (!args.isEmpty) {
    return false
  }

  if (args.stopReason !== 'pause_turn' && args.stopReason !== 'max_tokens') {
    return false
  }

  return (args.ignoredBlockTypes ?? []).includes('thinking')
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
  onProgressMessage?: (content: string) => void
  tracer?: AgentTracer
}): Promise<ChatMessage[]> {
  const maxSteps = args.maxSteps ?? 6
  let messages = args.messages
  let emptyResponseRetryCount = 0
  let recoverableThinkingRetryCount = 0
  let toolErrorCount = 0
  let sawToolResultThisTurn = false

  const pushContinuationPrompt = (content: string) => {
    messages = [
      ...messages,
      {
        role: 'user',
        content,
      },
    ]
  }

  const finishTurn = async (result: ChatMessage[], data: unknown): Promise<ChatMessage[]> => {
    const metadata = data && typeof data === 'object' && !Array.isArray(data) ? data : {}
    await args.tracer?.endTurn({
      ...metadata,
      finalMessageCount: result.length,
    })
    return result
  }

  await args.tracer?.startTurn({
    cwd: args.cwd,
    maxSteps,
    initialMessageCount: messages.length,
    messages: summarizeMessages(messages),
  })

  try {
    for (let step = 0; step < maxSteps; step++) {
      await args.tracer?.record(
        'model_input',
        {
          source: 'agent-loop',
          messages: summarizeMessages(messages),
        },
        step,
      )
      const next = await args.model.next(messages, {
        tracer: args.tracer,
        stepIndex: step,
      })
      await args.tracer?.record(
        'loop_decision',
        {
          phase: 'model_step_received',
          step: summarizeAgentStep(next),
        },
        step,
      )

      if (next.type === 'assistant') {
        const isEmpty = isEmptyAssistantResponse(next.content)
        if (
          !isEmpty &&
          shouldTreatAssistantAsProgress({
            kind: next.kind,
            content: next.content,
            sawToolResultThisTurn,
          })
        ) {
          const continuationPrompt =
            sawToolResultThisTurn && next.kind !== 'progress'
              ? 'Continue from your progress update. You have already used tools in this turn, so treat plain status text as progress, not a final answer. Respond with the next concrete tool call, code change, or an explicit <final> answer only if the task is truly complete.'
              : 'Continue immediately from your <progress> update with concrete tool calls, code changes, or an explicit <final> answer only if the task is complete.'
          await args.tracer?.record(
            'loop_decision',
            {
              decision: 'assistant_progress_continue',
              continuationPrompt,
            },
            step,
          )
          args.onProgressMessage?.(next.content)
          messages = [
            ...messages,
            { role: 'assistant_progress', content: next.content },
          ]
          pushContinuationPrompt(continuationPrompt)
          continue
        }

        if (
          isRecoverableThinkingStop({
            isEmpty,
            stopReason: next.diagnostics?.stopReason,
            ignoredBlockTypes: next.diagnostics?.ignoredBlockTypes,
          }) &&
          recoverableThinkingRetryCount < 3
        ) {
          recoverableThinkingRetryCount += 1
          const stopReason = next.diagnostics?.stopReason
          const progressContent =
            stopReason === 'max_tokens'
              ? '模型在 thinking 阶段触发 max_tokens，正在继续请求后续步骤...'
              : '模型返回 pause_turn，正在继续请求后续步骤...'
          const continuationPrompt =
            stopReason === 'max_tokens'
              ? 'Your previous response hit max_tokens during thinking before producing the next actionable step. Resume immediately and continue with the next concrete tool call, code change, or an explicit <final> answer only if the task is complete. Do not repeat the earlier plan.'
              : 'Resume from the previous pause_turn and continue the task immediately. Produce the next concrete tool call, code change, or an explicit <final> answer only if the task is complete.'
          await args.tracer?.record(
            'loop_decision',
            {
              decision: 'recoverable_thinking_retry',
              retryCount: recoverableThinkingRetryCount,
              stopReason,
              continuationPrompt,
            },
            step,
          )
          args.onProgressMessage?.(progressContent)
          messages = [
            ...messages,
            { role: 'assistant_progress', content: progressContent },
          ]
          pushContinuationPrompt(continuationPrompt)
          continue
        }

        if (isEmpty && emptyResponseRetryCount < 2) {
          emptyResponseRetryCount += 1
          const continuationPrompt = sawToolResultThisTurn
            ? 'Your last response was empty after recent tool results. Continue immediately by trying the next concrete step, adapting to any tool errors, or giving an explicit <final> answer only if the task is complete.'
            : 'Your last response was empty. Continue immediately with concrete tool calls, code changes, or an explicit <final> answer only if the task is complete.'
          await args.tracer?.record(
            'loop_decision',
            {
              decision: 'empty_response_retry',
              retryCount: emptyResponseRetryCount,
              continuationPrompt,
            },
            step,
          )
          pushContinuationPrompt(continuationPrompt)
          continue
        }

        if (isEmpty) {
          const diagnosticsSuffix = formatDiagnostics({
            stopReason: next.diagnostics?.stopReason,
            blockTypes: next.diagnostics?.blockTypes,
            ignoredBlockTypes: next.diagnostics?.ignoredBlockTypes,
          })
          const fallbackContent =
            sawToolResultThisTurn
              ? toolErrorCount > 0
                ? `工具执行后模型返回空响应，已停止当前回合。最近有 ${toolErrorCount} 个工具报错；请重试、调整命令，或让模型改用其他方案。${diagnosticsSuffix}`
                : `工具执行后模型返回空响应，已停止当前回合。请重试，或要求模型继续完成剩余步骤。${diagnosticsSuffix}`
              : `模型返回空响应，已停止当前回合。请重试，或要求模型继续。${diagnosticsSuffix}`

          await args.tracer?.record(
            'loop_decision',
            {
              decision: 'empty_response_fallback',
              fallbackContent,
              toolErrorCount,
            },
            step,
          )
          args.onAssistantMessage?.(fallbackContent)
          return finishTurn(
            [
              ...messages,
              {
                role: 'assistant',
                content: fallbackContent,
              },
            ],
            { outcome: 'empty_response_fallback' },
          )
        }

        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: next.content,
        }
        const withAssistant: ChatMessage[] = [
          ...messages,
          assistantMessage,
        ]

        await args.tracer?.record(
          'loop_decision',
          {
            decision: 'assistant_final',
            kind: next.kind,
          },
          step,
        )
        if (!isEmpty) {
          args.onAssistantMessage?.(next.content)
        }

        return finishTurn(withAssistant, { outcome: 'assistant_final' })
      }

      if (next.content && looksLikeClarifyingQuestion(next.content)) {
        await args.tracer?.record(
          'loop_decision',
          {
            decision: 'clarifying_question',
            content: next.content,
          },
          step,
        )
        args.onAssistantMessage?.(next.content)
        return finishTurn(
          [
            ...messages,
            { role: 'assistant', content: next.content },
          ],
          { outcome: 'clarifying_question' },
        )
      }

      if (next.content) {
        if (next.contentKind === 'progress') {
          const continuationPrompt =
            'Continue immediately from your <progress> update with concrete tool calls, code changes, or an explicit <final> answer only if the task is complete.'
          await args.tracer?.record(
            'loop_decision',
            {
              decision: 'tool_call_progress_continue',
              continuationPrompt,
            },
            step,
          )
          args.onProgressMessage?.(next.content)
          messages = [
            ...messages,
            { role: 'assistant_progress', content: next.content },
          ]
          pushContinuationPrompt(continuationPrompt)
        } else {
          await args.tracer?.record(
            'loop_decision',
            {
              decision: 'tool_call_assistant_text',
              content: next.content,
            },
            step,
          )
          args.onAssistantMessage?.(next.content)
          messages = [
            ...messages,
            { role: 'assistant', content: next.content },
          ]
        }
      }

      for (const call of next.calls) {
        const toolStartedAt = Date.now()
        await args.tracer?.record(
          'tool_start',
          {
            toolUseId: call.id,
            toolName: call.toolName,
            input: call.input,
          },
          step,
        )
        args.onToolStart?.(call.toolName, call.input)
        const result = await args.tools.execute(
          call.toolName,
          call.input,
          { cwd: args.cwd, permissions: args.permissions },
        )
        sawToolResultThisTurn = true
        if (!result.ok) {
          toolErrorCount += 1
        }
        await args.tracer?.record(
          'tool_end',
          {
            toolUseId: call.id,
            toolName: call.toolName,
            ok: result.ok,
            output: result.output,
            durationMs: Date.now() - toolStartedAt,
          },
          step,
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

        if (result.awaitUser) {
          const question = result.output.trim()
          if (question.length > 0) {
            await args.tracer?.record(
              'loop_decision',
              {
                decision: 'await_user',
                toolUseId: call.id,
                toolName: call.toolName,
                question,
              },
              step,
            )
            args.onAssistantMessage?.(question)
            messages = [
              ...messages,
              {
                role: 'assistant',
                content: question,
              },
            ]
          }

          return finishTurn(messages, { outcome: 'await_user' })
        }
      }
    }

    const maxStepContent = `达到最大工具步数限制，已停止当前回合。`
    await args.tracer?.record(
      'loop_decision',
      {
        decision: 'max_steps',
        maxSteps,
        content: maxStepContent,
      },
      maxSteps,
    )
    args.onAssistantMessage?.(maxStepContent)
    return finishTurn(
      [
        ...messages,
        {
          role: 'assistant',
          content: maxStepContent,
        },
      ],
      { outcome: 'max_steps' },
    )
  } catch (error) {
    await args.tracer?.record('error', {
      phase: 'agent_loop',
      error: error instanceof Error ? error.message : String(error),
    })
    await args.tracer?.endTurn({
      outcome: 'error',
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
