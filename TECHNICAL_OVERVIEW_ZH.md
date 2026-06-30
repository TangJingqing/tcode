# tcode 技术说明文档

## 1. 项目概述

`tcode` 是一个轻量级终端编码助手 CLI。它的核心目标不是复刻完整 IDE agent 平台，而是在终端里实现一条可理解、可审计、可扩展的 coding agent 闭环：

1. 接收用户自然语言输入
2. 将上下文和工具定义发送给模型
3. 模型决定是否调用本地工具
4. 本地执行读文件、改文件、搜索、跑命令等操作
5. 将工具结果回传给模型
6. 模型输出最终答复

项目使用 TypeScript 编写，运行在 Node.js 20+ 环境中。依赖保持克制，核心运行时使用 `zod` 做工具入参校验，使用 `diff` 生成文件修改预览，并可选接入 Langfuse / OpenTelemetry 做 agent tracing。终端 UI 没有引入 React/Ink，而是直接使用 ANSI 控制序列和原生 stdin/stdout 实现。

## 2. 启动与入口

项目的命令入口定义在 `package.json`：

- `bin/tcode`：npm bin 入口，用于启动 CLI。
- `npm start`：开发模式下通过 `tsx src/index.ts` 运行。
- `npm run install-cli`：执行安装脚本，将 launcher 写入本机可执行路径。

主入口是 `src/index.ts`。启动时会完成以下初始化：

1. 调用 `loadRuntimeConfig()` 读取模型配置。
2. 调用 `createDefaultToolRegistry()` 注册内置工具。
3. 创建 `PermissionManager`，加载路径、命令、编辑相关权限。
4. 根据运行时 trace 配置创建 `AgentTracer`。
5. 根据 `TCODE_MODEL_MODE` 选择真实模型适配器或 Mock 适配器。
6. 调用 `buildSystemPrompt()` 构造 system prompt。
7. 根据当前是否为 TTY 终端，选择全屏 TUI 模式或普通 readline 模式。

整体启动链路如下：

```mermaid
flowchart TD
  A[bin/tcode] --> B[src/index.ts]
  B --> C[loadRuntimeConfig]
  B --> D[createDefaultToolRegistry]
  B --> E[PermissionManager]
  B --> F[createAgentTracer]
  B --> G{TCODE_MODEL_MODE}
  G -->|mock| H[MockModelAdapter]
  G -->|default| I[AnthropicModelAdapter]
  B --> J{stdin/stdout 是否为 TTY}
  J -->|是| K[runTtyApp]
  J -->|否| L[readline loop]
```

## 3. 配置体系

配置相关代码集中在 `src/config.ts`。

`tcode` 使用 `~/.tcode` 作为自己的本地数据目录，当前包含：

- `settings.json`：模型、环境变量等运行配置。
- `mcp.json`：用户级 MCP server 配置。
- `permissions.json`：用户持久化批准或拒绝的权限规则。
- `history.json`：TUI 输入历史。

配置加载时会合并三类来源：

1. `~/.claude/settings.json`
2. `~/.tcode/mcp.json`
3. 项目级 `.mcp.json`
4. `~/.tcode/settings.json`
5. 当前进程环境变量 `process.env`

其中 `~/.tcode/settings.json` 会覆盖兼容配置，进程环境变量优先级最高。运行时主要读取：

- `TCODE_MODEL` 或 `ANTHROPIC_MODEL`：模型名称。
- `ANTHROPIC_BASE_URL`：Anthropic 兼容接口地址，默认是 `https://api.anthropic.com`。
- `ANTHROPIC_AUTH_TOKEN` 或 `ANTHROPIC_API_KEY`：认证信息。
- `TCODE_MODEL_MODE=mock`：启用本地 Mock 模型。
- `TCODE_MAX_OUTPUT_TOKENS`：覆盖模型最大输出 token。
- `TCODE_TRACE=1`：启用 agent tracing。
- `TCODE_TRACE_LANGFUSE=1`：启用 Langfuse 导出。

## 4. 交互模式

### 4.1 TUI 模式

当 stdin 和 stdout 都是 TTY 时，程序进入 `src/tty-app.ts` 实现的全屏 TUI。

TUI 启动后会进入 alternate screen，开启 raw mode，并接管键盘输入。界面状态由 `ScreenState` 管理，主要包括：

- 当前输入框内容和光标位置
- transcript 对话记录
- transcript 滚动位置
- slash 命令菜单状态
- 当前运行中的工具
- 最近执行的工具结果
- 输入历史
- 等待用户确认的权限请求

渲染逻辑由 `renderScreen()` 统一调度，当前采用参考 MiniCode 的卡片式布局：

