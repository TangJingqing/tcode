import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { ToolDefinition } from '../tool.js'
import { resolveToolPath } from '../workspace.js'

type Input = {
  path: string
  offset?: number
  limit?: number
}

const DEFAULT_READ_LIMIT = 8000
const MAX_READ_LIMIT = 20000

export const readFileTool: ToolDefinition<Input> = {
  name: 'read_file',
  description:
    '读取相对于工作区根目录的 UTF-8 文本文件。大文件可通过 offset 和 limit 分块读取。',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '要读取的文件路径。' },
      offset: { type: 'number', description: '从第几个字符开始读取，默认 0。' },
      limit: { type: 'number', description: '最多返回多少个字符。' },
    },
    required: ['path'],
  },
  schema: z.object({
    path: z.string(),
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(MAX_READ_LIMIT).optional(),
  }),
  async run(input, context) {
    const target = await resolveToolPath(context, input.path, 'read')
    const content = await readFile(target, 'utf8')
    const offset = Math.max(0, input.offset ?? 0)
    const limit = Math.min(MAX_READ_LIMIT, input.limit ?? DEFAULT_READ_LIMIT)
    const end = Math.min(content.length, offset + limit)
    const chunk = content.slice(offset, end)
    const truncated = end < content.length
    const header = [
      `FILE: ${input.path}`,
      `OFFSET: ${offset}`,
      `END: ${end}`,
      `TOTAL_CHARS: ${content.length}`,
      truncated
        ? `TRUNCATED: yes - call read_file again with offset ${end}`
        : 'TRUNCATED: no',
      '',
    ].join('\n')

    return {
      ok: true,
      output: header + chunk,
    }
  },
}
