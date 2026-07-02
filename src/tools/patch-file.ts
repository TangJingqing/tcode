import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { applyReviewedFileChange } from '../file-review.js'
import type { ToolDefinition } from '../tool.js'
import { resolveToolPath } from '../workspace.js'

type Replacement = {
  search: string
  replace: string
  replaceAll?: boolean
}

type Input = {
  path: string
  replacements: Replacement[]
}

export const patchFileTool: ToolDefinition<Input> = {
  name: 'patch_file',
  description: '在单次操作中对一个文件应用多个精确文本替换。',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '要修改的文件路径。' },
      replacements: {
        type: 'array',
        description: '要依次应用的替换列表。',
        items: {
          type: 'object',
          properties: {
            search: { type: 'string', description: '要查找的精确原文。' },
            replace: { type: 'string', description: '用于替换的新文本。' },
            replaceAll: { type: 'boolean', description: '是否替换所有匹配项，默认只替换第一个。' },
          },
          required: ['search', 'replace'],
        },
      },
    },
    required: ['path', 'replacements'],
  },
  schema: z.object({
    path: z.string().min(1),
    replacements: z.array(
      z.object({
        search: z.string().min(1),
        replace: z.string(),
        replaceAll: z.boolean().optional(),
      }),
    ).min(1),
  }),
  async run(input, context) {
    const target = await resolveToolPath(context, input.path, 'write')
    let content = await readFile(target, 'utf8')
    const applied: string[] = []

    for (const [index, replacement] of input.replacements.entries()) {
      if (!content.includes(replacement.search)) {
        return {
          ok: false,
          output: `Replacement ${index + 1} not found in ${input.path}`,
        }
      }

      content = replacement.replaceAll
        ? content.split(replacement.search).join(replacement.replace)
        : content.replace(replacement.search, replacement.replace)

      applied.push(
        replacement.replaceAll
          ? `#${index + 1} replaceAll`
          : `#${index + 1} replaceOnce`,
      )
    }

    const result = await applyReviewedFileChange(context, input.path, target, content)
    if (!result.ok) {
      return result
    }

    return {
      ok: true,
      output: `Patched ${input.path} with ${applied.length} replacement(s): ${applied.join(', ')}`,
    }
  },
}