1. `header`：展示项目、provider、model、messages、events、skills、mcp 等会话信息。
2. `session feed`：按固定面板高度展示 transcript，并支持滚动。
3. `prompt`：展示快捷键提示、`tcode>` 输入框和 slash 命令菜单。
4. `footer`：展示当前状态，以及 tools / skills 是否可用。
5. `approval`：当需要用户确认时展示权限审批面板。
6. `activity`：审批期间展示当前工具和最近工具结果。

底层 UI 组件位于 `src/tui/*`：

- `screen.ts`：清屏、切换 alternate screen、光标显示隐藏。
- `transcript.ts`：渲染用户、助手、progress、工具消息，并根据面板高度计算滚动窗口。
- `input.ts`：渲染输入框、快捷键提示和光标。
- `chrome.ts`：渲染 banner、panel、footer、工具面板、slash 菜单、权限弹窗。
- `markdown.ts`：对 assistant 输出做简易 markdown 着色。
- `input-parser.ts`：解析按键、组合键、滚轮等输入事件。

### 4.2 readline 模式

当程序运行在非 TTY 环境中时，会进入普通 readline 循环。这种模式适合脚本或管道场景。

readline 模式仍然走同一套 Agent Loop、工具系统和 tracing 系统，但没有全屏 UI，也无法弹出交互式权限审批。因此需要审批的 cwd 外路径、危险命令、文件编辑等操作会直接失败，并提示用户在 TTY 模式下批准。

## 5. Agent 主循环

Agent 主循环位于 `src/agent-loop.ts`，核心函数是 `runAgentTurn()`。

它接收当前消息列表、模型适配器、工具注册表、cwd、权限管理器等参数，然后在最多 `maxSteps` 步内循环执行：

1. 调用 `model.next(messages, context)` 请求模型。
2. 如果模型返回 assistant 文本，当前回合结束。
3. 如果模型返回工具调用，逐个执行工具。
4. 将工具调用和工具结果追加进消息列表。
5. 带着新的消息列表继续请求模型。
6. 达到最大步数后停止，返回限制提示。

内部消息类型定义在 `src/types.ts`，主要有：

- `system`：系统提示词。
- `user`：用户输入。
- `assistant`：模型文本回复。
- `assistant_progress`：模型或 loop 产生的进度消息。
- `assistant_tool_call`：模型发起的工具调用。
- `tool_result`：本地工具执行结果。

一次自然语言请求的典型链路如下：

```mermaid
sequenceDiagram
  participant User as 用户
  participant App as TUI/readline
  participant Loop as runAgentTurn
  participant Model as ModelAdapter
  participant Tools as ToolRegistry
  participant Perm as PermissionManager

  User->>App: 输入需求
  App->>Loop: 传入 messages
  Loop->>Model: next(messages, context)
  Model-->>Loop: 返回 tool_calls 或 assistant
  alt 返回工具调用
    Loop->>Tools: execute(toolName, input)
    Tools->>Perm: 检查路径/命令/编辑权限
    Perm-->>Tools: 允许或拒绝
    Tools-->>Loop: tool_result
    Loop->>Model: 带工具结果继续请求
  else 返回最终文本
    Loop-->>App: assistant message
    App-->>User: 渲染/打印回复
  end
```

`runAgentTurn()` 还实现了轻量的进度续跑和空响应恢复机制：当模型在使用工具后只返回进度说明，或在 thinking / pause_turn / max_tokens 等情况下没有产出可执行结果时，loop 会追加内部 continuation prompt，要求模型继续执行下一步，直到得到工具调用或明确的最终答复。这个过程会通过 `AgentTracer` 记录关键决策。

## 6. 模型适配

模型接口通过 `ModelAdapter` 抽象，统一暴露：

```ts
next(messages, context?): Promise<AgentStep>
```

当前有两个实现。

### 6.1 AnthropicModelAdapter

`src/anthropic-adapter.ts` 实现了 Anthropic Messages API 兼容适配。

它负责把内部消息结构转换成 Anthropic API 需要的格式：

- `system` 消息合并为 API 的 `system` 字段。
- `user` 和 `assistant` 文本转换为 text content block。
- `assistant_tool_call` 转换为 `tool_use` block。
- `tool_result` 转换为 user 侧的 `tool_result` block。

请求时会把工具注册表中的工具定义转换成 API 的 `tools` 字段，包括工具名称、描述和 JSON Schema 入参结构。

响应解析时：

- 如果返回 `tool_use` block，则转换为 `type: "tool_calls"`。
- 如果只返回 text block，则转换为 `type: "assistant"`。

因此上层 Agent Loop 不关心具体模型协议，只关心下一步是“输出文本”还是“调用工具”。

