import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { McpServerSummary } from './mcp.js'
import type { SkillSummary } from './skills.js'

async function maybeRead(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

export async function buildSystemPrompt(
  cwd: string,
  permissionSummary: string[] = [],
  extras?: {
    skills?: SkillSummary[]
    mcpServers?: McpServerSummary[]
  },
): Promise<string> {
  const globalClaudeMd = await maybeRead(path.join(os.homedir(), '.claude', 'CLAUDE.md'))
  const projectClaudeMd = await maybeRead(path.join(cwd, 'CLAUDE.md'))

  const parts = [
    '你是 tcode，一个运行在终端里的编码助手。',
    '默认行为：先理解仓库，主动使用工具，在合适的时候修改代码，并清晰说明结果。',
    '相比只给理论建议，你应优先读取文件、搜索代码、编辑文件，并运行必要的验证命令。',
    `当前 cwd: ${cwd}`,
    '当用户要求时，你可以查看或修改当前 cwd 之外的路径，但工具权限可能会先暂停并等待用户批准。',
    '修改代码时，保持改动最小、实用，并以可运行为目标。',
    '如果用户明确要求你构建、修改、优化或生成内容，请直接执行任务，不要停留在计划阶段。',
    '如果缺少某个偏好会实质性改变结果，请提出一个简短的追问并等待用户回答。除非用户明确让你自行决定，否则不要擅自选择颜色、视觉风格、文案语气或命名等主观偏好。',
    '使用 read_file 时，注意返回内容头部字段。如果显示 TRUNCATED: yes，请用更大的 offset 继续读取，不要误以为文件本身被截断。',
    '如果用户点名了某个 skill，或明确要求的工作流匹配下面列出的某个 skill，请先调用 load_skill 再按其内容执行。',
    '结构化回复协议：',
    '- 当你仍在工作、后续还会继续调用工具时，请让你的文本以 <progress> 开头。',
    '- 只有当任务确实完成、准备把控制权交还给用户时，才让文本以 <final> 开头。',
    '- 如果你要向用户提问澄清，请直接提问，不要使用 <final>。',
    '- 不要在进度更新后停下。发出 <progress> 消息后，请在下一步继续完成任务。',
    '- 在当前回合中一旦使用过任何工具，任何没有 <final> 标记的普通状态更新都可能被视为进度，智能体可能会自动继续。',
  ]

  if (permissionSummary.length > 0) {
    parts.push(`权限上下文:\n${permissionSummary.join('\n')}`)
  }

  const skills = extras?.skills ?? []
  if (skills.length > 0) {
    parts.push(
      `可用 skills:\n${skills
        .map(skill => `- ${skill.name}: ${skill.description}`)
        .join('\n')}`,
    )
  } else {
    parts.push('可用 skills:\n- 未发现任何 skill')
  }

  const mcpServers = extras?.mcpServers ?? []
  if (mcpServers.length > 0) {
    parts.push(
      `已配置的 MCP server:\n${mcpServers
        .map(server => {
          const suffix = server.error ? ` (${server.error})` : ''
          const protocol = server.protocol ? `, protocol=${server.protocol}` : ''
          const resources =
            server.resourceCount !== undefined
              ? `, resources=${server.resourceCount}`
              : ''
          const prompts =
            server.promptCount !== undefined
              ? `, prompts=${server.promptCount}`
              : ''
          return `- ${server.name}: ${server.status}, tools=${server.toolCount}${resources}${prompts}${protocol}${suffix}`
        })
        .join('\n')}`,
    )
    const connectedServers = mcpServers.filter(server => server.status === 'connected')
    if (connectedServers.length > 0) {
      parts.push(
        '已连接的 MCP 工具已经以 mcp__server__tool 形式出现在工具列表中。当某个 server 提供相应能力时，使用 list_mcp_resources/read_mcp_resource 和 list_mcp_prompts/get_mcp_prompt。',
      )
    }
  }

  if (globalClaudeMd) {
    parts.push(`来自 ~/.claude/CLAUDE.md 的全局指令:\n${globalClaudeMd}`)
  }

  if (projectClaudeMd) {
    parts.push(`来自 ${path.join(cwd, 'CLAUDE.md')} 的项目指令:\n${projectClaudeMd}`)
  }

  return parts.join('\n\n')
}
