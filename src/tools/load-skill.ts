import { z } from 'zod'
import type { ToolDefinition } from '../tool.js'
import { loadSkill } from '../skills.js'

type Input = {
  name: string
}

export function createLoadSkillTool(cwd: string): ToolDefinition<Input> {
  return {
    name: 'load_skill',
    description:
      '加载指定 SKILL.md 的完整内容，以便准确遵循对应工作流。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '要加载的 skill 名称。' },
      },
      required: ['name'],
    },
    schema: z.object({
      name: z.string().min(1),
    }),
    async run(input) {
      const skill = await loadSkill(cwd, input.name)
      if (!skill) {
        return {
          ok: false,
          output: `Unknown skill: ${input.name}`,
        }
      }

      return {
        ok: true,
        output: [
          `SKILL: ${skill.name}`,
          `SOURCE: ${skill.source}`,
          `PATH: ${skill.path}`,
          '',
          skill.content,
        ].join('\n'),
      }
    },
  }
}
