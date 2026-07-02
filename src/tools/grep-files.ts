import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { ToolDefinition } from '../tool.js'
import { resolveToolPath } from '../workspace.js'

const execFileAsync = promisify(execFile)

type Input = {
  pattern: string
  path?: string
}

export const grepFilesTool: ToolDefinition<Input> = {
  name: 'grep_files',
  description: '使用 ripgrep 在文件中搜索文本。',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: '要搜索的文本或正则表达式。' },
      path: { type: 'string', description: '搜索范围路径，默认当前工作区。' },
    },
    required: ['pattern'],
  },
  schema: z.object({
    pattern: z.string().min(1),
    path: z.string().optional(),
  }),
  async run(input, context) {
    const args = ['-n', '--no-heading', input.pattern]
    if (input.path) {
      args.push(await resolveToolPath(context, input.path, 'search'))
    } else {
      args.push('.')
    }

    const result = await execFileAsync('rg', args, {
      cwd: context.cwd,
      maxBuffer: 1024 * 1024,
    })

    return {
      ok: true,
      output: (result.stdout || result.stderr || '').trim() || '(no matches)',
    }
  },
}
