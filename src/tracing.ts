import { randomUUID } from 'node:crypto'
import { LangfuseClient } from '@langfuse/client'
import { LangfuseSpanProcessor } from '@langfuse/otel'
import { startObservation } from '@langfuse/tracing'
import { NodeSDK } from '@opentelemetry/sdk-node'
import type { AgentStep, ChatMessage } from './types.js'
import type { TraceSettings } from './config.js'

type MutableObservation = {
  traceId: string
  startObservation(
    name: string,
    attributes?: unknown,
    options?: unknown,
  ): MutableObservation
  update(attributes: unknown): void
  end(): void
}

export type TraceConfig = {
  enabled: boolean
  langfuse?: {
    enabled: boolean
    publicKey?: string
    secretKey?: string
    baseUrl?: string
    environment?: string
  }
}

export type TraceStatus = {
  enabled: boolean
  langfuseEnabled: boolean
  langfuseStatus?: string
  langfuseUrl?: string
}

type TraceEventName =
  | 'turn_start'
  | 'turn_end'
  | 'model_input'
  | 'model_raw_response'
  | 'model_output'
  | 'loop_decision'
  | 'tool_start'
  | 'tool_end'
  | 'error'

type TraceEvent = {
  turnId?: string
  eventIndex: number
  timestamp: string
  name: TraceEventName
  stepIndex?: number
  data?: unknown
}

export type AgentTracer = {
  getStatus(): TraceStatus
  startTurn(data?: unknown): Promise<void>
  endTurn(data?: unknown): Promise<void>
  record(name: TraceEventName, data?: unknown, stepIndex?: number): Promise<void>
  flush(): Promise<void>
}

type RuntimeTraceSettings = TraceSettings

const DEFAULT_MAX_STRING_LENGTH = 12_000
const MASKED = '[REDACTED]'

const SECRET_KEY_PATTERN =
  /(api[_-]?key|auth[_-]?token|authorization|secret|password|langfuse[_-]?secret[_-]?key|anthropic[_-]?(api[_-]?key|auth[_-]?token)|x-api-key)/i

function truthy(value: unknown): boolean {
  if (typeof value !== 'string') return Boolean(value)
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function makeTraceId(): string {
  return randomUUID().slice(0, 8)
}

function truncateString(value: string): string {
  if (value.length <= DEFAULT_MAX_STRING_LENGTH) {
    return value
  }

  return `${value.slice(0, DEFAULT_MAX_STRING_LENGTH)}\n[TRUNCATED ${
    value.length - DEFAULT_MAX_STRING_LENGTH
  } chars]`
}

function sanitizeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') {
    return truncateString(value)
  }

  if (value === null || typeof value !== 'object') {
    return value
  }

  if (seen.has(value)) {
    return '[Circular]'
  }
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map(item => sanitizeValue(item, seen))
  }

  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    result[key] = SECRET_KEY_PATTERN.test(key)
      ? MASKED
      : sanitizeValue(item, seen)
  }
  return result
}

export function summarizeMessages(messages: ChatMessage[]): unknown {
  return {
    count: messages.length,
    roles: messages.map(message => message.role),
    messages,
  }
}

export function summarizeAgentStep(step: AgentStep): unknown {
  if (step.type === 'tool_calls') {
    return {
      type: step.type,
      content: step.content,
      contentKind: step.contentKind,
      calls: step.calls,
      diagnostics: step.diagnostics,
    }
  }

  return {
    type: step.type,
    content: step.content,
    kind: step.kind,
    diagnostics: step.diagnostics,
  }
}

class LangfuseTracer implements AgentTracer {
  private static sdkStarted = false
  private static processor: LangfuseSpanProcessor | null = null

  private client: LangfuseClient | null = null
  private session: MutableObservation | null = null
  private root: MutableObservation | null = null
  private status = 'pending'
  private traceUrl: string | undefined
  private turnId: string | undefined
  private eventIndex = 0

  constructor(private readonly config: TraceConfig) {}

  getStatus(): TraceStatus {
    return {
      enabled: this.config.enabled,
      langfuseEnabled: Boolean(this.config.langfuse?.enabled),
      langfuseStatus: this.status,
      langfuseUrl: this.traceUrl,
    }
  }

  async startTurn(data?: unknown): Promise<void> {
    this.turnId = makeTraceId()
    this.eventIndex = 0
    await this.record('turn_start', data)
  }

  async endTurn(data?: unknown): Promise<void> {
    await this.record('turn_end', data)
  }

