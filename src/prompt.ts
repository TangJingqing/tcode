import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

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
  ]

  if (permissionSummary.length > 0) {
    parts.push(`权限上下文:\n${permissionSummary.join('\n')}`)
  }

  if (globalClaudeMd) {
    parts.push(`来自 ~/.claude/CLAUDE.md 的全局指令:\n${globalClaudeMd}`)
  }

  if (projectClaudeMd) {
    parts.push(`来自 ${path.join(cwd, 'CLAUDE.md')} 的项目指令:\n${projectClaudeMd}`)
  }

  return parts.join('\n\n')
}