### 6.2 MockModelAdapter

`src/mock-model.ts` 提供本地 Mock 模型。开启方式是设置：

```sh
TCODE_MODEL_MODE=mock
```

Mock 模型主要用于无 API Key 或调试工具闭环时验证项目骨架。它会根据输入生成简单的工具调用或固定回复，收到工具结果后再包装成 assistant 文本返回。

## 7. Tracing

tcode 在 MiniCode 的轻量 agent 架构基础上，增加了可选 tracing。

核心代码位于 `src/tracing.ts`，主要负责：

- 为一次 CLI session 创建 trace。
- 为每个 agent turn 创建 span。
- 记录模型输入摘要、模型输出摘要、loop 决策、工具调用结果和错误。
- 根据配置决定是否导出到 Langfuse / OpenTelemetry。

Tracing 的配置来自 `~/.tcode/settings.json` 或环境变量：

```sh
TCODE_TRACE=1
TCODE_TRACE_LANGFUSE=1
```

交互界面和 readline 模式都可以通过 `/trace` 查看当前 tracing 状态。

## 8. 工具系统

工具协议定义在 `src/tool.ts`。

每个工具都是一个 `ToolDefinition`，包含：

- `name`：工具名，供模型调用。
- `description`：工具说明，发给模型。
- `inputSchema`：JSON Schema 形式的入参定义，发给模型。
- `schema`：Zod schema，用于本地运行前校验。
- `run()`：实际执行逻辑。

工具由 `ToolRegistry` 统一管理。执行工具时会按以下顺序处理：

1. 根据名称查找工具。
2. 使用 Zod 校验入参。
3. 调用工具自己的 `run()`。
4. 捕获异常并转换为统一的 `{ ok, output }`。

默认工具在 `src/tools/index.ts` 注册：

- `list_files`：列出目录内容。
- `grep_files`：按文本搜索文件。
- `read_file`：读取文件内容，支持 offset/limit 分块。
- `write_file`：写入文件。
- `modify_file`：替换整个文件内容。
- `edit_file`：基于 search/replace 精确编辑。
- `patch_file`：应用多段文本替换补丁。
- `run_command`：执行白名单内的本地命令。
- `load_skill`：读取并加载本地 `SKILL.md` 工作流说明。
- `list_mcp_resources` / `read_mcp_resource`：列出和读取 MCP resources。
- `list_mcp_prompts` / `get_mcp_prompt`：列出和读取 MCP prompts。

如果配置了 MCP server，远端 tools 会被动态注册成 `mcp__<server>__<tool>` 形式，进入同一个工具注册表。

路径解析逻辑位于 `src/workspace.ts`。工具访问文件前会将相对路径解析到 cwd 下；如果启用了权限管理器，则通过 `PermissionManager` 决定是否允许访问 cwd 外路径。

## 9. 文件修改实现

文件写入类工具不会直接静默覆盖文件，而是统一走 `src/file-review.ts` 中的写前 review 流程。

典型流程是：

1. 读取旧文件内容。
2. 计算新旧内容的 unified diff。
3. 调用 `permissions.ensureEdit(targetPath, diffPreview)`。
4. 在 TUI 中展示 diff 预览并等待用户确认。
5. 用户批准后再写入磁盘。

`write_file`、`modify_file`、`edit_file`、`patch_file` 都复用这条链路，只是生成目标内容的方式不同：

- `write_file` 直接使用模型提供的新内容。
- `modify_file` 用新内容替换整个文件。
- `edit_file` 要求旧文本唯一匹配后替换为新文本。
- `patch_file` 按多段 patch 顺序修改文件。

这样做的好处是：模型可以提出修改，但真正落盘前仍由用户通过 diff 做最终确认。

## 10. 命令执行实现

命令执行工具位于 `src/tools/run-command.ts`。

它不是任意 shell 执行器，而是有两层限制：

1. 工具层白名单：只允许执行明确列出的命令。
2. 权限层危险命令审批：对可能破坏本地状态或影响远端的命令追加确认。

权限层的危险命令检测在 `src/permissions.ts` 中实现，当前会特别识别：

- `git reset --hard`
- `git clean`
- `git checkout --`
- `git restore --source`
- `git push --force`
- `npm publish`
- `node`、`python3`、`bun` 等可执行任意本地代码的命令

如果用户选择“always allow”或“always deny”，结果会持久化到 `~/.tcode/permissions.json`。

## 11. 权限模型

权限系统由 `PermissionManager` 负责，代码位于 `src/permissions.ts`。

当前有三类权限：

1. `path`：访问 cwd 之外的目录或文件。
2. `command`：执行危险命令。
3. `edit`：应用文件修改。

