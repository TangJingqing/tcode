# 通过 tcode 学习 Claude Code 设计

tcode 不是 Claude Code 的复刻，但它用一个小型 TypeScript 代码库呈现了很多 Claude Code 风格的设计思想。

## 1. Agent Loop

Claude Code 的核心是 agent loop：

- 接收用户输入
- 组装上下文
- 调用模型
- 在需要时执行工具
- 将工具结果回传给模型
- 只有当前回合真的完成时才停止

tcode 在 `src/agent-loop.ts` 中实现了同类结构。这个 loop 足够小，可以直接阅读，同时仍然处理 progress、工具调用、澄清问题、重试和 tracing。

## 2. 结构化消息模型

Claude Code 不会把会话只当成普通聊天文本。它会区分用户输入、助手输出、进度、工具调用和工具结果。

tcode 在 `src/types.ts` 中也做了类似区分：

- `user`
- `assistant`
- `assistant_progress`
- `assistant_tool_call`
- `tool_result`

这样可以避免把进度更新误当成最终答复。

## 3. 工具调用是一种协议

工具调用不是从模型文本中直接执行函数，而是一套协议。

tcode 把这套协议显式化：

- 工具统一注册
- 输入结构提供给模型
- 本地使用 Zod 校验输入
- 本地副作用前可以经过权限审批
- 结果通过统一结构返回

本地工具和 MCP 工具共享同一条执行路径。

## 4. 澄清问题也是工具

真实编码 agent 有时需要用户补充信息才能继续。tcode 通过 `ask_user` 把这件事做成普通工具，工具结果返回 `awaitUser`。

这样澄清问题仍然在统一执行模型内，而不是依赖容易误判的普通助手文本。

## 5. 权限属于执行路径

写文件、访问工作区外路径、运行危险命令等操作都应该经过权限边界。

tcode 把这部分逻辑集中在 `src/permissions.ts`，并让工具执行接入它。审批是运行时的一部分，而不只是 UI 功能。

## 6. MCP 是动态能力注入

MCP 允许外部 server 在运行时暴露工具、resources 和 prompts。

tcode 在 `src/mcp.ts` 中发现 MCP 工具，再把它们和内置工具一起注册。agent loop 不需要关心工具是本地的还是远端的。

## 7. Skills 是本地工作流记忆

Skills 是存放在 `SKILL.md` 中的可复用工作流说明。

tcode 会从 `.tcode/skills` 和兼容的 `.claude/skills` 位置发现 skills，并通过 `load_skill` 工具加载完整内容。

## 8. Tracing 用于观察 Agent 行为

当每个 loop decision 都可观察时，agent 行为更容易调试。

tcode 在 `src/tracing.ts` 中提供可选 tracing，记录模型输入、工具事件、loop 决策、错误，并可选导出到 Langfuse。

## 9. 小架构本身就是学习工具

tcode 的主要价值之一是设计可见：

- loop 集中在一个文件
- 工具共享一种协议
- 权限集中处理
- TUI 状态显式
- MCP 和 skills 接入同一运行时
- tracing 记录决策但不接管行为

因此 tcode 既可以作为本地助手使用，也适合用来学习终端 coding agent 架构。
