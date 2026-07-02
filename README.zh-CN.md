# tcode

[English](./README.md) | [Architecture](./ARCHITECTURE.md) | [中文架构说明](./ARCHITECTURE_ZH.md) | [贡献指南](./CONTRIBUTING_ZH.md) | [路线图](./ROADMAP_ZH.md) | [通过 tcode 学习 Claude Code 设计](./CLAUDE_CODE_PATTERNS_ZH.md) | [License](./LICENSE)

一个轻量级终端编码助手，用于本地开发工作流。

tcode 延续 MiniCode 的紧凑、终端优先设计：核心 agent loop 保持足够小，便于学习和定制，同时支持实用文件工具、权限审批、本地 skills、MCP 动态工具和 agent tracing。

## 概览

tcode 围绕一条实用的终端 agent 闭环构建：

- 接收用户请求
- 检查当前工作区
- 按需调用工具
- 写入前展示可 review 的改动
- 在同一终端会话中返回结果

项目刻意保持紧凑，让控制流、工具模型、追踪行为和 TUI 组件都容易理解和扩展。

## 主要功能

### 核心工作流

- 单个用户请求内支持多步工具执行
- `model -> tool -> model` 循环
- 全屏终端界面
- 卡片式 header、session feed、prompt、approval、activity 和 footer 面板
- 输入历史、会话滚动和 slash command 菜单
- 通过 `SKILL.md` 发现本地 skills
- 通过 stdio 动态加载 MCP 工具
- 通过通用 MCP helper 工具读取 MCP resources 和 prompts
- 可选 Langfuse / OpenTelemetry agent tracing

### 内置工具

- `list_files`
- `grep_files`
- `read_file`
- `write_file`
- `edit_file`
- `patch_file`
- `modify_file`
- `run_command`
- `ask_user`
- `load_skill`
- `list_mcp_resources`
- `read_mcp_resource`
- `list_mcp_prompts`
- `get_mcp_prompt`

### 安全与可用性

- 文件修改前 review
- 路径、命令和编辑权限检查
- 支持拒绝时提供反馈
- 支持“本轮允许该文件”和“本轮允许所有编辑”
- 审批视图支持展开、折叠、滚动和选择
- 后台 shell 命令会以轻量任务形式显示
- 完成的工具调用会自动折叠为简洁摘要
- 模型可通过 `ask_user` 主动提出澄清问题并暂停当前回合

### 最近交互改进

- 审批对话支持上下键选择与 Enter 确认，也支持选项上的字母/数字快捷键
- 支持“拒绝并给模型反馈”，可直接把修正建议发回模型
- 编辑审批支持“本轮允许此文件”与“本轮允许全部编辑”
- diff 预览使用标准 unified diff（更接近 `git diff`）
- 审批页面支持 `Ctrl+O` 展开/收起与滚轮/分页滚动
- 审批弹窗打开时也支持 `Ctrl+C` 干净退出
- 工具调用结果自动折叠为摘要，减少 transcript 噪音
- 通过 `run_command` 启动的显式后台 shell 命令，会以轻量 shell task 的形式呈现，不再卡成一个永远 running 的普通工具调用
- TTY 输入事件串行处理，并且会把 CRLF 的 Enter 合并成一次确认，避免审批弹窗被重复触发
- 审批输入处理避免了上下键/Enter 无响应的死锁问题
- 加固 ESC 序列解析，异常终端输入不会再卡住按键处理
- `run_command` 支持 `"git status"` 这类单字符串命令输入，并自动拆分参数
- 未知的非 shell 命令现在会请求审批，而不是直接拒绝
- 澄清问题通过 `ask_user` 结构化发问，并在用户回复前暂停当前回合

## 安装

```bash
cd tcode
npm install
npm run install-cli
```

安装器会询问：

- 模型名称
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_AUTH_TOKEN`

配置文件存储在：

- `~/.tcode/settings.json`
- `~/.tcode/mcp.json`

启动器安装到：

- `~/.local/bin/tcode`

如果 `~/.local/bin` 不在 `PATH` 中，可以添加：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## 快速开始

运行已安装的命令：

```bash
tcode
```

开发模式运行：

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
- `tcode mcp add <name> [--project] [--protocol <mode>] [--env KEY=VALUE ...] -- <command> [args...]`
- `tcode mcp remove <name> [--project]`
- `tcode skills list`
- `tcode skills add <path> [--name <name>] [--project]`
- `tcode skills remove <name> [--project]`

### 本地 slash commands

- `/help`
- `/tools`
- `/skills`
- `/mcp`
- `/status`
- `/model`
- `/model <name>`
- `/config-paths`
- `/permissions`
- `/trace`

## 配置

tcode 会读取 `~/.tcode/settings.json`、`~/.tcode/mcp.json`、项目级 `.mcp.json`、兼容的 Claude 本地配置以及进程环境变量。

Skills 会从以下位置发现：

- `./.tcode/skills/<skill-name>/SKILL.md`
- `~/.tcode/skills/<skill-name>/SKILL.md`
- `./.claude/skills/<skill-name>/SKILL.md`
- `~/.claude/skills/<skill-name>/SKILL.md`

## Tracing

可以通过环境变量开启 agent tracing：

```bash
TCODE_TRACE=1 npm start
```

也可以在 `~/.tcode/settings.json` 中配置：

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

在交互界面中运行 `/trace` 可以查看当前 tracing 状态。

## 项目结构

- `src/index.ts`: CLI 入口
- `src/agent-loop.ts`: 多步模型和工具循环
- `src/tool.ts`: 工具注册和执行
- `src/skills.ts`: 本地 skill 发现和加载
- `src/mcp.ts`: stdio MCP client 和动态工具封装
- `src/manage-cli.ts`: `tcode mcp` / `tcode skills` 管理命令
- `src/tools/*`: 内置工具
- `src/tui/*`: 终端 UI 模块
- `src/tracing.ts`: agent loop tracing 和可选 Langfuse 导出
- `src/config.ts`: 运行时配置加载
- `src/install.ts`: 交互式安装器

## 更多文档

- [Architecture Overview](./ARCHITECTURE.md)
- [中文架构说明](./ARCHITECTURE_ZH.md)
- [贡献指南](./CONTRIBUTING_ZH.md)
- [路线图](./ROADMAP_ZH.md)
- [通过 tcode 学习 Claude Code 设计](./CLAUDE_CODE_PATTERNS_ZH.md)
