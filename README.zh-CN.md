# tcode


---

<p align="center">
  一个轻量且高效的编码工具。为速度而生，为简洁而建。
</p>

[English](./README.md) | [详细使用指南](./USAGE_ZH.md) | [架构说明](./ARCHITECTURE_ZH.md) | [贡献规范](./CONTRIBUTING_ZH.md) | [路线图](./ROADMAP_ZH.md) | [License](./LICENSE)

tcode 是一款跑在终端里的轻量编码助手，专为本地开发流程设计。

它用精简的代码量实现了 Claude Code 式的交互体验和架构思想，因此特别适合拿来学习、做实验，或者在此基础上构建你自己的工具。

## 设计思路

tcode 的内核是一个务实、终端优先的 agent 循环：

- 接收用户输入的任务
- 探查当前工作区状况
- 必要时调用工具
- 修改文件前先展示变更让用户审核
- 在同一终端会话中给出最终回复

项目始终坚持小体量，确保主流程、工具模型、追踪行为和 TUI 各层都容易看懂、方便改动。

## 什么时候用 tcode

以下场景 tcode 会很合适：

- 你需要一个轻量的编程助手，而不是一个笨重的平台
- 你想要卡片风格的终端交互界面，有 tool call、对话记录和命令入口
- 你需要一个小巧的代码库来阅读和二次开发
- 你想找一个 Claude Code 式 agent 架构的学习参考
- 你需要可选的本地 tracing 能力，观察 agent 循环和模型/工具调用过程

## 主要能力

- 单轮对话内可连续调用多个工具，自然形成 `model -> tool -> model` 的执行环路。
- 全屏卡片式终端 UI，分为 header、session feed、prompt、approval、activity、footer 六个区域。
- 会话数据按项目独立存储，支持恢复、重命名、分叉和上下文压缩。
- 上下文用量统计优先读取 provider 返回数据，结合尾部估算、自动压缩和大结果替换策略。
- 内置工具涵盖：文件读写、内容搜索、文本编辑、Shell 命令执行、网页抓取与搜索、结构化用户提问。
- 支持 `SKILL.md` 声明的本地 skills，同时可通过 stdio 或 streamable HTTP 接入外部 MCP 的工具、资源和提示。
- 编辑文件前强制预览 diff，路径操作和命令执行均需权限确认。
- 可选 agent 循环追踪，支持导出到 Langfuse / OpenTelemetry。
- 超过阈值的工具输出会存入磁盘，上下文里只保留简短摘要和文件路径。

完整的命令参考、配置写法、会话机制、tracing 设置和 Skills/MCP 用法请查阅 [详细使用指南](./USAGE_ZH.md)。

## 安装步骤

```bash
cd tcode
npm install
npm run install-cli
```

安装过程会提示你输入模型名称、`ANTHROPIC_BASE_URL` 和 `ANTHROPIC_AUTH_TOKEN`。配置保存在：

- `~/.tcode/settings.json`
- `~/.tcode/mcp.json`

可以通过 `TCODE_HOME` 环境变量修改配置目录，通过 `TCODE_BIN_DIR` 修改启动器安装路径。详见 [安装细节](./USAGE_ZH.md#安装细节)。

## 快速上手

安装完成后运行：

```bash
tcode
```

源码开发调试：

```bash
npm start
```

离线演示（不连模型）：

```bash
TCODE_MODEL_MODE=mock npm start
```

## 常用入口

- `/help` — 弹出交互帮助。
- `/tools` — 浏览当前可用的全部工具。
- `/skills` — 查看已扫描到的 skills。
- `/mcp` — 展示各 MCP 服务器的连接情况。
- `/status` — 查看会话与上下文概览。
- `/init` — 为当前项目初始化 `.tcode/` 目录和 `MINI.md`。
- `/memory` — 检视本轮实际生效的分层 memory 文件。
- `/model` / `/model <name>` — 查看当前模型或切换到指定模型。
- `/resume` — 调出历史会话列表。
- `/compact` — 手动执行上下文压缩。
- `/trace` — 查看当前 tracing 配置。

管理命令还有 `tcode mcp ...` 和 `tcode skills ...`，详见 [命令说明](./USAGE_ZH.md#命令)。

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

## 开发

```bash
npx tsc --noEmit
```

tcode 始终追求小而实用，目标是把架构维持在容易理解、方便改造、便于扩展的状态。