路径和命令审批主要有四种决策：

- `allow_once`：本次允许。
- `allow_always`：持久化允许。
- `deny_once`：本次拒绝。
- `deny_always`：持久化拒绝。

编辑审批还额外支持：

- `allow_turn`：本轮允许当前文件。
- `allow_all_turn`：本轮允许全部编辑。
- `deny_with_feedback`：拒绝并把用户反馈回传给模型，让模型按反馈继续调整。

cwd 内路径默认允许，cwd 外路径默认需要审批。没有 TUI prompt handler 时，权限管理器不会擅自批准，而是直接抛出错误。

权限摘要会被注入 system prompt，让模型知道当前 cwd、额外允许目录、危险命令 allowlist、可信编辑目标等边界。

## 12. Slash 命令与本地快捷工具

Slash 命令定义在 `src/cli-commands.ts`。它们不经过模型，而是在本地直接处理，例如：

- `/help`：查看命令帮助。
- `/tools`：查看当前工具。
- `/skills`：查看当前发现的 skills。
- `/mcp`：查看 MCP server 连接状态。
- `/status`：查看当前状态。
- `/model`：查看模型配置。
- `/config-paths`：查看配置文件路径。
- `/permissions`：查看权限文件位置。
- `/trace`：查看 tracing 状态。

另有一组本地工具 shortcut 在 `src/local-tool-shortcuts.ts` 中解析，例如 `/ls`、`/grep`、`/read`、`/write`、`/modify`、`/edit`、`/patch`、`/cmd`。

这类 shortcut 会绕过模型，直接调用 `ToolRegistry.execute()`，适合用户明确知道自己要执行哪一个工具的场景。

## 13. 输入历史

输入历史由 `src/history.ts` 管理，只记录用户输入，不记录完整对话。

历史文件位于：

```text
~/.tcode/history.json
```

TUI 模式下，用户可以通过方向键或 Ctrl 组合键浏览历史输入。当前最多保留最近 200 条。

这意味着项目目前还没有完整的 session restore 能力，关闭终端后对话上下文不会恢复，只有输入历史会被保留。

## 14. System Prompt 构造

`src/prompt.ts` 负责构造 system prompt。它会包含：

- assistant 的行为准则
- 当前 cwd
- 权限摘要
- 可用 skills 摘要
- 已配置 MCP server 摘要
- 工具使用和结构化回复约束
- 可选的用户级或项目级 `CLAUDE.md` 内容

每轮用户输入前，入口层会重新构造 system prompt，从而让权限变化、skills 发现结果和 MCP 连接状态及时反映给模型。

## 15. 扩展方式

### 15.1 新增工具

新增工具通常需要三步：

1. 在 `src/tools/` 下新增一个工具文件，实现 `ToolDefinition`。
2. 使用 Zod 定义本地入参校验 schema，同时提供给模型使用的 `inputSchema`。
3. 在 `src/tools/index.ts` 中加入默认注册列表。

如果工具需要访问文件系统，应通过 `resolveToolPath()` 和 `PermissionManager` 复用现有路径边界。如果工具会修改文件，应复用 `applyReviewedFileChange()`，保证写前 diff review。

### 15.2 更换模型

如果目标模型兼容 Anthropic Messages API，只需要调整 `ANTHROPIC_BASE_URL`、认证信息和模型名称即可。

如果模型协议不同，可以新增一个 `ModelAdapter` 实现，把项目内部的 `ChatMessage[]` 转换成目标模型协议，再把响应转换回 `AgentStep`。

### 15.3 扩展 TUI

TUI 的渲染入口集中在 `renderScreen()`。当前主界面由 header、session feed、prompt、footer 组成，审批时切换到 approval + activity 面板。新增界面区域时，通常需要：

1. 扩展 `ScreenState`。
2. 在输入事件或 agent 回调中更新状态。
3. 在 `src/tui/*` 中新增渲染函数。
4. 在 `renderScreen()` 中加入对应组件。

## 16. 当前边界

项目目前刻意保持轻量，因此有一些明确边界：

- 没有完整会话持久化，只有输入历史。
- 没有 LSP、IDE bridge、remote session、多 agent 编排。
- 非 TTY 模式不能做交互式审批。
- 命令执行受白名单限制，不是通用 shell。
- TUI 是原生终端渲染，功能比完整 UI 框架更克制。
- 模型适配主要面向 Anthropic Messages API 及其兼容实现。
- tracing 是辅助观测能力，不替代完整会话持久化或回放系统。

这些边界让第一版实现保持简单，也让后续扩展点更清晰：先稳定 Agent Loop、工具协议、权限边界和 TUI 交互，再逐步增加更复杂的能力。

