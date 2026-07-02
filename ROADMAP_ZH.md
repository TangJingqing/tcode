# tcode 路线图

tcode 已经具备可用的轻量终端编码工作流。下面的路线图聚焦最有价值的缺失能力，同时保持项目小、清晰、可学习。

## P0

### 1. 模型感知的上下文管理

长会话稳定性需要更好的上下文控制。

包括：

- 按模型配置上下文窗口
- 使用 provider 返回的 usage 信息做统计
- 在 TUI 中展示上下文使用情况
- 长对话自动 compact

### 2. API 重试和退避

临时性的 provider 故障不应该直接打断用户工作流。

包括：

- 对 429 和 5xx 响应重试
- 指数退避
- 支持 `Retry-After`

### 3. 会话持久化和恢复

tcode 应该能可靠保存和恢复会话。

包括：

- 自动保存
- 手动恢复
- 基础会话恢复能力

## P1

### 4. 分层 Memory 加载

tcode 可以支持类似 Claude Code 的轻量项目上下文层级。

可能包括：

- 全局 memory
- 项目 memory
- 嵌套或局部 memory
- 简单 include 支持

### 5. 更强的 Provider 抽象

tcode 当前适配 Anthropic 风格 API 和部分兼容 provider。后续可以把 provider 层做得更显式。

目标方向：

- Anthropic
- OpenAI-compatible endpoints
- OpenRouter
- LiteLLM-style gateways

### 6. 轻量任务跟踪

内置一个简单 task tracker 可以改善长任务执行体验，但不应变成重型 planning 系统。

### 7. Sub-Agent 支持

Sub-agent 对并行调查和 review 很有价值，但应在上下文、会话和 provider 行为更稳定后再推进。

### 8. 选择性扩展核心工具集

tcode 应该增加支撑核心运行时能力的工具，而不是追求工具数量对齐。

优先方向：

- 会话和 memory 相关工具
- 上下文管理辅助工具
- 轻量任务跟踪
- MCP 不能充分替代的高价值内置工具

## P2

### 9. Notebook 编辑支持

对数据和研究工作流有用，但不是终端编码主循环的核心能力。

### 10. 内置 Web 工具

MCP 已经可以提供 web search 和 fetch 能力，所以内置 web 工具是有价值但优先级较低的方向。

### 11. 评测基础设施

包括：

- benchmark harness
- 结构化 trace 捕获
- 可复现 agent evaluation

### 12. Prompt Caching

适合在上下文统计和 provider 集成更成熟后探索。

## 贡献说明

贡献路线图相关能力时：

- PR 保持聚焦
- 保持轻量架构
- 记录用户可见行为
- 说明验证方式

参考：

- [Contribution Guidelines](./CONTRIBUTING.md)
- [中文贡献规范](./CONTRIBUTING_ZH.md)
