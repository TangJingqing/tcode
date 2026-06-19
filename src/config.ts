import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export type TcodeSettings = {
  env?: Record<string, string | number>
  model?: string
}

export type RuntimeConfig = {
  model: string
  baseUrl: string
  authToken?: string
  apiKey?: string
  sourceSummary: string
}

export const TCODE_DIR = path.join(os.homedir(), '.tcode')
export const TCODE_SETTINGS_PATH = path.join(TCODE_DIR, 'settings.json')
export const TCODE_HISTORY_PATH = path.join(TCODE_DIR, 'history.json')
export const TCODE_PERMISSIONS_PATH = path.join(TCODE_DIR, 'permissions.json')
export const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json')

async function readSettingsFile(filePath: string): Promise<TcodeSettings> {
  try {
    const content = await readFile(filePath, 'utf8')
    return JSON.parse(content) as TcodeSettings
  } catch (error) {
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : ''

    if (code === 'ENOENT') {
      return {}
    }

    throw error
  }
}

function mergeSettings(
  base: TcodeSettings,
  override: TcodeSettings,
): TcodeSettings {
  return {
    ...base,
    ...override,
    env: {
      ...(base.env ?? {}),
      ...(override.env ?? {}),
    },
  }
}

export async function loadEffectiveSettings(): Promise<TcodeSettings> {
  const claudeSettings = await readSettingsFile(CLAUDE_SETTINGS_PATH)
  const tcodeSettings = await readSettingsFile(TCODE_SETTINGS_PATH)
  return mergeSettings(claudeSettings, tcodeSettings)
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
    sourceSummary: `config: ${TCODE_SETTINGS_PATH} > ${CLAUDE_SETTINGS_PATH} > process.env`,
  }
}
