import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { isEnoentError } from './utils/errors.js'

export type McpServerConfig = {
  command: string
  args?: string[]
  env?: Record<string, string | number>
  url?: string
  headers?: Record<string, string | number>
  cwd?: string
  enabled?: boolean
  protocol?: 'auto' | 'content-length' | 'newline-json' | 'streamable-http'
}

export type TraceSettings = {
  enabled?: boolean
  langfuse?: {
    enabled?: boolean
    publicKey?: string
    secretKey?: string
    baseUrl?: string
    environment?: string
  }
}

export type TcodeSettings = {
  env?: Record<string, string | number>
  model?: string
  maxOutputTokens?: number
  mcpServers?: Record<string, McpServerConfig>
  trace?: TraceSettings
}

export type McpConfigScope = 'user' | 'project'

export type RuntimeConfig = {
  model: string
  baseUrl: string
  authToken?: string
  apiKey?: string
  maxOutputTokens?: number
  mcpServers: Record<string, McpServerConfig>
  trace?: TraceSettings
  sourceSummary: string
}

export const TCODE_DIR = process.env.TCODE_HOME
  ? path.resolve(process.env.TCODE_HOME)
  : path.join(os.homedir(), '.tcode')
export const TCODE_SETTINGS_PATH = path.join(TCODE_DIR, 'settings.json')
export const TCODE_HISTORY_PATH = path.join(TCODE_DIR, 'history.jsonl')
export const TCODE_PROJECTS_DIR = path.join(TCODE_DIR, 'projects')
export const TCODE_PERMISSIONS_PATH = path.join(TCODE_DIR, 'permissions.json')
export const TCODE_MCP_PATH = path.join(TCODE_DIR, 'mcp.json')
export const TCODE_MCP_TOKENS_PATH = path.join(TCODE_DIR, 'mcp-tokens.json')
export const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json')
export const PROJECT_MCP_PATH = path.join(process.cwd(), '.mcp.json')

async function readSettingsFile(filePath: string): Promise<TcodeSettings> {
  try {
    const content = await readFile(filePath, 'utf8')
    return JSON.parse(content) as TcodeSettings
  } catch (error) {
    if (isEnoentError(error)) {
      return {}
    }

    throw error
  }
}

export async function readMcpTokensFile(
  filePath = TCODE_MCP_TOKENS_PATH,
): Promise<Record<string, string>> {
  try {
    const content = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(content) as unknown
    if (typeof parsed !== 'object' || parsed === null) {
      return {}
    }
    return parsed as Record<string, string>
  } catch (error) {
    if (isEnoentError(error)) return {}
    throw error
  }
}

