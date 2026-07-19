# Anthropic Messages API 消息格式

## 基本结构

Anthropic Messages API 的对话历史由交替的 `user` / `assistant` 消息组成，每条消息内含一个 `content` 数组：

```
user:      [block, block, ...]
assistant: [block, block, ...]
user:      [block, block, ...]
assistant: [block, block, ...]
```

### Content Block 类型

| Block 类型 | 出现在 | 说明 |
|-----------|--------|------|
| `text` | assistant | 模型文本回复 |
| `tool_use` | assistant | 模型发起的工具调用 |
| `thinking` | assistant | 模型的内部推理（DeepSeek 推理模型） |
| `tool_result` | user | 工具执行结果，作为 user 消息返回 |
| `image` | user | 用户上传的图片 |

## 工具调用的消息格式

### 并行工具调用（多个 tool_use 不依赖彼此的结果）

模型在一次响应中发出多个 `tool_use`，它们**必须在同一个 assistant 消息中**：

```
assistant: [
  { type: "thinking",  thinking: "需要同时读 a.ts 和 b.ts", signature: "..." },
  { type: "tool_use",  id: "1", name: "read_file", input: { path: "a.ts" } },
  { type: "tool_use",  id: "2", name: "read_file", input: { path: "b.ts" } }
]

user: [
  { type: "tool_result", tool_use_id: "1", content: "..." },
  { type: "tool_result", tool_use_id: "2", content: "..." }
]
```

### 串行工具调用（后面的调用依赖前面的结果）

每个 `tool_use` 独立成一轮：

```
assistant: [{ type: "tool_use", id: "1", name: "list_files", ... }]
user:      [{ type: "tool_result", tool_use_id: "1", content: "..." }]

assistant: [{ type: "tool_use", id: "2", name: "read_file", input: { path: "config.ts" } }]
user:      [{ type: "tool_result", tool_use_id: "2", content: "..." }]
```

### ❌ 错误格式：interleaved（交织）

并行工具调用**不能**拆成多个 assistant 消息，这样会导致 API 报错：

```
assistant: [{ type: "tool_use", id: "1", ... }]
user:      [{ type: "tool_result", tool_use_id: "1", ... }]
assistant: [{ type: "tool_use", id: "2", ... }]    ← 同一轮的并行调用被拆开了
user:      [{ type: "tool_result", tool_use_id: "2", ... }]
```

## thinking block 的位置

`thinking` 是这一轮 assistant 消息的**第一个 block**，所有 `tool_use` 紧随其后：

```
assistant: [
  thinking,     ← 必须先于所有 tool_use
  tool_use_1,
  tool_use_2,
  ...
]
```

`thinking` 包含 `signature` 字段（API provider 的签名），在后续请求中必须原封不动回传，否则签名校验失败。

## 这么设计的理由

### 1. 语义完整性：一个 assistant 消息 = 一次模型推理

模型的每次响应是一个完整的推理单元。这个单元里，模型先思考（thinking），然后决定采取哪些行动（tool_use）。把同一次推理产出的多个 tool_use 拆到不同的 assistant 消息里，等于把一个推理过程撕成碎片，丢失了"这些操作来自同一次决策"的语义。

### 2. thinking 签名校验的连续性

`thinking` block 带签名，必须在后续请求中原样回传。如果一轮 assistant 消息被拆成多条，thinking block 只跟第一个 tool_use 在一起，后续 tool_use 发回时缺少对应的 thinking，API 校验就会失败。

### 3. tool_result 的归属

同一个 assistant 产出的所有 tool_use，它们的 tool_result 应该**一起**作为下一轮 user 消息返回。这样模型在看到所有结果后，才能在下一轮推理中综合判断。拆开的话，模型看到 tool_result_1 就开始下一轮推理了，但此时 tool_2 还没执行，模型在信息不全的情况下做决定——浪费 token，也不符合原始推理意图。

### 4. API 协议的一致性

Anthropic Messages API 的 `stop_reason` 机制是：
- `stop_reason: "tool_use"` → 这一轮结束了，模型发出了工具调用
- `stop_reason: "end_turn"` → 模型完成了回复

一次 `stop_reason: "tool_use"` 对应**一个** assistant 消息。如果一次 stop_reason 的产物被拆成多个 assistant 消息，就破坏了 API 轮次和消息结构的一一对应关系。

## 总结

| 规则 | 原因 |
|------|------|
| 同一轮的所有 tool_use 放在一个 assistant 消息 | 保持一次推理的语义完整性 |
| thinking 必须是 assistant 消息的第一个 block | 签名校验需要 thinking 与后续 tool_use 保持绑定 |
| 同一轮的所有 tool_result 放在一个 user 消息 | 让模型看到所有结果后再做综合判断 |
| user/assistant 严格交替 | API 协议要求，保证 stop_reason 与消息一一对应 |
