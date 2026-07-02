import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { applyReviewedFileChange } from '../file-review.js'
import type { ToolDefinition } from '../tool.js'
import { resolveToolPath } from '../workspace.js'

type Input = {
  path: string
  search: string
  replace: string
  replaceAll?: boolean
}

export const editFileTool: ToolDefinition<Input> = {
  name: 'edit_file',
  description: '通过精确文本替换来编辑文本文件。',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '要编辑的文件路径。' },
      search: { type: 'string', description: '要查找的精确原文。' },
      replace: { type: 'string', description: '用于替换的新文本。' },
      replaceAll: { type: 'boolean', description: '是否替换所有匹配项，默认只替换第一个。' },
    },
    required: ['path', 'search', 'replace'],
  },
  schema: z.object({
    path: z.string().min(1),
    search: z.string().min(1),
    replace: z.string(),
    replaceAll: z.boolean().optional(),
  }),
  async run(input, context) {
    const target = await resolveToolPath(context, input.path, 'write')
    const original = await readFile(target, 'utf8')

    if (!original.includes(input.search)) {
      return {
        ok: false,
        output: `Text not found in ${input.path}`,
      }
    }

    const next = input.replaceAll
      ? original.split(input.search).join(input.replace)
      : original.replace(input.search, input.replace)

    return applyReviewedFileChange(context, input.path, target, next)
  },
}
