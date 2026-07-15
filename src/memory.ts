import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { TCODE_DIR } from './config.js'

export type ContextFile = {
  path: string
  content: string
}

const MAX_PER_FILE_CHARS = 8_000
const MAX_TOTAL_CHARS = 20_000

const CANDIDATES_PER_DIR = [
  'MINI.md',
  'MINI.local.md',
  path.join('.tcode', 'MINI.md'),
  'CLAUDE.md',
  'CLAUDE.local.md',
  path.join('.claude', 'CLAUDE.md'),
]

function contentHash(text: string): string {
  const normalized = text.trim()
  return createHash('sha256').update(normalized).digest('hex')
}

function truncateTo(text: string, limit: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= limit) return trimmed
  return trimmed.slice(0, limit) + '\n\n[truncated]'
}

async function tryRead(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath, 'utf8')
    return content.trim() ? content : null
  } catch {
    return null
  }
}

function dedupe(files: ContextFile[]): ContextFile[] {
  const result: ContextFile[] = []
  const seen = new Set<string>()
  // Walk in reverse so later (cwd) entries win
  for (let i = files.length - 1; i >= 0; i--) {
    const hash = contentHash(files[i].content)
    if (seen.has(hash)) continue
    seen.add(hash)
    result.unshift(files[i])
  }
  return result
}

export async function discoverInstructionFiles(
  cwd: string,
  homeDir?: string,
): Promise<ContextFile[]> {
  // Collect ancestor directories from root → cwd
  const dirs: string[] = []
  let cursor: string | undefined = cwd
  while (cursor) {
    dirs.push(cursor)
    cursor = path.dirname(cursor)
    if (cursor === dirs[dirs.length - 1]) break // reached root
  }
  dirs.reverse()

  const files: ContextFile[] = []

  // User global first
  const home = homeDir ?? TCODE_DIR
  const globalCandidates = [
    path.join(home, 'MINI.md'),
    path.join(home, 'CLAUDE.md'),
  ]
  for (const candidate of globalCandidates) {
    const content = await tryRead(candidate)
    if (content) {
      files.push({ path: candidate, content })
      break // only one global file
    }
  }

  // Then each ancestor directory
  for (const dir of dirs) {
    for (const name of CANDIDATES_PER_DIR) {
      const filePath = path.join(dir, name)
      const content = await tryRead(filePath)
      if (content) {
        files.push({ path: filePath, content })
      }
    }
  }

  return dedupe(files)
}

function renderScope(filePath: string): string {
  const base = path.basename(filePath)
  const dir = path.dirname(filePath)
  return `${base} (scope: ${dir})`
}

export async function loadMemory(cwd: string, homeDir?: string): Promise<string> {
  const files = await discoverInstructionFiles(cwd, homeDir)
  if (files.length === 0) return ''

  const sections: string[] = ['# Instructions']
  let remaining = MAX_TOTAL_CHARS

  for (const file of files) {
    if (remaining <= 0) {
      sections.push('_Additional instruction content omitted after reaching the prompt budget._')
      break
    }

    const truncated = truncateTo(file.content, Math.min(MAX_PER_FILE_CHARS, remaining))
    sections.push(`## ${renderScope(file.path)}\n\n${truncated}`)
    remaining -= truncated.length
  }

  return sections.join('\n\n')
}
