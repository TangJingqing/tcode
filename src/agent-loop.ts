import type { ToolRegistry } from './tool.js'
import type { ChatMessage, CompressionResult, ModelAdapter, ProviderThinkingBlock, ProviderUsage } from './types.js'
import type { PermissionManager } from './permissions.js'
import type { AgentTracer } from './tracing.js'
import { summarizeAgentStep, summarizeMessages } from './tracing.js'
import { microcompact } from './compact/microcompact.js'
import { autoCompact } from './compact/auto-compact.js'
import {
  applyContextCollapseIfNeeded,
  createContextCollapseState,
  type ContextCollapseResult,
  type ContextCollapseState,
} from './compact/context-collapse.js'
import {
  snipCompactConversation,
  type SnipCompactResult,
} from './compact/snipCompact.js'
import { computeContextStats } from './utils/token-estimator.js'
import {
  applyToolResultBudget,
  createContentReplacementState,
  replaceLargeToolResult,
  type ContentReplacementState,
  type PendingToolResult,
} from './utils/tool-result-storage.js'

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

function withProviderUsage<T extends ChatMessage>(
  message: T,
  usage: ProviderUsage | undefined,
): T {
  if (!usage) return message
  if (
    message.role === 'assistant' ||
    message.role === 'assistant_progress' ||
    message.role === 'assistant_tool_call'
  ) {
    return { ...message, providerUsage: usage } as T
  }
  return message
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
  blockTypes?: string[]
  ignoredBlockTypes?: string[]
}): boolean {
  if (!args.isEmpty) {
    return false
  }

  if (args.stopReason !== 'pause_turn' && args.stopReason !== 'max_tokens') {
    return false
  }

  return (
    (args.blockTypes ?? []).includes('thinking') ||
    (args.ignoredBlockTypes ?? []).includes('thinking')
  )
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
  modelName?: string
  onAutoCompact?: (result: CompressionResult) => void | Promise<void>
  onSnipCompact?: (result: SnipCompactResult) => void | Promise<void>
  onContextCollapse?: (result: ContextCollapseResult) => void | Promise<void>
  onContextStats?: (stats: import('./utils/token-estimator.js').ContextStats) => void
  contentReplacementState?: ContentReplacementState
  contextCollapseState?: ContextCollapseState
}): Promise<ChatMessage[]> {
  const maxSteps = args.maxSteps ?? 6
  const modelName = args.modelName ?? ''
  let messages = args.messages
  let emptyResponseRetryCount = 0
  let recoverableThinkingRetryCount = 0
  let toolErrorCount = 0
  let sawToolResultThisTurn = false
  let snippedThisTurn = false
  const contentReplacementState =
    args.contentReplacementState ?? createContentReplacementState()
  let contextCollapseState =
    args.contextCollapseState ?? createContextCollapseState()

  const replaceContextCollapseState = (nextState: ContextCollapseState) => {
    contextCollapseState = nextState
    if (args.contextCollapseState) {
      args.contextCollapseState.spans = [...nextState.spans]
      args.contextCollapseState.enabled = nextState.enabled
      args.contextCollapseState.consecutiveFailures = nextState.consecutiveFailures
    }
  }

  const pushContinuationPrompt = (content: string) => {
    messages = [
      ...messages,
      {
        role: 'user',
        content,
      },
    ]
  }

  const appendThinkingBlocks = (blocks: ProviderThinkingBlock[] | undefined) => {
    if (!blocks || blocks.length === 0) return
    messages = [
      ...messages,
      {
        role: 'assistant_thinking',
        blocks,
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
      let latestStats: import('./utils/token-estimator.js').ContextStats | null = null
      let modelMessages = messages

      if (modelName) {
        latestStats = computeContextStats(messages, modelName)

        if (!snippedThisTurn) {
          const snipResult = await snipCompactConversation({
            messages,
            contextStats: latestStats,
            modelContextWindow: latestStats.effectiveInput,
          })
          if (snipResult.didSnip) {
            messages = snipResult.messages
            snippedThisTurn = true
            await args.onSnipCompact?.(snipResult)
            latestStats = computeContextStats(messages, modelName)
            args.onContextStats?.(latestStats)
          }
        }

        const beforeMicrocompact = messages
        messages = microcompact(messages, modelName)
        if (messages !== beforeMicrocompact) {
          latestStats = computeContextStats(messages, modelName)
          args.onContextStats?.(latestStats)
        }

        const collapseResult = await applyContextCollapseIfNeeded(
          messages,
          modelName,
          args.model,
          contextCollapseState,
        )
        replaceContextCollapseState(collapseResult.state)
        modelMessages = collapseResult.messages
        if (collapseResult.collapsed) {
          await args.onContextCollapse?.(collapseResult)
          latestStats = computeContextStats(modelMessages, modelName)
          args.onContextStats?.(latestStats)
        } else if (modelMessages !== messages) {
          latestStats = computeContextStats(modelMessages, modelName)
          args.onContextStats?.(latestStats)
        }
      }

      // AutoCompact: LLM-based compression when context is critical (first step only)
      if (step === 0 && modelName) {
        latestStats = latestStats ?? computeContextStats(modelMessages, modelName)
        args.onContextStats?.(latestStats)
        if (latestStats.warningLevel === 'critical' || latestStats.warningLevel === 'blocked') {
          const result = await autoCompact(modelMessages, modelName, args.model)
          if (result) {
            messages = result.messages
            modelMessages = messages
            replaceContextCollapseState(createContextCollapseState())
            await args.onAutoCompact?.(result)
            latestStats = computeContextStats(messages, modelName)
            args.onContextStats?.(latestStats)
          }
        }
      }

      await args.tracer?.record(
        'model_input',
        {
          source: 'agent-loop',
          messages: summarizeMessages(messages),
        },
        step,
      )
      const next = await args.model.next(modelMessages, {
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
          appendThinkingBlocks(next.thinkingBlocks)
          messages = [
            ...messages,
            withProviderUsage({ role: 'assistant_progress', content: next.content }, next.usage),
          ]
          pushContinuationPrompt(continuationPrompt)
          continue
        }

        if (
          isRecoverableThinkingStop({
            isEmpty,
            stopReason: next.diagnostics?.stopReason,
            blockTypes: next.diagnostics?.blockTypes,
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
            withProviderUsage({ role: 'assistant_progress', content: progressContent }, next.usage),
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
          appendThinkingBlocks(next.thinkingBlocks)
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
        appendThinkingBlocks(next.thinkingBlocks)
        const withAssistant: ChatMessage[] = [
          ...messages,
          withProviderUsage(assistantMessage, next.usage),
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

      appendThinkingBlocks(next.thinkingBlocks)

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
            withProviderUsage({ role: 'assistant_progress', content: next.content }, next.usage),
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
            withProviderUsage(
              { role: 'assistant', content: next.content },
              (next.calls?.length ?? 0) > 0 ? undefined : next.usage,
            ),
          ]
        }
      }

      const executedToolResults: Array<{
        call: (typeof next.calls)[number]
        result: Awaited<ReturnType<ToolRegistry['execute']>>
        toolResult: PendingToolResult
      }> = []

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

        const toolResult = await replaceLargeToolResult({
          role: 'tool_result',
          toolUseId: call.id,
          toolName: call.toolName,
          content: result.output,
          isError: !result.ok,
        }, contentReplacementState)

        executedToolResults.push({
          call,
          result,
          toolResult,
        })
      }

      const budgetedResults = await applyToolResultBudget(
        executedToolResults.map(entry => entry.toolResult),
        contentReplacementState,
      )
      const toolResultById = new Map(
        budgetedResults.results.map(result => [result.toolUseId, result]),
      )

      const toolCallMessages = executedToolResults.map((entry, i) => {
        const toolCallMessage: ChatMessage = {
          role: 'assistant_tool_call',
          toolUseId: entry.call.id,
          toolName: entry.call.toolName,
          input: entry.call.input,
        }

        return withProviderUsage(
          toolCallMessage,
          i === executedToolResults.length - 1 ? next.usage : undefined,
        )
      })
      const toolResults = executedToolResults.map(entry =>
        toolResultById.get(entry.call.id) ?? entry.toolResult,
      )

      messages = [
        ...messages,
        ...toolCallMessages,
        ...toolResults,
      ]

      const awaitUserEntry = executedToolResults.find(entry => entry.result.awaitUser)
      if (awaitUserEntry) {
        const question = awaitUserEntry.result.output.trim()
          if (question.length > 0) {
            await args.tracer?.record(
              'loop_decision',
              {
                decision: 'await_user',
                toolUseId: awaitUserEntry.call.id,
                toolName: awaitUserEntry.call.toolName,
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
