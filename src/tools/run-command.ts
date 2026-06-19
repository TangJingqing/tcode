import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { ToolDefinition } from '../tool.js'
import { resolveToolPath } from '../workspace.js'

const execFileAsync = promisify(execFile)

const ALLOWLIST = new Set([
  'pwd',
  'ls',
  'find',
  'rg',
  'cat',
  'git',
  'npm',
  'node',
  'python3',
  'pytest',
  'bun',
  'sed',
  'head',
  'tail',
  'wc',
])

type Input = {
  command: string
  args?: string[]
  cwd?: string
}

export const runCommandTool: ToolDefinition<Input> = {
  name: 'run_command',
  description: 'Run a common development command from an allowlist.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      args: {
        type: 'array',
        items: { type: 'string' },
      },
      cwd: { type: 'string' },
    },
    required: ['command'],
  },
  schema: z.object({
    command: z.string(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
  }),
  async run(input, context) {
    if (!ALLOWLIST.has(input.command)) {
      return {
        ok: false,
        output: `Command not allowed: ${input.command}`,
      }
    }

    const effectiveCwd = input.cwd
      ? await resolveToolPath(context, input.cwd, 'list')
      : context.cwd

    await context.permissions?.ensureCommand(
      input.command,
      input.args ?? [],
      effectiveCwd,
    )

    const result = await execFileAsync(input.command, input.args ?? [], {
      cwd: effectiveCwd,
      maxBuffer: 1024 * 1024,
    })

    return {
      ok: true,
      output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim(),
    }
  },
}
