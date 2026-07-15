
# tcode 架构说明

[English](./ARCHITECTURE.md)

这个文档描述 `tcode` 的轻量化架构设计决策。
目标不是把终端 agent 做成"大而全"的平台，而是优先保留最有价值的执行闭环、交互体验、安全边界，以及用于调试的可观测性。

## 设计原则

tcode 优先保留这些能力：

1. `模型 -> 工具 -> 模型` 的主循环
2. 全屏 TUI 的交互节奏
3. 目录感知、权限审批、危险操作确认
4. header / session feed / prompt / approval / activity / footer 的卡片式 TUI 结构
5. 用户可 review 的文件修改流程
6. 本地 skills、MCP 动态工具和 agent tracing

也就是说，tcode 是一个更小、更可控、也更容易观察内部行为的终端编码助手。

## 当前实现重点

- 保留"模型 -> 工具 -> 模型"的循环骨架
- 保留统一工具协议和集中注册
- 保留消息驱动的终端交互节奏
- 保留路径权限、命令权限、写入审批这些安全边界
- 保留受 Claude Code 启发的扩展点：本地 skills 和 MCP 动态工具
- 通过追加写入的会话历史、compact boundary、provider usage 上下文记账和大工具输出替换，让长时间会话保持可用
- 增加 tracing，用于记录 agent turn、模型输入输出、工具调用和错误

## 待完成的功能

- 完整 Ink/React 渲染栈
- bridge / IDE 双向通信
- remote session
- task swarm / sub-agent 编排
- LSP
- skill marketplace
- 更复杂的 permission 模式
- feature flag 体系
- telemetry / analytics
- 分层项目 memory 与更完整的会话搜索

## tcode 当前实现

- `src/index.ts`: CLI 入口，负责配置、工具、权限、tracer 和交互模式初始化
- `src/agent-loop.ts`: 多轮工具调用循环
- `src/tool.ts`: 工具注册、校验和执行
- `src/tools/*`: `list_files` / `grep_files` / `read_file` / `write_file` / `edit_file` / `patch_file` / `modify_file` / `run_command` / `web_fetch` / `web_search` / `ask_user` / `load_skill` / MCP helper tools
- `src/config.ts`: 使用独立的 `~/.tcode`，并合并 Claude 兼容配置
- `src/skills.ts`: 扫描 `.tcode/skills` 和兼容的 `.claude/skills` 目录
- `src/mcp.ts`: 启动 stdio MCP server，协商兼容的 framing，并把远端 MCP tools 封装成当前工具协议
- `src/background-tasks.ts`: 给 `run_command` 和 TUI 使用的最小 background shell task 注册表
- `src/manage-cli.ts`: 管理持久化 MCP 配置和本地安装的 skills
- `src/anthropic-adapter.ts`: Anthropic 兼容 Messages API 适配器
- `src/utils/token-estimator.ts`: 结构化 token accounting。provider-reported usage 可用时作为主数据源；本地估算只用于缺失 usage 的 fallback，以及最新 provider usage boundary 之后的 tail messages。
- `src/utils/tool-result-storage.ts`: 将超大工具结果持久化到 tcode 本地数据目录，并在可见上下文里替换成预览和文件路径；同一次运行中会复用稳定替换结果。
- `src/compact/*`: 上下文压缩与自动压缩。auto-compact 使用结构化 accounting total；compact 后会把保留下来的压缩前 provider usage 标记为 stale。
- `src/mock-model.ts`: 离线回退适配器
- `src/permissions.ts`: 路径、命令、编辑审批与 allowlist / denylist
- `src/session.ts`: 多会话持久化，追加写入 JSONL，parentUuid 树结构，compact boundary，会话分叉，过期清理
- `src/memory.ts`: 分层指令文件加载（`MINI.md` / `CLAUDE.md` / `.tcode/rules/*.md`），向上目录递归，`@path` include，`/memory` 报告，内容去重，容量限制渲染
- `src/init.ts`: 项目初始化 — 创建 `.tcode/`，向 `.gitignore` 追加 TCode 条目，根据项目结构检测生成 `MINI.md` 模板（语言、框架、验证命令）。幂等 `/init` 命令。
- `src/file-review.ts`: 写文件前 diff review
- `src/tracing.ts`: agent loop tracing 和可选 Langfuse / OpenTelemetry 导出
- `src/tui/*`: transcript / chrome / input / screen / markdown 终端组件
- `src/tty-app.ts`: 全屏 TUI 状态管理、输入事件处理和 agent 回调接入

## 运行时状态模型

tcode 的运行时状态有意保持简单：

- 对话消息在单轮执行期间保存在内存中，并在成功回合后追加写入会话日志。
- 会话按工作目录存储在 `~/.tcode/projects/`，格式为 JSONL 事件；普通事件通过 `parentUuid` 串联，压缩历史通过 compact boundary 标记。
- 恢复会话时会从最近的 compact boundary 之后加载消息，而 transcript 重建仍可以读取完整事件流。
- provider usage 会附着在 assistant 侧 response boundary 上；只要 usage 仍然 fresh，就作为上下文记账的事实来源。
- 本地 token 估算只作为 provider usage 缺失时的 fallback，或作为最新 provider usage boundary 之后新增消息的 tail estimate。
- 超大工具输出会被移出 prompt context，保存到 `~/.tcode/tool-results/`，模型只看到预览和完整输出路径。
- Tracing span 按 session 和 agent turn 创建，记录关键决策但不改变行为。

## UI 架构

当前 TUI 采用原生 stdin/stdout 和 ANSI 控制序列实现，不依赖 React/Ink。

界面结构参考卡片式布局：

- `header`: 展示项目、provider、model、messages、events、skills、mcp 和上下文利用率等会话信息
- `session feed`: 展示用户、助手、progress、tool 调用记录
- `prompt`: 展示输入框、快捷键提示和 slash command 菜单
- `approval`: 展示路径、命令、文件修改等权限审批
- `activity`: 展示当前工具和最近工具结果
- `footer`: 展示当前状态以及 tools / skills 是否可用

`src/tui/chrome.ts` 提供 banner、panel、footer、slash menu、approval prompt 等通用 UI 组件。
`src/tui/transcript.ts` 负责 transcript 渲染和按面板高度滚动。
`src/tty-app.ts` 负责把状态变化、输入事件和 agent 回调连接到这些组件。

## 为什么适合学习

tcode 的一个优势，是用更轻量的实现方式，提供了类 Claude Code 的功能体验和核心架构思路。

这让它很适合用来：

- 学习 terminal coding agent 的基本组成
- 研究 tool-calling loop
- 理解权限审批和文件 review 流程
- 理解如何在不引入重型插件平台的情况下接入 skills 和 MCP
- 理解一种更接近 Claude Code 的"前台工具执行 / 后台 shell task"区分方式
- 研究会话恢复、compact boundary、provider usage 与大输出落盘如何整合进一个紧凑 runtime
- 通过 tracing 观察 agent turn、模型响应和工具调用的执行细节
- 试验终端 UI 的组织方式
- 在小代码量基础上继续做自己的定制开发

## 后续优化方向

1. 更完整的虚拟滚动 transcript
2. 更完整的输入编辑行为
3. 更细的工具执行状态面板
4. 会话历史与项目记忆（会话持久化已实现；项目记忆仍待开发）
5. 更强的 UI 组件化
6. 更细粒度的 trace 过滤与本地查看工具
