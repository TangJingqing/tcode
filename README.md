# tcode


---

<p align="center">
  A lightweight, highly efficient coding tool. Designed for speed, built for simplicity.
</p>

[简体中文](./README.zh-CN.md) | [Usage Guide](./USAGE.md) | [Architecture](./ARCHITECTURE.md) | [Contributing](./CONTRIBUTING.md) | [Roadmap](./ROADMAP.md) | [License](./LICENSE)

tcode 是一个运行在终端里的轻量级编码助手，面向本地开发场景。

它在远小于 Claude Code 的代码体量中复现了其核心工作流和架构理念，非常适合用来学习、实验和搭建自己的定制工具。

## 设计概览

tcode 围绕一个简洁的终端优先 agent loop 展开：

- 读取用户输入
- 理解当前工作区
- 按需调用工具
- 写文件前展示 diff 供确认
- 在同一会话中返回结果

整个项目刻意控制规模，所以控制流、工具系统、追踪逻辑、TUI 组件都保持清晰，便于理解和扩展。

## 适用场景

tcode 适合以下需求：

- 想用一个轻量编码助手，而不是一个重型平台
- 想要卡片式终端界面，包含工具调用、会话记录和命令面板
- 想要一个小代码库，方便阅读和定制
- 需要一个 Claude Code 类 agent 架构的参考实现
- 想要可选的本地 tracing 来观察 agent 循环和模型/工具事件

## 核心功能

- 单轮内支持多次工具调用，构成 `model -> tool -> model` 的迭代回路。
- 全屏卡片式终端界面，分为 header、session feed、prompt、approval、activity、footer 六个面板。
- 按项目隔离的会话持久化：支持恢复、重命名、分叉、压缩操作。
- 上下文统计以 provider usage 为准，辅以尾部估算、自动压缩和大结果替换。
- 内置工具涵盖文件操作、内容搜索、文本编辑、命令执行、网页抓取/搜索、结构化提问。
- 通过 `SKILL.md` 发现本地 skills，同时支持 stdio 和 streamable HTTP 两种方式接入 MCP 工具、资源和提示。
- 文件修改先审后写，路径和命令执行均受权限约束。
- 可选的 agent-loop 链路追踪，兼容 Langfuse / OpenTelemetry。
- 超长工具输出自动落盘，上下文中仅保留摘要和文件路径。

完整命令参考、配置示例、会话机制、tracing 配置以及 Skills/MCP 用法详见 [Usage Guide](./USAGE.md)。

## 安装

```bash
cd tcode
npm install
npm run install-cli
```

安装脚本会依次询问模型名称、`ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`。配置文件写入：

- `~/.tcode/settings.json`
- `~/.tcode/mcp.json`

环境变量 `TCODE_HOME` 可重写配置目录，`TCODE_BIN_DIR` 可重写启动器安装路径。详见 [Installation Details](./USAGE.md#installation-details)。

## 快速上手

安装后直接启动：

```bash
tcode
```

源码开发模式：

```bash
npm start
```

离线演示（不调用真实模型）：

```bash
TCODE_MODEL_MODE=mock npm start
```

## 常用命令

- `/help` — 交互式帮助。
- `/tools` — 列出所有可用工具。
- `/skills` — 列出已发现的 skills。
- `/mcp` — 显示 MCP 服务器的连接状态。
- `/status` — 查看当前会话与上下文概况。
- `/init` — 在当前项目下生成 `.tcode/` 和 `MINI.md`。
- `/memory` — 浏览本轮加载的分层 memory 文件。
- `/model` / `/model <name>` — 查看当前模型或切换到指定模型。
- `/resume` — 打开历史会话选择器。
- `/compact` — 手动触发上下文压缩。
- `/trace` — 查看链路追踪状态。

管理类命令包括 `tcode mcp ...` 和 `tcode skills ...`。完整列表见 [Commands](./USAGE.md#commands)。

## 文档索引

- [Usage Guide](./USAGE.md)
- [Architecture Overview](./ARCHITECTURE.md)
- [中文架构说明](./ARCHITECTURE_ZH.md)
- [Contribution Guidelines](./CONTRIBUTING.md)
- [中文贡献规范](./CONTRIBUTING_ZH.md)
- [Roadmap](./ROADMAP.md)
- [路线图](./ROADMAP_ZH.md)
- [Learn Claude Code Design Through tcode](./CLAUDE_CODE_PATTERNS.md)
- [技术说明](./TECHNICAL_OVERVIEW_ZH.md)

## 开发

```bash
npx tsc --noEmit
```

tcode 刻意保持小而务实，目标是让架构容易读懂、容易改动、容易扩展。
