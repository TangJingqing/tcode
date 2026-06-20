import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createTwoFilesPatch } from 'diff'
import type { ToolContext, ToolResult } from './tool.js'

export function buildUnifiedDiff(
  filePath: string,
  before: string,
  after: string,
): string {
  if (before === after) {
    return `(no changes for ${filePath})`
  }

  const raw = createTwoFilesPatch(
    `a/${filePath}`,
    `b/${filePath}`,
    before,
    after,
    '',
    '',
    { context: 3 },
  )

  // 去掉开头的分隔线，让终端审批界面的输出更紧凑。
  const lines = raw.split('\n')
  if (lines[0]?.startsWith('===')) {
    return lines.slice(1).join('\n')
  }
  return raw
}

export async function loadExistingFile(targetPath: string): Promise<string> {
  try {
    return await readFile(targetPath, 'utf8')
  } catch (error) {
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : ''

    if (code === 'ENOENT') {
      return ''
    }

    throw error
  }
}

export async function applyReviewedFileChange(
  context: ToolContext,
  filePath: string,
  targetPath: string,
  nextContent: string,
): Promise<ToolResult> {
  const previousContent = await loadExistingFile(targetPath)
  if (previousContent === nextContent) {
    return {
      ok: true,
      output: `No changes needed for ${filePath}`,
    }
  }

  const diff = buildUnifiedDiff(filePath, previousContent, nextContent)
  await context.permissions?.ensureEdit(targetPath, diff)

  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, nextContent, 'utf8')

  return {
    ok: true,
    output: `Applied reviewed changes to ${filePath}`,
  }
}
