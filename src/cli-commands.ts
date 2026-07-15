import {
  CLAUDE_SETTINGS_PATH,
  TCODE_MCP_PATH,
  TCODE_PERMISSIONS_PATH,
  TCODE_SETTINGS_PATH,
  loadRuntimeConfig,
  saveTcodeSettings,
} from './config.js'
import type { ToolRegistry } from './tool.js'
import type { TraceStatus } from './tracing.js'
import { initializeRepo, renderInitReport } from './init.js'
import { discoverInstructionFiles, renderMemoryReport } from './memory.js'

export type SlashCommand = {
  name: string
  usage: string
  description: string
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: '/help',
    usage: '/help',
    description: 'Show available slash commands.',
  },
  {
    name: '/tools',
    usage: '/tools',
    description: 'List tools available to the coding agent and tool shortcuts.',
  },
  {
    name: '/status',
    usage: '/status',
    description: 'Show current model and config source.',
  },
  {
    name: '/model',
    usage: '/model',
    description: 'Show the current model.',
  },
  {
    name: '/model',
    usage: '/model <model-name>',
    description: 'Persist a model override into ~/.tcode/settings.json.',
  },
  {
    name: '/config-paths',
    usage: '/config-paths',
    description: 'Show tcode and Claude fallback settings paths.',
  },
  {
    name: '/skills',
    usage: '/skills',
    description: 'List discovered SKILL.md workflows.',
  },
  {
    name: '/mcp',
    usage: '/mcp',
    description: 'Show configured MCP servers and connection state.',
  },
  {
    name: '/permissions',
    usage: '/permissions',
    description: 'Show tcode permission storage path.',
  },
  {
    name: '/trace',
    usage: '/trace',
    description: 'Show agent loop trace status and output path.',
  },
  {
    name: '/compact',
    usage: '/compact',
    description: 'Compress conversation context to free up context window space.',
  },
  {
    name: '/init',
    usage: '/init',
    description: 'Create .tcode/, .gitignore entries, and MINI.md in the current project (idempotent).',
  },
  {
    name: '/memory',
    usage: '/memory',
    description: 'Show instruction files loaded into the system prompt.',
  },
  {
    name: '/resume',
    usage: '/resume',
    description: 'Resume a saved session (interactive picker, or /resume <id>).',
  },
  {
    name: '/rename',
    usage: '/rename <name>',
    description: 'Rename the current session.',
  },
  {
    name: '/new',
    usage: '/new',
    description: 'Clear saved session and start fresh.',
  },
  {
    name: '/fork',
    usage: '/fork',
    description: 'Fork current session into a new independent session.',
  },
  {
    name: '/exit',
    usage: '/exit',
    description: 'Exit tcode.',
  },
  {
    name: '/ls',
    usage: '/ls [path]',
    description: 'List files in a directory.',
  },
  {
    name: '/grep',
    usage: '/grep <pattern>::[path]',
    description: 'Search text in files.',
  },
  {
    name: '/read',
    usage: '/read <path>',
    description: 'Read a file directly.',
  },
  {
    name: '/write',
    usage: '/write <path>::<content>',
    description: 'Write a file directly.',
  },
  {
    name: '/modify',
    usage: '/modify <path>::<content>',
    description: 'Replace a file, showing a reviewable diff before applying it.',
  },
  {
    name: '/edit',
    usage: '/edit <path>::<search>::<replace>',
    description: 'Edit a file by exact replacement.',
  },
  {
    name: '/patch',
    usage: '/patch <path>::<search1>::<replace1>::<search2>::<replace2>...',
    description: 'Apply multiple replacements to one file in one command.',
  },
  {
    name: '/cmd',
    usage: '/cmd [cwd::]<command> [args...]',
    description: 'Run an allowed development command directly, optionally in another directory.',
  },
]

export function formatSlashCommands(): string {
  return SLASH_COMMANDS.map(command => `${command.usage}  ${command.description}`).join('\n')
}

export function findMatchingSlashCommands(input: string): string[] {
  return SLASH_COMMANDS
    .map(command => command.usage)
    .filter(command => command.startsWith(input))
}

