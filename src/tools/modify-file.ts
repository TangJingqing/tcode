import { z } from 'zod'
import { applyReviewedFileChange } from '../file-review.js'
import type { ToolDefinition } from '../tool.js'
import { resolveToolPath } from '../workspace.js'

type Input = {
  path: string
  content: string
}

export const modifyFileTool: ToolDefinition<Input> = {
  name: 'modify_file',
  description: '用完整内容替换文件，并先展示 diff 供用户审批。',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '要修改的文件路径。' },
      content: { type: 'string', description: '替换后的完整文件内容。' },
    },
    required: ['path', 'content'],
  },
  schema: z.object({
    path: z.string().min(1),
    content: z.string(),
  }),
  async run(input, context) {
    const target = await resolveToolPath(context, input.path, 'write')
    return applyReviewedFileChange(context, input.path, target, input.content)
  },
}
