import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ToolContext, ToolResult } from './tool.js'

function clampLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) {
    return lines
  }

  return [
    ...lines.slice(0, maxLines),
    `... (${lines.length - maxLines} more line(s))`,
  ]
}

export function buildUnifiedDiff(
  filePath: string,
  before: string,
  after: string,
): string {
  if (before === after) {
    return `(no changes for ${filePath})`
  }

  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')

  let prefix = 0
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1
  }

  let beforeSuffix = beforeLines.length - 1
  let afterSuffix = afterLines.length - 1
  while (
    beforeSuffix >= prefix &&
    afterSuffix >= prefix &&
    beforeLines[beforeSuffix] === afterLines[afterSuffix]
  ) {
    beforeSuffix -= 1
    afterSuffix -= 1
  }

  const removed = beforeLines.slice(prefix, beforeSuffix + 1)
  const added = afterLines.slice(prefix, afterSuffix + 1)

  const hunk = [
    `@@ -${prefix + 1},${Math.max(removed.length, 0)} +${prefix + 1},${Math.max(added.length, 0)} @@`,
    ...clampLines(removed, 80).map(line => `-${line}`),
    ...clampLines(added, 80).map(line => `+${line}`),
  ]

  return [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    ...hunk,
  ].join('\n')
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
