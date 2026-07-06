import type { ChatMessage, CompressionResult } from '../types.js'
import type { ModelAdapter } from '../types.js'
import { computeContextStats } from '../utils/token-estimator.js'
import { getModelContextWindow } from '../utils/model-context.js'
import { compactConversation } from './compact.js'
import { THRESHOLDS, LIMITS } from './constants.js'

type AutoCompactState = {
  consecutiveFailures: number
  disabled: boolean
}

const state: AutoCompactState = {
  consecutiveFailures: 0,
  disabled: false,
}

export function resetAutoCompactState(): void {
  state.consecutiveFailures = 0
  state.disabled = false
}

export function getAutoCompactState(): Readonly<AutoCompactState> {
  return { ...state }
}

export async function autoCompact(
  messages: ChatMessage[],
  model: string,
  modelAdapter: ModelAdapter,
): Promise<CompressionResult | null> {
  if (state.disabled) {
    return null
  }

  const window = getModelContextWindow(model)
  if (window.effectiveInput < LIMITS.MIN_EFFECTIVE_INPUT_FOR_AUTOCOMPACT) {
    return null
  }

  const stats = computeContextStats(messages, model)
  if (stats.utilization < THRESHOLDS.AUTOCOMPACT_UTILIZATION) {
    return null
  }

  try {
    const result = await compactConversation(messages, modelAdapter)
    if (result) {
      state.consecutiveFailures = 0
      return result
    }

    state.consecutiveFailures++
    if (state.consecutiveFailures >= LIMITS.MAX_AUTOCOMPACT_FAILURES) {
      state.disabled = true
    }
    return null
  } catch {
    state.consecutiveFailures++
    if (state.consecutiveFailures >= LIMITS.MAX_AUTOCOMPACT_FAILURES) {
      state.disabled = true
    }
    return null
  }
}
