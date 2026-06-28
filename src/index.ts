import readline from 'node:readline'
import process from 'node:process'
import { AnthropicModelAdapter } from './anthropic-adapter.js'
import {
  completeSlashCommand,
  findMatchingSlashCommands,
  tryHandleLocalCommand,
} from './cli-commands.js'
import { loadRuntimeConfig } from './config.js'
import { maybeHandleManagementCommand } from './manage-cli.js'
import { MockModelAdapter } from './mock-model.js'
import { PermissionManager } from './permissions.js'
import { buildSystemPrompt } from './prompt.js'
import { createDefaultToolRegistry } from './tools/index.js'
import type { ChatMessage } from './types.js'
import { renderBanner } from './ui.js'
import { runTtyApp } from './tty-app.js'
import { runAgentTurn } from './agent-loop.js'
import { createAgentTracer, resolveTraceConfig } from './tracing.js'

async function main(): Promise<void> {
  const isInteractiveTerminal = Boolean(process.stdin.isTTY && process.stdout.isTTY)

  const argv = process.argv.slice(2)
  if (await maybeHandleManagementCommand(process.cwd(), argv)) {
    return
  }

  let runtime = null
  try {
    runtime = await loadRuntimeConfig()
  } catch {
    runtime = null
  }

  const tools = await createDefaultToolRegistry({
    cwd: process.cwd(),
    runtime,
  })
  const permissions = new PermissionManager(process.cwd())
  await permissions.whenReady()
  const traceSettings = runtime?.trace
  const tracer = createAgentTracer({
    config: resolveTraceConfig(
      traceSettings
        ? {
            ...traceSettings,
            langfuse: traceSettings.langfuse
              ? {
                  ...traceSettings.langfuse,
                  enabled: traceSettings.langfuse.enabled ?? false,
                }
              : undefined,
          }
        : undefined,
    ),
  })
  const model =
    process.env.TCODE_MODEL_MODE === 'mock'
      ? new MockModelAdapter()
      : new AnthropicModelAdapter(tools, loadRuntimeConfig)
  let messages: ChatMessage[] = [
    {
      role: 'system',
      content: await buildSystemPrompt(process.cwd(), permissions.getSummary(), {
        skills: tools.getSkills(),
        mcpServers: tools.getMcpServers(),
      }),
    },
  ]

  try {
    if (isInteractiveTerminal) {
      await runTtyApp({
        runtime,
        tools,
        model,
        messages,
        cwd: process.cwd(),
        permissions,
        tracer,
      })
      return
    }

    console.log(renderBanner(runtime, process.cwd(), permissions.getSummary()))
    console.log('')

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer: completeSlashCommand,
    })

    for await (const rawInput of rl) {
      const input = rawInput.trim()
      if (!input) {
        continue
      }
      if (input === '/exit') break

      try {
        if (input === '/tools') {
          console.log(
            `\n${tools.list().map(tool => `${tool.name}: ${tool.description}`).join('\n')}\n`,
          )
          continue
        }

        const localCommandResult = await tryHandleLocalCommand(input, {
          tools,
          trace: tracer.getStatus(),
        })
        if (localCommandResult !== null) {
          console.log(`\n${localCommandResult}\n`)
          continue
        }

        if (input.startsWith('/')) {
          const matches = findMatchingSlashCommands(input)
          if (matches.length > 0) {
            console.log(`\n未识别命令。你是不是想输入：\n${matches.join('\n')}\n`)
          } else {
            console.log(`\n未识别命令。输入 /help 查看可用命令。\n`)
          }
          continue
        }
      } catch (error) {
        console.log(
          `\n${error instanceof Error ? error.message : String(error)}\n`,
        )
        continue
      }

      messages[0] = {
        role: 'system',
        content: await buildSystemPrompt(process.cwd(), permissions.getSummary(), {
          skills: tools.getSkills(),
          mcpServers: tools.getMcpServers(),
        }),
      }
      messages = [...messages, { role: 'user', content: input }]
      permissions.beginTurn()
      try {
        messages = await runAgentTurn({
          model,
          tools,
          messages,
          cwd: process.cwd(),
          permissions,
          maxSteps: 8,
          tracer,
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error)
        messages = [
          ...messages,
          {
            role: 'assistant',
            content: `请求失败: ${message}`,
          },
        ]
      } finally {
        permissions.endTurn()
      }

      const lastAssistant = [...messages]
        .reverse()
        .find(message => message.role === 'assistant')

      if (lastAssistant?.role === 'assistant') {
        console.log(`\n${lastAssistant.content}\n`)
      }
    }

    try {
      rl.close()
    } catch {
      // 在输入结束的收尾阶段忽略重复关闭。
    }
  } finally {
    await tracer.flush()
    await tools.dispose()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