export async function saveMcpTokensFile(
  tokens: Record<string, string>,
  filePath = TCODE_MCP_TOKENS_PATH,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(tokens, null, 2)}\n`, 'utf8')
}

// 读取独立的 mcp.json（全局或项目级），只取其中的 mcpServers 字段。
export async function readMcpConfigFile(
  filePath: string,
): Promise<Record<string, McpServerConfig>> {
  try {
    const content = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(content) as unknown
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('mcpServers' in parsed) ||
      typeof parsed.mcpServers !== 'object' ||
      parsed.mcpServers === null
    ) {
      return {}
    }

    return parsed.mcpServers as Record<string, McpServerConfig>
  } catch (error) {
    if (isEnoentError(error)) {
      return {}
    }

    throw error
  }
}

// 按作用域定位 mcp.json 路径：项目级写到 cwd/.mcp.json，用户级写到 ~/.tcode/mcp.json。
export function getMcpConfigPath(
  scope: McpConfigScope,
  cwd = process.cwd(),
): string {
  return scope === 'project' ? path.join(cwd, '.mcp.json') : TCODE_MCP_PATH
}

export async function loadScopedMcpServers(
  scope: McpConfigScope,
  cwd = process.cwd(),
): Promise<Record<string, McpServerConfig>> {
  return readMcpConfigFile(getMcpConfigPath(scope, cwd))
}

export async function saveScopedMcpServers(
  scope: McpConfigScope,
  servers: Record<string, McpServerConfig>,
  cwd = process.cwd(),
): Promise<void> {
  const targetPath = getMcpConfigPath(scope, cwd)
  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(
    targetPath,
    `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`,
    'utf8',
  )
}

function mergeSettings(
  base: TcodeSettings,
  override: TcodeSettings,
): TcodeSettings {
  const mergedMcpServers = {
    ...(base.mcpServers ?? {}),
  }

  for (const [name, server] of Object.entries(override.mcpServers ?? {})) {
    mergedMcpServers[name] = {
      ...(mergedMcpServers[name] ?? {}),
      ...server,
      env: {
        ...(mergedMcpServers[name]?.env ?? {}),
        ...(server.env ?? {}),
      },
      headers: {
        ...(mergedMcpServers[name]?.headers ?? {}),
        ...(server.headers ?? {}),
      },
    }
  }

  const mergedTrace =
    base.trace || override.trace
      ? {
          ...(base.trace ?? {}),
          ...(override.trace ?? {}),
          langfuse:
            base.trace?.langfuse || override.trace?.langfuse
              ? {
                  ...(base.trace?.langfuse ?? {}),
                  ...(override.trace?.langfuse ?? {}),
                }
              : undefined,
        }
      : undefined

  return {
    ...base,
    ...override,
    env: {
      ...(base.env ?? {}),
      ...(override.env ?? {}),
    },
    mcpServers: mergedMcpServers,
    trace: mergedTrace,
  }
}

export async function loadEffectiveSettings(): Promise<TcodeSettings> {
  const claudeSettings = await readSettingsFile(CLAUDE_SETTINGS_PATH)
  const globalMcpConfig = await readMcpConfigFile(TCODE_MCP_PATH)
  const projectMcpConfig = await readMcpConfigFile(PROJECT_MCP_PATH)
  const tcodeSettings = await readSettingsFile(TCODE_SETTINGS_PATH)
  return mergeSettings(
    mergeSettings(
      mergeSettings(claudeSettings, { mcpServers: globalMcpConfig }),
      { mcpServers: projectMcpConfig },
    ),
    tcodeSettings,
  )
}

export async function saveTcodeSettings(
  updates: TcodeSettings,
): Promise<void> {
  await mkdir(TCODE_DIR, { recursive: true })
  const existing = await readSettingsFile(TCODE_SETTINGS_PATH)
  const next = mergeSettings(existing, updates)
  await writeFile(
    TCODE_SETTINGS_PATH,
    `${JSON.stringify(next, null, 2)}\n`,
    'utf8',
  )
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const effectiveSettings = await loadEffectiveSettings()
  const env = {
    ...(effectiveSettings.env ?? {}),
    ...process.env,
  }

  const model =
    process.env.TCODE_MODEL ||
    effectiveSettings.model ||
    String(env.ANTHROPIC_MODEL ?? '').trim()

  const baseUrl =
    String(env.ANTHROPIC_BASE_URL ?? '').trim() || 'https://api.anthropic.com'
  const authToken = String(env.ANTHROPIC_AUTH_TOKEN ?? '').trim() || undefined
  const apiKey = String(env.ANTHROPIC_API_KEY ?? '').trim() || undefined

  const rawMaxOutputTokens =
    process.env.TCODE_MAX_OUTPUT_TOKENS ??
    effectiveSettings.maxOutputTokens ??
    env.TCODE_MAX_OUTPUT_TOKENS
  const parsedMaxOutputTokens =
    rawMaxOutputTokens === undefined ? NaN : Number(rawMaxOutputTokens)
  const maxOutputTokens =
    Number.isFinite(parsedMaxOutputTokens) && parsedMaxOutputTokens > 0
      ? Math.floor(parsedMaxOutputTokens)
      : undefined

  if (!model) {
    throw new Error(
      `No model configured. Set ~/.tcode/settings.json or env.ANTHROPIC_MODEL.`,
    )
  }

  if (!authToken && !apiKey) {
    throw new Error(
      `No auth configured. Set ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY in ~/.tcode/settings.json or process env.`,
    )
  }

  return {
    model,
    baseUrl,
    authToken,
    apiKey,
    maxOutputTokens,
    mcpServers: effectiveSettings.mcpServers ?? {},
    trace: effectiveSettings.trace,
    sourceSummary: `config: ${TCODE_SETTINGS_PATH} > ${CLAUDE_SETTINGS_PATH} > process.env`,
  }
}
