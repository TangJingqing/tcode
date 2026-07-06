# MiniCode 增量功能迁移说明

## 一、上下文压缩系统

### 实现了什么

tcode 新增三级上下文压缩机制，在对话过长时自动或手动压缩历史，防止超出模型上下文窗口：

| 级别 | 触发条件 | 策略 |
|------|---------|------|
| microcompact | 利用率 ≥ 50% | 将早期 `tool_result` 内容替换为 `[Output cleared for context space]`，保留最近 3 条 |
| autoCompact | 利用率 ≥ 85% | 调用 LLM 对早期对话生成结构化摘要，压缩为一条 `context_summary` 消息 |
| manualCompact | 用户输入 `/compact` | 同 autoCompact，但由用户手动触发 |

### 举例

- 之前：对话超过 200K tokens 直接报错
- 现在：利用率到 50% 自动清理旧工具输出；到 85% 自动生成摘要压缩，状态栏显示 `ctx: 45% ▓▓▓▓░░░░░░`
- 用户随时可输入 `/compact` 手动触发压缩

### 如何实现

新增 `src/compact/` 目录：

```
compact/
├── constants.ts      # 阈值：microcompact 50%、autocompact 85%、blocked 95%
├── prompt.ts         # 摘要 prompt（六段：请求/决策/文件/错误/状态/待办）
├── compact.ts        # 核心压缩：找保留边界、调用 LLM 生成摘要
├── auto-compact.ts   # 自动压缩：连续失败 3 次自动禁用
├── microcompact.ts   # 轻量清理：只对 COMPACTABLE_TOOLS 做替换
└── manual-compact.ts # /compact 命令入口
```

新增依赖：

- `src/utils/model-context.ts` — 模型上下文窗口映射表（如 claude-opus-4-6 → 200K）
- `src/utils/token-estimator.ts` — 按角色估算 token（system 3.5 chars/token，tool_result 2.0 chars/token）

流程：
```
每次 agent step:
  microcompact → 利用率< 50%?
    ├─ 是 → 跳过
    └─ 否 → 清理旧 tool_result
  autoCompact (仅 step 0) → 利用率 ≥ 85%?
    ├─ 否 → 跳过
    └─ 是 → LLM 摘要 → 替换早期消息
```

---

## 二、模型感知的 max_tokens 管理

### 实现了什么

`max_tokens` 不再硬编码 4096，而是根据配置的模型名称自动匹配合理值。

| 场景 | 之前 | 现在 |
|------|------|------|
| 使用 `deepseek-v4-pro`（1M 上下文） | 4096 | 1,000,000 |
| 使用 `claude-opus-4-6` | 4096 | 128,000 |
| 使用 `deepseek-chat`，手动配了 `maxOutputTokens=20000` | 20000 | 8000（被模型上限截断） |

### 实现

`src/utils/context.ts` 内置 17 条模型映射规则，`resolveMaxOutputTokens(model, config)` 取 `min(配置值, 模型上限)`。

---

## 三、API 错误信息提取增强

`extractErrorMessage()` 按优先级提取：纯字符串 → `error.message` → `error`（字符串）→ 顶层 `message` → 兜底 HTTP 状态码。

---

## 四、TUI 上下文利用率指示器

状态栏显示 ctx badge：`ctx: 75% ▓▓▓▓▓▓▓░░░`，normal 绿 / warning 黄 / critical 红 / blocked 亮红。

---

## 五、TCODE_HOME / TCODE_BIN_DIR 环境变量

| 变量 | 作用 | 默认值 |
|------|------|--------|
| `TCODE_HOME` | 自定义配置目录 | `~/.tcode` |
| `TCODE_BIN_DIR` | 自定义 launcher 安装路径 | `~/.local/bin` |

---

## 六、错误处理工具函数统一

`isEnoentError()` / `getErrorCode()` 替代内联错误码检查，应用于 `permissions.ts`、`skills.ts`、`background-tasks.ts`。

---

## 涉及文件

| 文件 | 变更类型 |
|------|---------|
| `src/compact/constants.ts` | 新增 |
| `src/compact/prompt.ts` | 新增 |
| `src/compact/compact.ts` | 新增 |
| `src/compact/auto-compact.ts` | 新增 |
| `src/compact/microcompact.ts` | 新增 |
| `src/compact/manual-compact.ts` | 新增 |
| `src/utils/model-context.ts` | 新增 |
| `src/utils/token-estimator.ts` | 新增 |
| `src/utils/context.ts` | 修改 — 添加 COMPACTABLE_TOOLS |
| `src/types.ts` | 修改 — 添加 context_summary 角色、CompressionResult 类型 |
| `src/anthropic-adapter.ts` | 修改 — 添加 context_summary 消息处理 |
| `src/agent-loop.ts` | 修改 — 集成 microcompact + autoCompact |
| `src/tui/chrome.ts` | 修改 — renderContextBadge、contextStats、compressionStatus |
| `src/tui/index.ts` | 修改 — 导出 renderContextBadge |
| `src/tty-app.ts` | 修改 — /compact 命令、上下文状态管理 |
| `src/cli-commands.ts` | 修改 — 添加 /compact 命令 |
| `src/config.ts` | 修改 — TCODE_HOME 环境变量 |
| `src/install.ts` | 修改 — TCODE_BIN_DIR 环境变量 |
| `src/permissions.ts` | 修改 — 内联错误检查 → isEnoentError() |
| `src/skills.ts` | 修改 — 同上 |
| `src/background-tasks.ts` | 修改 — 内联错误检查 → getErrorCode() |