export async function tryHandleLocalCommand(
  input: string,
  context?: {
    cwd?: string
    tools?: ToolRegistry
    trace?: TraceStatus
  },
): Promise<string | null> {
  const cwd = context?.cwd ?? process.cwd()

  if (input === '/') {
    return formatSlashCommands()
  }

  if (input === '/help') {
    return formatSlashCommands()
  }

  if (input === '/config-paths') {
    return [
      `tcode settings: ${TCODE_SETTINGS_PATH}`,
      `tcode permissions: ${TCODE_PERMISSIONS_PATH}`,
      `tcode mcp: ${TCODE_MCP_PATH}`,
      `claude fallback: ${CLAUDE_SETTINGS_PATH}`,
    ].join('\n')
  }

  if (input === '/permissions') {
    return `permission store: ${TCODE_PERMISSIONS_PATH}`
  }

  if (input === '/trace') {
    const trace = context?.trace
    if (!trace?.enabled) {
      return 'trace: disabled. Set TCODE_TRACE=1 or trace.enabled=true to enable agent loop tracing.'
    }

    return [
      `trace: enabled`,
      `langfuse: ${trace.langfuseEnabled ? (trace.langfuseStatus ?? 'enabled') : 'disabled'}`,
      trace.langfuseUrl ? `langfuse url: ${trace.langfuseUrl}` : undefined,
    ].filter(Boolean).join('\n')
  }

  if (input === '/skills') {
    const skills = context?.tools?.getSkills() ?? []
    if (skills.length === 0) {
      return 'No skills discovered. Add skills under ~/.tcode/skills/<name>/SKILL.md, .tcode/skills/<name>/SKILL.md, .claude/skills/<name>/SKILL.md, or ~/.claude/skills/<name>/SKILL.md.'
    }

    return skills
      .map(
        skill =>
          `${skill.name}  ${skill.description}  [${skill.source}]`,
      )
      .join('\n')
  }

  if (input === '/mcp') {
    const servers = context?.tools?.getMcpServers() ?? []
    if (servers.length === 0) {
      return 'No MCP servers configured. Add mcpServers to ~/.tcode/settings.json, ~/.tcode/mcp.json, or project .mcp.json.'
    }

    return servers
      .map(server => {
        const suffix = server.error ? `  error=${server.error}` : ''
        const protocol = server.protocol ? `  protocol=${server.protocol}` : ''
        const resources =
          server.resourceCount !== undefined
            ? `  resources=${server.resourceCount}`
            : ''
        const prompts =
          server.promptCount !== undefined
            ? `  prompts=${server.promptCount}`
            : ''
        return `${server.name}  status=${server.status}  tools=${server.toolCount}${resources}${prompts}${protocol}${suffix}`
      })
      .join('\n')
  }

  if (input === '/status') {
    const runtime = await loadRuntimeConfig()
    const trace = context?.trace
    return [
      `model: ${runtime.model}`,
      `baseUrl: ${runtime.baseUrl}`,
      `auth: ${runtime.authToken ? 'ANTHROPIC_AUTH_TOKEN' : 'ANTHROPIC_API_KEY'}`,
      `mcp servers: ${Object.keys(runtime.mcpServers).length}`,
      trace
        ? `trace: ${trace.enabled ? 'enabled' : 'disabled'}`
        : 'trace: unavailable',
      runtime.sourceSummary,
    ].join('\n')
  }

  if (input === '/init') {
    const report = await initializeRepo(cwd)
    return renderInitReport(report)
  }

  if (input === '/memory') {
    const files = await discoverInstructionFiles(cwd)
    return renderMemoryReport(files, cwd)
  }

  if (input === '/model') {
    const runtime = await loadRuntimeConfig()
    return `current model: ${runtime.model}`
  }

  if (input.startsWith('/model ')) {
    const model = input.slice('/model '.length).trim()
    if (!model) {
      return '用法: /model <model-name>'
    }

    await saveTcodeSettings({ model })
    return `saved model=${model} to ${TCODE_SETTINGS_PATH}`
  }

  return null
}

export function completeSlashCommand(line: string): [string[], string] {
  const hits = SLASH_COMMANDS
    .map(command => command.usage)
    .filter(command => command.startsWith(line))

  return [hits.length > 0 ? hits : SLASH_COMMANDS.map(command => command.usage), line]
}