  async record(name: TraceEventName, data?: unknown, stepIndex?: number): Promise<void> {
    if (!this.config.enabled) return

    const event: TraceEvent = {
      turnId: this.turnId,
      eventIndex: this.eventIndex++,
      timestamp: new Date().toISOString(),
      name,
      stepIndex,
      data,
    }
    await this.write(event)
  }

  async flush(): Promise<void> {
    this.session?.update({ output: { endedAt: new Date().toISOString() } })
    this.session?.end()
    this.session = null
    this.root = null
    await this.flushPending()
  }

  private async flushPending(): Promise<void> {
    await LangfuseTracer.processor?.forceFlush()
    await this.client?.flush()
  }

  private async write(event: TraceEvent): Promise<void> {
    if (!this.ensureReady()) return

    const data = sanitizeValue(event.data)
    if (!this.session) {
      this.session = startObservation(
        'tcode.session',
        {
          input: {
            startedAt: new Date().toISOString(),
          },
        },
        { asType: 'agent' },
      ) as MutableObservation
      this.traceUrl = await this.client?.getTraceUrl(this.session.traceId)
      this.status = this.traceUrl ? `connected: ${this.traceUrl}` : 'connected'
    }

    if (event.name === 'turn_start') {
      this.root = this.session.startObservation(
        'tcode.agent_turn',
        {
          input: data,
          metadata: {
            tcodeTurnId: event.turnId,
          },
        },
        { asType: 'agent' },
      ) as MutableObservation
    }

    if (!this.root) return

    const observation = this.root.startObservation(
      `tcode.${event.name}`,
      {
        input: data,
        metadata: {
          turnId: event.turnId,
          eventIndex: event.eventIndex,
          stepIndex: event.stepIndex,
        },
      },
      { asType: 'span' },
    )
    observation.update({ output: data })
    observation.end()

    if (event.name === 'turn_end' || event.name === 'error') {
      this.root.update({ output: data })
      this.root.end()
      this.root = null
      await this.flushPending()
    }
  }

  private ensureReady(): boolean {
    if (this.client) {
      return true
    }

    try {
      const langfuse = this.config.langfuse
      if (!langfuse?.enabled) {
        this.status = 'disabled'
        return false
      }

      if (!LangfuseTracer.sdkStarted) {
        LangfuseTracer.processor = new LangfuseSpanProcessor({
          publicKey: langfuse.publicKey,
          secretKey: langfuse.secretKey,
          baseUrl: langfuse.baseUrl,
          environment: langfuse.environment,
          flushAt: 1,
          flushInterval: 1,
          mask: ({ data }) => sanitizeValue(data),
        })
        new NodeSDK({
          spanProcessors: [LangfuseTracer.processor],
        }).start()
        LangfuseTracer.sdkStarted = true
      }

      this.client = new LangfuseClient({
        publicKey: langfuse.publicKey,
        secretKey: langfuse.secretKey,
        baseUrl: langfuse.baseUrl,
      })
      this.status = 'ready'
      return true
    } catch (error) {
      this.status = error instanceof Error ? `disabled: ${error.message}` : 'disabled'
      this.client = null
      return false
    }
  }

}

class NoopTracer implements AgentTracer {
  getStatus(): TraceStatus {
    return {
      enabled: false,
      langfuseEnabled: false,
    }
  }

  async startTurn(): Promise<void> {}
  async endTurn(): Promise<void> {}
  async record(): Promise<void> {}
  async flush(): Promise<void> {}
}

export function resolveTraceConfig(settings?: RuntimeTraceSettings | null): TraceConfig {
  const enabled = truthy(process.env.TCODE_TRACE ?? settings?.enabled)
  const langfuseEnabled = truthy(
    process.env.TCODE_TRACE_LANGFUSE ?? settings?.langfuse?.enabled,
  )

  return {
    enabled,
    langfuse: {
      enabled: langfuseEnabled,
      publicKey: process.env.LANGFUSE_PUBLIC_KEY || settings?.langfuse?.publicKey,
      secretKey: process.env.LANGFUSE_SECRET_KEY || settings?.langfuse?.secretKey,
      baseUrl: process.env.LANGFUSE_BASE_URL || settings?.langfuse?.baseUrl,
      environment:
        process.env.LANGFUSE_ENVIRONMENT ||
        settings?.langfuse?.environment ||
        process.env.NODE_ENV,
    },
  }
}

export function createAgentTracer(args: {
  config?: TraceConfig | null
}): AgentTracer {
  const config = args.config ?? resolveTraceConfig()
  if (!config.enabled || !config.langfuse?.enabled) {
    return new NoopTracer()
  }

  return new LangfuseTracer(config)
}
