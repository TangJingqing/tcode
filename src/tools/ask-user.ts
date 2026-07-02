import { z } from 'zod'
import type { ToolDefinition } from '../tool.js'

type Input = {
  question: string
}

export const askUserTool: ToolDefinition<Input> = {
  name: 'ask_user',
  description:
    '向用户提出澄清问题，并暂停当前回合直到用户回复。',
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: '要询问用户的问题。' },
    },
    required: ['question'],
  },
  schema: z.object({
    question: z.string().min(1),
  }),
  async run(input) {
    const question = input.question.trim()
    return {
      ok: true,
      output: question,
      awaitUser: true,
    }
  },
}
