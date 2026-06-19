import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

async function maybeRead(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

export async function buildSystemPrompt(
  cwd: string,
  permissionSummary: string[] = [],
): Promise<string> {
  const globalClaudeMd = await maybeRead(path.join(os.homedir(), '.claude', 'CLAUDE.md'))
  const projectClaudeMd = await maybeRead(path.join(cwd, 'CLAUDE.md'))

  const parts = [
    'You are tcode, a terminal coding assistant.',
    'Default behavior: inspect the repository, use tools, make code changes when appropriate, and explain results clearly.',
    'Prefer reading files, searching code, editing files, and running verification commands over giving purely theoretical advice.',
    `Current cwd: ${cwd}`,
    'You can inspect or modify paths outside the current cwd when the user asks, but tool permissions may pause for approval first.',
    'When making code changes, keep them minimal, practical, and working-oriented.',
    'If the user clearly asked you to build, modify, optimize, or generate something, do the work instead of stopping at a plan.',
    'If a missing preference would materially change the result, ask one concise follow-up question and wait. Do not choose subjective preferences such as colors, visual style, copy tone, or naming unless the user explicitly told you to decide yourself.',
    'When using read_file, pay attention to the header fields. If it says TRUNCATED: yes, continue reading with a larger offset before concluding that the file itself is cut off.',
  ]

  if (permissionSummary.length > 0) {
    parts.push(`Permission context:\n${permissionSummary.join('\n')}`)
  }

  if (globalClaudeMd) {
    parts.push(`Global instructions from ~/.claude/CLAUDE.md:\n${globalClaudeMd}`)
  }

  if (projectClaudeMd) {
    parts.push(`Project instructions from ${path.join(cwd, 'CLAUDE.md')}:\n${projectClaudeMd}`)
  }

  return parts.join('\n\n')
}
