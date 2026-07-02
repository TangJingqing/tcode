import { z } from 'zod'
import type { ToolDefinition } from '../tool.js'
import { fetchWebPage } from '../utils/web.js'

type Input = {
  url: string
  max_chars?: number
}

export const webFetchTool: ToolDefinition<Input> = {
  name: 'web_fetch',
  description:
    '抓取网页并提取可读文本内容。需要某个具体页面的完整内容时，可在 web_search 之后使用。',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '要抓取的 HTTP 或 HTTPS URL。' },
      max_chars: {
        type: 'number',
        description: '最多返回多少个页面内容字符，默认 12000。',
      },
    },
    required: ['url'],
  },
  schema: z.object({
    url: z.string().url(),
    max_chars: z.number().int().min(500).optional(),
  }),
  async run(input) {
    try {
      const maxChars = input.max_chars ?? 12000
      const result = await fetchWebPage({ url: input.url, maxChars })

      if (result.status >= 400) {
        return {
          ok: false,
          output: `HTTP ${result.status} ${result.statusText}: ${input.url}`,
        }
      }

      const lines: string[] = [
        `URL: ${result.finalUrl}`,
        `STATUS: ${result.status}`,
        `CONTENT_TYPE: ${result.contentType}`,
      ]
      if (result.title) {
        lines.push(`TITLE: ${result.title}`)
      }
      lines.push('', result.content)

      return {
        ok: true,
        output: lines.join('\n'),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        output: `Web fetch failed: ${message}`,
      }
    }
  },
}
