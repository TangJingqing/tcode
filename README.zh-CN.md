# tcode

<p align="center">
  <img src="https://img.shields.io/badge/Editor-tcode-D97757?style=for-the-badge" alt="Editor: tcode" />
  <img src="https://img.shields.io/badge/%23tcode-Project-B85C3F?style=for-the-badge" alt="#tcode" />
  <img src="https://img.shields.io/badge/%23lightweight-Focus-F0EBE1?style=for-the-badge&labelColor=8B8B8B" alt="#lightweight" />
</p>

---

<p align="center">
  一个轻量且高效的编码工具。为速度而生，为简洁而建。
</p>

[English](./README.md) | [详细使用指南](./USAGE_ZH.md) | [架构说明](./ARCHITECTURE_ZH.md) | [贡献规范](./CONTRIBUTING_ZH.md) | [路线图](./ROADMAP_ZH.md) | [License](./LICENSE)

tcode 是一个面向本地开发工作流的轻量级终端编码助手。

它用更小的实现体量，提供类 Claude Code 的工作流体验和架构思路，因此很适合学习、实验，以及继续做自己的定制化开发。

## 项目简介

tcode 围绕一个实用的 terminal-first agent loop 构建：

- 接收用户请求
- 检查当前工作区
- 在需要时调用工具
- 修改文件前先 review
- 在同一个终端会话里返回最终结果

整个项目有意保持紧凑，让主控制流、工具模型、追踪行为和 TUI 组件都更容易理解和扩展。

## 为什么选择 tcode

tcode 适合你，如果你想要：

- 一个轻量级 coding assistant，而不是庞大的平台
- 一个卡片式终端 UI，带 tool calling、transcript 和命令工作流
- 一个很适合阅读和二次开发的小代码库
- 一个可用于学习类 Claude Code agent 架构的参考实现
- 可选本地 tracing 观察 agent loop 和模型/工具事件

## 核心能力

- 单轮支持多步工具执行，形成 `model -> tool -> model` 闭环。
- 全屏卡片式终端界面，包含 header、session feed、prompt、approval、activity 和 footer 面板。
- 会话按项目隔离持久化，支持恢复、重命名、分叉和压缩。
- 上下文统计优先使用 provider usage，并支持 tail estimate、自动压缩和大输出替换。
- 内置文件、搜索、编辑、命令执行、Web fetch/search、结构化提问等工具。
- 支持通过 `SKILL.md` 发现本地 skills，也支持通过 stdio 或 streamable HTTP 接入 MCP tools/resources/prompts。
- 文件修改前先 review diff，并对路径和命令执行做权限检查。
- 可选 agent-loop tracing，支持 Langfuse / OpenTelemetry 导出。
- 超大工具结果会落盘保存，并在上下文里替换成短预览和文件路径。

完整命令、配置示例、会话机制、tracing 设置和 Skills/MCP 用法已移到 [详细使用指南](./USAGE_ZH.md)。

## 安装

```bash
cd tcode
npm install
npm run install-cli
```

安装器会询问模型名称、`ANTHROPIC_BASE_URL` 和 `ANTHROPIC_AUTH_TOKEN`。默认配置保存在：

- `~/.tcode/settings.json`
- `~/.tcode/mcp.json`

可通过 `TCODE_HOME` 自定义配置目录，通过 `TCODE_BIN_DIR` 自定义启动器目录。更多安装细节见 [详细使用指南](./USAGE_ZH.md#安装细节)。

## 快速开始

运行安装后的命令：

```bash
tcode
```

本地开发模式：

```bash
npm start
```

离线演示模式：

```bash
TCODE_MODEL_MODE=mock npm start
```

## 常用入口

- `/help` — 查看交互帮助。
- `/tools` — 查看当前可用工具。
- `/skills` — 查看当前可发现的 skills。
- `/mcp` — 查看当前 MCP 连接状态。
- `/status` — 查看会话和上下文状态。
- `/init` — 为当前项目生成 `.tcode/` 与 `MINI.md` 初始化文件。
- `/memory` — 查看本轮实际加载的分层 memory 文件。
- `/model` / `/model <name>` — 查看或切换模型。
- `/resume` — 打开会话选择器。
- `/compact` — 手动压缩上下文。
- `/trace` — 查看当前 tracing 状态。

管理命令包括 `tcode mcp ...` 和 `tcode skills ...`，详见 [命令说明](./USAGE_ZH.md#命令)。

## 文档导航

- [详细使用指南](./USAGE_ZH.md)
- [Architecture Overview](./ARCHITECTURE.md)
- [中文架构说明](./ARCHITECTURE_ZH.md)
- [中文贡献规范](./CONTRIBUTING_ZH.md)
- [Contribution Guidelines](./CONTRIBUTING.md)
- [路线图](./ROADMAP_ZH.md)
- [Roadmap](./ROADMAP.md)
- [通过 tcode 学习 Claude Code 设计](./CLAUDE_CODE_PATTERNS_ZH.md)
- [技术说明](./TECHNICAL_OVERVIEW_ZH.md)
- [MCP 功能技术说明](./MCP_TECHNICAL_ZH.md)

## 开发说明

```bash
npx tsc --noEmit
```

tcode 有意保持小而实用。目标是让整体架构足够清晰、易改造、易扩展。
