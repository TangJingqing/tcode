# tcode 详细使用指南

[返回 README](./README.zh-CN.md) | [English](./USAGE.md)

本文档承接 README 中偏操作手册的内容：完整命令参考、长会话机制、配置说明、Skills/MCP 用法、项目结构和代码规模。主 README 只保留项目入口和核心介绍。

## 目录

- [功能细节](#功能细节)
- [安装细节](#安装细节)
- [快速开始](#快速开始)
- [命令](#命令)
- [分层 Memory 与项目初始化](#分层-memory-与项目初始化)
- [长会话与上下文管理](#长会话与上下文管理)
- [配置](#配置)
- [Skills 与 MCP 用法](#skills-与-mcp-用法)
- [Tracing](#tracing)
- [项目结构](#项目结构)
- [代码规模](#代码规模)
- [开发说明](#开发说明)

## 功能细节

### 核心工作流

- 单轮内支持多步工具调用，形成 `model -> tool -> model` 闭环
- 全屏卡片式终端界面，包含 header、session feed、prompt、approval、activity 和 footer 面板
- 输入历史、transcript 滚动、slash 命令菜单和审批交互
- 按项目隔离的会话持久化，支持恢复、重命名、分叉和压缩
- 模型感知的上下文统计，以 provider 返回的 usage 为主要数据源，搭配估算器回退、自动压缩和大输出替换
- 支持通过 `SKILL.md` 文件发现本地 skills
- 支持通过 stdio 和 streamable HTTP 动态加载 MCP tools，MCP 非阻塞启动并在 UI 中展示连接状态
- 通过通用 helper tools 访问 MCP resources 和 prompts
- 可选 agent-loop tracing，支持 Langfuse / OpenTelemetry 导出

### 内置工具

- `list_files`
- `grep_files`
- `read_file`
- `write_file`
- `edit_file`
- `patch_file`
- `modify_file`
- `run_command`
- `web_fetch`
- `web_search`
- `ask_user`
- `load_skill`
- `list_mcp_resources`
- `read_mcp_resource`
- `list_mcp_prompts`
- `get_mcp_prompt`

### 安全性与可用性

- 文件修改前先 review diff
- 路径与命令权限检查，支持 allowlist / denylist
- 独立配置目录的本地安装器
- 兼容 Anthropic 风格 API 接口
- 超大工具结果会落盘保存，在上下文中替换为简短预览和文件路径，防止长命令输出挤占有效对话空间

### 近期交互改进

- 审批对话支持上下键选择 + Enter 确认，同时支持选项上标注的字母/数字快捷键
- 支持"拒绝并附反馈"，可将修正建议直接发回模型
- 编辑审批支持"本轮允许此文件"和"本轮允许所有编辑"
- diff 预览采用标准 unified diff 格式（更接近 `git diff`）
- 审批视图支持 `Ctrl+O` 展开/收起，以及滚轮和翻页滚动
- 审批弹窗打开时 `Ctrl+C` 也能干净退出
- 已完成的工具调用自动折叠为摘要，降低 transcript 噪音
- 通过 `run_command` 启动的后台 shell 命令以轻量 shell task 形式呈现，不再显示为永不返回的普通工具调用
- TTY 输入事件串行化处理，CRLF Enter 序列归一化，防止审批确认被重复触发
- 修复了审批阶段上下键/Enter 可能无响应的输入事件死锁
- 加固 ESC 序列解析，异常终端输入不会卡住按键处理
- `run_command` 支持 `"git status"` 这种单字符串命令并自动拆分参数
- 未知非 shell 命令改为请求审批而非直接拒绝
- 澄清问题通过 `ask_user` 结构化发问，用户回复前暂停当前回合
- token 记账改为 provider usage 驱动：provider 返回的 usage 作为 context stats、自动压缩阈值、warning/blocking 级别和 TUI badge 的主要数据来源；本地估算器仅在 provider 未返回 usage 或最新 usage boundary 之后存在新增消息时作为补充
- TUI context badge 区分精确 provider usage 和估算 tail（如 `ctx 82% ... usage+est`）；压缩后的会话将保留的旧 usage 标记为 stale，避免被当作当前上下文真实值
- 大工具结果持久化到 tcode 本地数据目录，模型上下文中替换为预览和文件路径；同一结果的多次引用复用稳定替换内容，保持记账一致
- 模型的 thinking block 在跨工具调用轮次间保留，确保多步执行中思维链的连续性

## 安装细节

```bash
cd tcode
npm install
npm run install-cli
```

安装器会逐一询问：

- 模型名称
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_AUTH_TOKEN`

配置写入：

- `~/.tcode/settings.json`
- `~/.tcode/mcp.json`

可通过 `TCODE_HOME` 自定义配置目录：

```bash
export TCODE_HOME=/path/to/custom/dir
npm run install-cli
```

启动命令安装到：

- `~/.local/bin/tcode`

可通过 `TCODE_BIN_DIR` 自定义启动器目录：

```bash
export TCODE_BIN_DIR=/path/to/custom/bin
npm run install-cli
```

如果 `~/.local/bin` 不在 `PATH` 中：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## 快速开始

运行安装后的命令：

```bash
tcode
```

开发模式：

```bash
npm start
```

离线演示模式：

```bash
TCODE_MODEL_MODE=mock npm start
```

## 命令

### 管理命令

- `tcode mcp list`
- `tcode mcp add <name> [--project] [--protocol <mode>] [--url <endpoint>] [--header KEY=VALUE ...] [--env KEY=VALUE ...] [-- <command> [args...]]`
- `tcode mcp login <name> --token <bearer-token>`
- `tcode mcp logout <name>`
- `tcode mcp remove <name> [--project]`
- `tcode skills list`
- `tcode skills add <path> [--name <name>] [--project]`
- `tcode skills remove <name> [--project]`

### 交互式 slash 命令

- `/help`
- `/tools`
- `/skills`
- `/mcp`
- `/status`
- `/init`
- `/memory`
- `/model`
- `/model <name>`
- `/config-paths`
- `/permissions`
- `/trace`

### 终端交互能力

- slash 命令菜单与输入建议
- transcript 滚动
- 输入编辑
- 输入历史导航（上下键）
- 审批界面的上下键选择 + Enter 确认（也支持快捷键直接选择）

### 会话管理

tcode 每轮对话后自动保存。每次启动创建新会话并分配唯一 ID。

- `/resume` — 打开交互式会话选择器
- `/resume <id>` — 按 ID 恢复指定会话
- `/rename <name>` — 重命名当前会话
- `/new` — 开始新会话（原会话保留）
- `/fork` — 将当前会话分叉为独立副本
- `/compact` — 手动压缩上下文以释放 context window 空间

CLI 参数：

- `tcode --resume` — 启动时打开会话选择器
- `tcode --resume <id>` — 恢复指定会话
- `tcode --fork <id>` — 分叉指定会话并恢复

会话按工作目录隔离，存储在 `~/.tcode/projects/`，采用追加写入的 JSONL 格式。退出时打印 session ID 方便后续恢复。超过 30 天的会话自动清理。

## 分层 Memory 与项目初始化

tcode 启动时从三层层级加载指令文件：

1. **用户全局**：`~/.tcode/MINI.md`（同时兼容读取 `~/.tcode/CLAUDE.md`），以及按文件名排序的 `~/.tcode/rules/*.md`
2. **项目根及祖先目录**：从 cwd 向上递归，读取 `MINI.md`、`MINI.local.md`、`.tcode/MINI.md`、`CLAUDE.md`、`CLAUDE.local.md`、`.claude/CLAUDE.md`，以及每层按文件名排序的 `.tcode/rules/*.md`
3. **优先级**：越靠近 cwd 的内容优先级越高

相同内容的文件自动去重。单文件上限约 8k 字符，总量上限约 20k 字符。在交互 UI 中输入 `/memory` 可查看实际加载的文件、作用域、行数和首行预览。

指令文件支持用单独一行 `@relative/path.md` 引用其他文件。include 路径相对当前指令文件解析；绝对路径和包含父目录跳转（`..`）的路径会被跳过，循环 include 会被检测并跳过。

`/init` 会为当前项目脚手架化 `.tcode/`、`.tcode/rules/` 和 `MINI.md`，并将生成的私有规则文件加入 `.gitignore`。

`MINI.md` 示例：

```markdown
# 项目规则

- 使用 TypeScript strict 模式。
- 提交前运行 `npx tsc --noEmit`。
- 保持改动最小且聚焦。

@.tcode/rules/testing.md
```

## 长会话与上下文管理

tcode 将长会话作为一等关注点处理：

- 模型接口返回 provider usage 时，tcode 将其记录在 assistant response boundary 上，作为 token 记账的主数据源。
- 如果最新 provider usage boundary 之后追加了消息，tcode 会补充本地 tail estimate，并在 badge 中标注来源（如 `usage+est`）。
- 如果 provider 未返回 usage，tcode 回退到本地估算，离线模式和兼容网关继续可用。
- 上下文统计驱动 TUI badge、warning/blocking 阈值和自动压缩触发。
- `/compact` 执行手动上下文压缩，并在会话日志中记录 compact boundary。
- 当上下文利用率达到配置阈值时，自动压缩可总结或裁剪旧轮次，为后续对话腾出空间。
- 压缩后，保留的压缩前 usage 标记为 stale，避免旧 provider 总量被误认为当前上下文大小。
- 超大工具结果写入 `~/.tcode/tool-results/`，在可见上下文中替换为预览和完整输出路径。单结果超过 `50_000` 字符会落盘；一批结果会被限制在约 `200_000` 字符的可见预算内。

会话存储与上下文压缩协同工作：`loadSession` 从最近的 compact boundary 之后恢复，`loadTranscript` 仍可从 JSONL 事件日志重建可见 transcript。

## 配置

配置示例：

```json
{
  "model": "your-model-name",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "remote-example": {
      "protocol": "streamable-http",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer your-token"
      }
    }
  },
  "trace": {
    "enabled": false,
    "langfuse": {
      "enabled": false
    }
  },
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.anthropic.com",
    "ANTHROPIC_AUTH_TOKEN": "your-token",
    "ANTHROPIC_MODEL": "your-model-name"
  }
}
```

也支持 Claude Code 风格的项目级 `.mcp.json`：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    }
  }
}
```

为兼容不同供应商的 MCP 实现，tcode 自动协商 stdio framing：

- 默认先尝试标准 MCP `Content-Length` framing
- 失败后回退到 newline-delimited JSON
- 可在单个 server 上通过 `"protocol": "content-length"` 或 `"protocol": "newline-json"` 强制指定模式
- 远程 MCP 使用 `"protocol": "streamable-http"` 搭配 `"url"`（可选 `"headers"`）
- header 值支持环境变量插值，如 `"Authorization": "Bearer $MCP_TOKEN"`

远程 MCP 认证策略（刻意保持轻量）：

- 使用 `tcode mcp login <name> --token <bearer-token>` 本地保存 bearer token
- 使用 `tcode mcp logout <name>` 清除已保存 token
- 当前版本有意采用 token 方案，不内置完整 OAuth 回调 + refresh 状态机
- 这样保持实现简洁，符合 tcode 轻量架构目标；后续确有需要再补充完整 OAuth 自动化

Skills 从以下位置发现：

- `./.tcode/skills/<skill-name>/SKILL.md`
- `~/.tcode/skills/<skill-name>/SKILL.md`
- `./.claude/skills/<skill-name>/SKILL.md`
- `~/.claude/skills/<skill-name>/SKILL.md`

配置优先级：

1. `~/.tcode/settings.json`
2. `~/.tcode/mcp.json`
3. 项目 `.mcp.json`
4. 兼容的本地已有配置
5. 进程环境变量

## Skills 与 MCP 用法

tcode 支持两类扩展：

- `skills`：本地工作流说明，通常由一个 `SKILL.md` 文件描述如何完成某类任务
- `MCP`：外部工具源，启动后将远端 server 暴露的 tools / resources / prompts 接入 tcode

### Skills：安装、查看、触发

安装一个本地 skill：

```bash
tcode skills add ~/minimax-skills/skills/frontend-dev --name frontend-dev
```

查看已发现的 skills：

```bash
tcode skills list
```

进入交互界面后，使用：

```text
/skills
```

查看当前会话可用的 skills。

如果你明确提及 skill 名称，tcode 会优先加载它：

```text
请使用 frontend-dev skill，直接重构当前 landing page，不要只停在方案说明。
```

也可以更明确地要求先读取 skill：

```text
先加载 fullstack-dev skill，再根据这个 skill 的工作流实现当前需求。
```

常见做法是将官方或兼容 Claude Code 的 skills 仓库 clone 到本地后安装：

```bash
git clone https://github.com/MiniMax-AI/skills.git ~/minimax-skills
tcode skills add ~/minimax-skills/skills/frontend-dev --name frontend-dev
```

### MCP：安装、查看、触发

安装一个用户级 MCP server：

```bash
tcode mcp add MiniMax --env MINIMAX_API_KEY=your-key --env MINIMAX_API_HOST=https://api.minimaxi.com -- uvx minimax-coding-plan-mcp -y
```

查看已配置的 MCP：

```bash
tcode mcp list
```

仅对当前项目配置 MCP，加 `--project`：

```bash
tcode mcp add filesystem --project -- npx -y @modelcontextprotocol/server-filesystem .
tcode mcp list --project
```

进入交互界面后，使用：

```text
/mcp
```

查看各 server 的连接状态、协商协议和暴露的 tools / resources / prompts 数量。

MCP tools 自动注册为：

```text
mcp__<server_name>__<tool_name>
```

例如连接 MiniMax MCP 后可能看到：

- `mcp__minimax__web_search`
- `mcp__minimax__understand_image`

这些工具名不需要手动声明，server 连接成功后自动出现。

### 在对话中使用

最简单的方式是自然语言描述需求，让模型自行决定是否调用 skill 或 MCP tool：

```text
搜索一下最近关于 MCP 的中文资料，给我 5 条有代表性的链接。
```

如果已连接 MiniMax MCP，模型通常会自动选择 `mcp__minimax__web_search`。

如需更确定的行为，可明确指定 skill 或能力：

```text
请使用 frontend-dev skill，直接修改当前项目文件，把页面重做成更完整的产品落地页。
```

或：

```text
请使用已连接的 MCP 工具帮我搜索 MiniMax MCP guide，并总结它提供了哪些能力。
```

### Skills 与 MCP 的选择

- `skills`：更适合沉淀工作流、规范、领域经验和可复用的执行模式
- `MCP`：更适合接入搜索、图片理解、浏览器、文件系统、数据库等远端能力

常见组合：

- 用 `frontend-dev` 这类 skill 约束页面改造方式
- 用已连接的 MCP 提供搜索、图片理解等外部能力

### 兼容性说明

tcode 当前主要支持：

- 本地 `SKILL.md` 发现与 `load_skill`
- stdio MCP server
- streamable HTTP MCP endpoint
- MCP tools
- MCP resources / prompts 的通用 helper tools

为兼容不同供应商实现，tcode 自动尝试：

- 标准 `Content-Length` framing
- 失败后回退到 `newline-json`

因此像 MiniMax 这类采用按行 JSON 的 MCP server 也可直接接入。

## Tracing

tcode 提供可选的 agent 行为观测层，记录 agent turn、模型输入输出、工具事件、loop 决策和错误，而不改变运行时行为。

通过环境变量开启：

```bash
TCODE_TRACE=1 npm start
```

或在 `~/.tcode/settings.json` 中配置：

```json
{
  "trace": {
    "enabled": true,
    "langfuse": {
      "enabled": true,
      "publicKey": "your-public-key",
      "secretKey": "your-secret-key",
      "baseUrl": "https://cloud.langfuse.com"
    }
  }
}
```

交互界面中运行 `/trace` 可查看当前 tracing 状态。

## 项目结构

- `src/index.ts` — CLI 入口与模式选择
- `src/agent-loop.ts` — 多步模型/工具执行循环
- `src/tool.ts` — 工具注册、校验与执行
- `src/skills.ts` — 本地 skill 发现与加载
- `src/mcp.ts` — stdio / streamable HTTP MCP 客户端与动态工具封装
- `src/manage-cli.ts` — 顶层 `tcode mcp` / `tcode skills` 管理命令
- `src/session.ts` — 追加写入的会话 JSONL、恢复/分叉/重命名、compact boundary 和过期清理
- `src/compact/*` — 手动压缩、自动压缩和对话摘要辅助逻辑
- `src/utils/token-estimator.ts` — provider usage 优先的上下文记账与估算回退
- `src/utils/tool-result-storage.ts` — 大工具输出持久化与预览替换
- `src/tools/*` — 内置工具实现
- `src/tui/*` — 终端 UI 组件
- `src/tracing.ts` — agent loop tracing 与可选 Langfuse / OpenTelemetry 导出
- `src/config.ts` — 运行时配置加载
- `src/install.ts` — 交互式安装器

## 代码规模

当前核心实现约 **8,500 行**。

统计口径：

- 纳入：核心 TypeScript 源码、内置工具、配置、MCP、会话、压缩、adapter、permissions、tracing，以及 `bin/tcode`
- 排除：文档、测试、`node_modules/` 和 TUI 文件（`src/tui/`、`src/tty-app.ts`）

如果只排除 `src/tui/` 但保留 `src/tty-app.ts`，总计约 **10,500 行**。

## 开发说明

```bash
npx tsc --noEmit
```

tcode 有意保持小而实用。目标是让整体架构足够清晰、易改造、易扩展。
