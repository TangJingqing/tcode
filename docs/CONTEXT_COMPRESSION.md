# 上下文压缩系统

## 一句话总结

对话太长时，自动清理旧工具输出、生成摘要，防止超出模型上下文窗口，让长对话不中断。

## 三级压缩机制

```
利用率 0% ───────── 50% ───────────── 85% ───── 95% ──── 100%
   │                  │                  │         │         │
   └── 正常           └── microcompact   └── autoCompact  └── 阻塞
                         轻量清理            LLM 摘要
```

### 前置：Tool Result Storage（大输出落盘，所有 step 执行）

在讨论三级压缩之前，有一个贯穿全流程的机制——Tool Result Storage。它不按利用率触发，而是针对**单个工具输出过大**或**单轮工具累计输出过大**的情况，将完整输出持久化到磁盘，上下文只保留摘要。

关键代码（`src/utils/tool-result-storage.ts`）：

```typescript
// 单个结果替换：content > 50K 字符 → 写盘，上下文只保留 2K 预览
export async function replaceLargeToolResult(result, state?) {
  if (content.length <= 50_000) return result              // 不够大，原样返回
  await persistToolResult(content, toolUseId)              // 写入 ~/.tcode/tool-results/<id>.txt
  return { ...result, content: buildPersistedMessage() }  // 替换为 <persisted-output> 预览
}

// 批量结果预算控制：单轮所有 tool_result 总大小 > 200K 字符
// → 按从大到小排序，优先把最大的结果持久化，直到总量回到预算内
export async function applyToolResultBudget(results, state, limit = 200_000) {
  // 计算 visibleSize，如果超预算就按 size 降序依次持久化
  // 已持久化过的结果不会重复写盘（通过 ContentReplacementState 追踪）
}
```

`ContentReplacementState` 在整个会话生命周期中保持，确保：
- 同一 toolUseId 的替换结果被缓存，不会重复写盘
- 空输出被标记为 `(toolName completed with no output)`
- 已持久化内容不会被二次处理

调用位置在 `agent-loop.ts` 的 tool call 处理中：

```typescript
// 第一步：对每个工具结果应用 replaceLargeToolResult
const toolResult = await replaceLargeToolResult({
  role: 'tool_result',
  toolUseId: call.id,
  toolName: call.toolName,
  content: result.output,
  isError: !result.ok,
}, contentReplacementState)

// 第二步：对整个批次应用 applyToolResultBudget 预算控制
const budgetedResults = await applyToolResultBudget(toolResults, contentReplacementState)
```

### 第一级：microcompact（轻量清理，利用率 ≥ 50%）

**策略**：把早期的 `tool_result` 内容替换为标记文本 `[Output cleared for context space]`，消息条数不变但体积大幅下降。只清理 `read_file`、`run_command`、`search_files`、`list_files`、`web_fetch` 这 5 种工具的输出，保留最近 3 条。

关键代码（`src/compact/microcompact.ts`）：

```typescript
export function microcompact(messages: ChatMessage[], model: string): ChatMessage[] {
  const stats = computeContextStats(messages, model)
  // 利用率不到 50%，跳过
  if (stats.utilization < THRESHOLDS.MICROCOMPACT_UTILIZATION) return messages

  // 找到所有可清理的 tool_result 下标
  const toolResultIndices: number[] = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'tool_result' && COMPACTABLE_TOOLS.has(messages[i].toolName)) {
      toolResultIndices.push(i)
    }
  }

  // 总数不超过 3 条就不清理
  if (toolResultIndices.length <= RETENTION.KEEP_RECENT_TOOL_RESULTS) return messages

  // 只清理前面的，保留最近 3 条
  const keepFrom = toolResultIndices.length - RETENTION.KEEP_RECENT_TOOL_RESULTS
  const indicesToClear = new Set(toolResultIndices.slice(0, keepFrom))

  const result = messages.map((msg, i) => {
    if (indicesToClear.has(i)) {
      return { ...msg, content: '[Output cleared for context space]' }
    }
    return msg
  })
  return result
}
```

调用时机：**每个 agent step 循环开始时**执行一次。

### 第二级：autoCompact（LLM 摘要压缩，利用率 ≥ 85%）

**策略**：把早期对话发给 LLM 生成一段结构化摘要，包含"用户请求/关键决策/修改文件/错误固定/当前状态/待办任务"六个部分。早期消息被替换成一条 `context_summary` 消息。

触发判断（`src/compact/auto-compact.ts`）——`shouldAutoCompact` 从 `autoCompact` 中提取为独立函数，便于单测：

```typescript
export function shouldAutoCompact(messages: ChatMessage[], model: string): boolean {
  const stats = computeContextStats(messages, model)
  const shouldCompact = stats.utilization >= THRESHOLDS.AUTOCOMPACT_UTILIZATION
  // 设置 TCODE_DEBUG_AUTOCOMPACT=1 可看到每次判断的详细日志
  debugAutoCompact(
    `source=${stats.accounting.source} total=${stats.accounting.totalTokens} ` +
      `provider=${stats.accounting.providerUsageTokens} estimate=${stats.accounting.estimatedTokens} ` +
      `utilization=${stats.utilization.toFixed(3)} threshold=${THRESHOLDS.AUTOCOMPACT_UTILIZATION} ` +
      `should=${shouldCompact}`,
  )
  return shouldCompact
}
```

调用时机（`src/agent-loop.ts`，每个 step 前）：

```typescript
// step=0 必定检测，后续 step 在 critical/blocked 时也触发
if (modelName) {
  const stats = computeContextStats(messages, modelName)
  const shouldCheck =
    step === 0 ||
    stats.warningLevel === 'critical' ||
    stats.warningLevel === 'blocked'
  if (shouldCheck) {
    const result = await autoCompact(messages, modelName, args.model)
    if (result) {
      messages = result.messages
    }
  }
}
```

核心压缩逻辑（`src/compact/compact.ts`）：

```typescript
export async function compactConversation(
  messages: ChatMessage[],
  modelAdapter: ModelAdapter,
): Promise<CompressionResult | null> {
  // 使用 provider usage + 估算的混合计数（优先 API 返回的精确值）
  const tokensBefore = tokenCountWithEstimation(messages).totalTokens

  // 找保留边界：从尾部向前累计，保留最近 ~40K tokens
  const boundary = findRetentionBoundary(messages)
  const messagesToCompress = messages.slice(1, boundary)   // 要被压缩的
  const messagesToKeep = messages
    .slice(boundary)
    // 保留的消息中的 provider usage 标记为 stale
    // 因为压缩后消息列表结构变了，旧的 usage 数据不再准确
    .map(message => markProviderUsageStale(
      message,
      'conversation was compacted after this provider usage was recorded',
    ))

  // 把旧消息转成文本，让 LLM 生成摘要
  const conversationText = messagesToText(messagesToCompress)
  const response = await modelAdapter.next([{
    role: 'user',
    content: buildCompactSummaryPrompt(conversationText),
  }])

  // 解析 <summary> 标签
  const summaryContent = parseSummaryFromResponse(response.content)

  // 组装新消息：系统消息 + 摘要 + 保留消息（含 stale 标记）
  return {
    messages: [
      ...systemMessages,
      { role: 'context_summary', content: summaryContent, ... },
      ...messagesToKeep,
    ],
    removedCount: messagesToCompress.length,
    tokensBefore,
    tokensAfter: tokenCountWithEstimation(newMessages).totalTokens,
  }
}
```

保留边界算法（`findRetentionBoundary`）：

```typescript
// 从尾部向前扫，累积 token 不超过 40K
// 同时确保至少保留 6 条消息
// 且不能切断 tool_use/tool_result 配对
for (let i = messages.length - 1; i >= 1; i--) {
  tokenSum += estimateTokens(messages[i])
  if (tokenSum > 40_000) break      // 达到保留上限
  boundary = i
}
```

摘要 prompt（`src/compact/prompt.ts`）要求 LLM 输出六个部分：

```
1. Primary Request — 用户请求
2. Key Decisions — 关键决策
3. Files Modified — 修改了哪些文件、为什么
4. Errors Encountered — 遇到的错误和解决方案
5. Current State — 当前状态
6. Pending Tasks — 待办任务
```

失败保护：连续 3 次压缩失败自动禁用 autoCompact，防止反复消耗 token。`parseSummaryFromResponse` 解析不到 `<summary>` 标签也会返回 null，避免把模型自由发挥的内容当作摘要注入上下文。

### 第三级：/compact 命令（手动触发）

用户随时输入 `/compact` 主动压缩，与 autoCompact 共用同一套 `compactConversation` 逻辑。成功后重置 autoCompact 失败计数。

```typescript
// src/tty-app.ts
if (input === '/compact') {
  const result = await manualCompact(args.messages, args.model)
  // 显示压缩结果：Saved 45% (85000 tokens)
}
```

## Token 估算

`src/utils/token-estimator.ts` 提供两层 token 计数策略：

### 第一层：基于 chars/token 的估算（`estimateMessagesTokens`）

作为兜底方案，当没有 provider 精确数据时使用。

**英文/拉丁文本** chars/token 基准：

| 角色 | chars/token |
|------|-------------|
| system | 3.5 |
| user | 3.0 |
| assistant | 3.5 |
| assistant_tool_call | 2.5 |
| tool_result | 2.0 |
| context_summary | 3.5 |

**CJK 字符（中日韩）** ：固定 **1.5 chars/token**。大多数 tokenizer 对 CJK 字符的编码密度远高于拉丁字母——一个汉字通常占 1-2 个 token，而一个英文单词（4-6 字母）通常只占 1 个 token。

**混合文本计算**：

```typescript
export function estimateMessageTokens(message: ChatMessage): number {
  const baseRatio = CHARS_PER_TOKEN_BASE[message.role] ?? 3.0
  const text = getMessageText(message)
  const cjkCount = countCJKChars(text)

  if (cjkCount === 0) {
    return Math.ceil(text.length / baseRatio)           // 纯英文，走原逻辑
  }

  // 混合文本：CJK 部分走 1.5，其余走角色对应的 baseRatio
  const nonCJKChars = text.length - cjkCount
  return Math.ceil(cjkCount / 1.5 + nonCJKChars / baseRatio)
}
```

**举例**：一条 `user` 消息 "你好，请帮我修复这个 bug"（14 个字符，其中 10 个 CJK + 4 个拉丁/标点）

| | 之前（纯英文比例） | 现在（混合估算） |
|--|--|--|
| 计算 | `14 / 3.0 = 5` | `10/1.5 + 4/3.0 = 6.7 + 1.3 = 8` |
| 估算 token | **5** | **8** |

差距 60%。对话中文占比越高，之前低估越严重。

### 第二层：Provider Usage 精确计数（`tokenCountWithEstimation`）

当 API 响应中包含 `usage` 字段（Anthropic 返回 `input_tokens`/`output_tokens`），系统会**优先使用 API 的精确计数**，只对 usage boundary 之后的尾部消息用估算补齐。这比纯估算准确得多。

```typescript
export function tokenCountWithEstimation(messages: ChatMessage[]): TokenAccountingResult {
  // 从尾部向前扫描，找最后一个带有效 providerUsage 的消息（且未标记 stale）
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = messageProviderUsage(messages[i])
    if (!usage) continue
    // 找到精确边界：usage.totalTokens + 边界之后消息的估算值
    const tailEstimate = estimateMessagesTokens(messages.slice(i + 1))
    return {
      totalTokens: usage.totalTokens + tailEstimate,
      providerUsageTokens: usage.totalTokens,
      estimatedTokens: tailEstimate,
      source: tailEstimate > 0 ? 'provider_usage_plus_estimate' : 'provider_usage',
    }
  }
  // 没有可用 provider usage → 全部走估算
  return { totalTokens: estimateMessagesTokens(messages), source: 'estimate_only' }
}
```

**Provider Usage 来自哪里？** `anthropic-adapter.ts` 在每次 API 响应中解析 `usage` 字段，转为 `ProviderUsage` 对象，附加到返回的 `AgentStep` 上。`agent-loop.ts` 中的 `withProviderUsage` 函数将其写入对应的 `assistant` / `assistant_progress` / `assistant_tool_call` 消息：

```typescript
function withProviderUsage<T extends ChatMessage>(message: T, usage?: ProviderUsage): T {
  if (!usage) return message
  if (message.role === 'assistant' || message.role === 'assistant_progress'
      || message.role === 'assistant_tool_call') {
    return { ...message, providerUsage: usage }
  }
  return message
}
```

**Stale 标记机制**：当 `compactConversation` 压缩后，保留消息中的 provider usage 会被 `markProviderUsageStale` 标记为失效——因为消息列表结构已变，旧的 usage 数据不再反映当前 token 布局。`tokenCountWithEstimation` 会跳过 stale 消息，退回到估算模式。

三种 `accounting.source` 值对应的 TUI 显示：

| source | TUI badge 后缀 | 含义 |
|--------|---------------|------|
| `provider_usage` | `usage` | 最后一条消息就是 provider boundary，完全精确 |
| `provider_usage_plus_estimate` | `usage+est` | provider 精确值 + 尾部估算 |
| `estimate_only` | `est` | 无可用 provider 数据，全程估算 |

## 模型上下文窗口映射

`src/utils/model-context.ts` 记录每个模型的上下文窗口和输出预留量：

```
claude-opus-4-6     contextWindow: 200K   outputReserve: 16K   → 有效输入: 184K
gemini-2.5-pro      contextWindow: 1M     outputReserve: 16K   → 有效输入: 1,032K
deepseek-chat       contextWindow: 128K   outputReserve: 4K    → 有效输入: 124K
未知模型             contextWindow: 128K   outputReserve: 8K    → 有效输入: 120K
```

## 完整数据流

```
用户输入 → runAgentTurn()
  │
  └─ 每个 step:
       ├─ microcompact()        utilization ≥ 50% → 清理旧 tool_result
       ├─ computeContextStats()  计算利用率（优先用 provider usage）
       ├─ autoCompact()         step=0 或 utilization ≥ 85% →
       │     ├─ LLM 生成摘要
       │     ├─ 保留消息的 provider usage 标记为 stale
       │     └─ 返回 context_summary + 保留尾部
       ├─ model.next()          正常推理
       │     └─ API 响应中的 usage 字段 → ProviderUsage 存入消息
       └─ 工具执行后:
             ├─ replaceLargeToolResult()  单个 > 50K chars → 持久化到磁盘
             └─ applyToolResultBudget()   整批 > 200K chars → 大者优先落盘
```

## TUI 展示

状态栏左上方显示上下文利用率 badge，末尾标注 token 计数来源：

```
ctx: 25% ▓▓░░░░░░░░ usage     绿色 = normal（精确计数）
ctx: 58% ▓▓▓▓▓▓░░░░ usage+est  黄色 = warning（精确+估算）
ctx: 88% ▓▓▓▓▓▓▓▓▓░ est        红色 = critical（纯估算）
ctx: 97% ▓▓▓▓▓▓▓▓▓▓ est        亮红 = blocked
```

- `usage`：最后一条消息正好是 provider usage boundary，完全精确
- `usage+est`：有 provider 精确数据 + 尾部消息走估算
- `est`：无可用 provider 数据，全程走 chars/token 估算

footer 栏显示压缩状态：`| Saved 45% (85000 tokens)`

## 涉及文件

```
src/compact/
├── constants.ts      阈值配置
├── prompt.ts         摘要 prompt + 解析
├── compact.ts        核心压缩（保留边界 + LLM 摘要）
├── auto-compact.ts   自动压缩触发
├── microcompact.ts   轻量 tool_result 清理
└── manual-compact.ts /compact 入口

src/utils/
├── model-context.ts       模型上下文窗口映射
├── token-estimator.ts     Token 估算 + Provider Usage 精确计数 + 利用率计算
└── tool-result-storage.ts 大工具输出持久化 + 批量预算控制

src/agent-loop.ts         集成微压缩 + 自动压缩 + tool result storage + ProviderUsage 注入
src/anthropic-adapter.ts  usage 字段解析 → ProviderUsage，context_summary → [Context Summary]
src/types.ts              ProviderUsage + ProviderUsageMetadata + context_summary + CompressionResult
src/tty-app.ts            /compact 命令 + ContentReplacementState 生命周期
src/tui/chrome.ts         ctx badge 渲染（含 source 标签）
src/cli-commands.ts       /compact 命令注册
```

---

## 面试拷打

> 以下模拟面试官针对上下文压缩系统的深度追问，每题附满分答法。

### Q1：你为什么用 chars/token 比例估算而不是接入 tiktoken？

**考点**：工程 trade-off 判断力

**满分答法**：

> 这是有意为之的 trade-off。用 tiktoken 做精确计数需要：引入 Python 依赖或者把 tokenizer 的 vocab 文件打包进 Node 进程，单是 cl100k_base 的 tokenizer 文件就接近 2MB，冷启动加载需要额外 50-100ms。对于 50% 和 85% 这两个阈值判断，"3.0 chars/token 估算"和"精确 token 计数"的误差通常在 ±15% 以内，不会影响压缩决策的正确性——因为决策依赖的是趋势而非绝对值。如果真的误判了，最坏情况是晚一步触发压缩（多消耗一些 token 但不会崩溃），或者早一步触发（多做一次清理但不丢信息）。这两种都比引入一个重量级依赖的维护成本低得多。如果将来需要更高精度，可以考虑用 WebAssembly 版的 tokenizer 做懒加载。

### Q2：microcompact 把旧 tool_result 内容清掉了，模型后续需要用到那些信息怎么办？

**考点**：对信息丢失风险的认知

**满分答法**：

> 保留最近 3 条 tool_result 是关键设计——模型在单步推理中最可能需要的是"刚刚发生了什么"，而不是"10 步之前 grep 返回了哪些文件"。被清理的都是早期、历史性的工具输出，它们的作用已经被模型消化并转化为了后续行为。如果模型真的需要那些信息，比如"之前读过的那个文件的某一行"，autoCompact 生成的摘要里会记录"Files Modified"和关键细节。退一步说，microcompact 是可逆的设计——消息结构没变、角色没变，content 变成了 `[Output cleared for context space]` 这个标记本身就向模型传递了一个信号："此处曾有输出但已被清理，如需详细信息请重新操作"。这比删消息好，因为删消息会破坏 tool_use/tool_result 配对导致 API 报错。

### Q3：50% 和 85% 这两个阈值怎么来的？有数据支撑吗？

**考点**：是否有实验思维 vs 拍脑袋

**满分答法**：

> 阈值确实没有经过大规模 A/B 测试，但有几层依据：第一，50% 是"安全冗余线"——大部分模型上下文窗口 128K-200K，在 50% 即 64K-100K 时做轻量清理，对用户体验完全无感但能为后续对话留出一半空间。第二，85% 触发 LLM 摘要是因为此时剩余有效空间约 20K-30K tokens，刚好是一次完整 tool-call 往返的典型消耗（读文件+搜索+run command 输出），再等就来不及了。第三，如果我要验证这些阈值，会做离线回放测试——收集 100 次真实长对话的 message 序列，在 50%/60%/70%/80% 几个候选点分别模拟 microcompact，对比压缩后消息列表能否被模型正确理解（用一个小模型做 next-token continuation 评估），选混淆度最低的阈值。这是一个可以工程化验证的问题。

### Q4：如果 LLM 生成的摘要质量很差怎么办？

**考点**：对边界情况的认知和兜底设计

**满分答法**：

> 有多层防护：第一，`compactConversation` 入口处就有三道基础检查——消息总数 ≤ 2 跳过、非系统消息不足 `MIN_KEEP_MESSAGES` 跳过、找不到可压缩消息跳过。第二，LLM 返回空响应或非 assistant 类型直接返回 null。第三，`parseSummaryFromResponse` 解析不到 `<summary>` 标签也返回 null——避免把模型自由发挥的内容当作摘要注入上下文。第四，也是最重要的兜底：连续 3 次 autoCompact 失败自动禁用整个 autoCompact 机制，防止反复浪费 token。这形成了一条"尝试→失败→退避"的防御链，确保不会越压越糟。此外，Tool Result Storage 在工具输出层面就已经把超大内容（>50K 字符）剥离到磁盘，减少了压缩时需要处理的文本量，间接降低了摘要失控的风险。

### Q5：你为什么不用 API 自带的 prompt caching？自己做压缩是不是重复造轮子？

**考点**：对主流方案了解程度 + 设计选择辩护能力

**满分答法**：

> Anthropic 的 prompt caching 和这个压缩系统解决的是不同层次的问题。Prompt caching 解决的是"同一个 prefix 重复发送时的带宽和延迟"，它要求前缀严格按字节匹配，一旦中间插入一条新消息，后续所有块的缓存全部失效。而上下文压缩解决的是"消息太多，不压就爆窗口"——即使 API 每次都传全部消息且免费秒回，窗口满了一样会被截断或拒绝。两者是互补关系：压缩减少绝对消息量，caching 让剩余消息传输更快。理想状态下，系统消息 + context_summary 构成一个稳定前缀被缓存，只有尾部保留消息频繁变化，压缩反而让 caching 命中率更高。

### Q6：tool_use 和 tool_result 的配对你是怎么保证不切断的？

**考点**：细节实现是否考虑周全

**满分答法**：

> `findRetentionBoundary` 确定保留边界后，会检查边界位置的第一个消息——如果恰好是 `tool_result`，就向前扫描找到匹配的 `tool_use`（通过 `toolUseId` 匹配），把边界前移到 `tool_use` 的位置。这样要么一整对都保留，要么一整对都被压缩进摘要，不会出现上半截在摘要里、下半截在保留区的情况。Anthropic API 要求每个 `tool_use` 必须有对应的 `tool_result`，切断配对会导致 400 错误。

### Q7：为什么 autoCompact 只在 step 0 执行？如果 agent 循环跑了 8 步，中间上下文涨超了怎么办？

**考点**：对设计边界和局限的诚实认知

**满分答法**：

> 现在已经不局限在 step 0 了。当前设计是：step 0 必定检测一次利用率；后续每个 step 也会计算 `computeContextStats`——O(n) 纯计算、开销极小——只要发现 warningLevel 进入 critical 或 blocked 就触发压缩。这样能兜住 mid-turn 突发情况：比如某次 `read_file` 拉了一个 50K 的日志文件，step 2 利用率从 60% 跳到 90%，step 3 开始前就会触发 autoCompact。为什么不是每个 step 无条件检查？因为 `shouldAutoCompact` 只是做一次 O(n) 的利用率计算，开销极小——真正的 LLM 调用只在利用率超过 85% 阈值时才会触发。microcompact 仍然每个 step 必跑，作为第一道防线。两者配合后：microcompact 抑制缓慢增长，autoCompact 应对突发跃升。另外 Tool Result Storage 在工具输出阶段就把 >50K 的单次输出写入磁盘，这也从源头减少了 mid-turn 上下文暴涨的概率。

### Q8：context_summary 消息在后续对话中会怎么被处理？如果摘要本身也要被再次压缩呢？

**考点**：对系统演进和递归场景的思考

**满分答法**：

> 当前实现有两个层面的处理：第一，`toAnthropicMessages` 把 `context_summary` 转为 `[Context Summary from earlier conversation]\n...` 的前缀 user 消息发给 API，模型看到的是一段标注了来源的历史回顾。第二，`token-estimator` 中 `context_summary` 按 3.5 chars/token 估算，`messagesToText` 中标记为 `[Previous Summary]: ...`。如果摘要本身也需要被再次压缩——即对话长到连摘要都堆积了——当前 `compactConversation` 的 `messagesToCompress` 会包括旧的 context_summary，文本化的格式是 `[Previous Summary]: <内容>`，新一轮 LLM 摘要会提取关键信息并生成新的 context_summary。这实际上形成了一种"递进式摘要"——最早的细节被逐步抽象，但核心信息通过 summary-of-summary 保留了下来。和学术界 "Recursive Summarization" 的思路一致，只是我这里是隐式的而非显式递归调用。

### Q9：压缩的延迟对用户体验有什么影响？你怎么和用户沟通"正在压缩中"？

**考点**：产品思维

**满分答法**：

> autoCompact 发生在 turn 开始时，用户刚提交完输入在等待第一个响应，此时多等 2-5 秒做压缩比 mid-turn 突然卡顿可接受得多——因为用户预期中"开始思考"本身就需要时间。TUI 层面，状态栏会从"Thinking..."变成"Compressing context..."，footer 压缩完成后显示 `Saved 45% (85000 tokens)`。microcompact 完全无感——纯 CPU 计算，O(n) 遍历消息列表，几百条消息也就不到 1ms。手动 /compact 会阻塞输入直到完成，但那是用户主动触发的，延迟是可预期的——就像 git gc，你知道它要跑一会儿。

### Q10：工具输出太大你是怎么处理的？为什么要存到磁盘？

**考点**：对上下文管理的全面思考——不只是压缩对话，还要从源头控制输入

**满分答法**：

> Tool Result Storage 是三阶段压缩体系的前置过滤器，解决的是"单个工具输出太大"这个特殊场景。比如 `run_command` 跑了一个 100K 的日志输出，直接塞进上下文会把利用率瞬间推上去，甚至直接触发 blocked。我分两层处理：第一层 `replaceLargeToolResult`——单个结果超过 50K 字符就把它持久化到 `~/.tcode/tool-results/<session-id>/<toolUseId>.txt`，上下文里只保留 `<persisted-output>` 标记 + 前 2K 字符预览 + 文件路径。第二层 `applyToolResultBudget`——整轮所有工具输出的累计大小超过 200K 字符时，按从大到小排序，优先持久化最大的那些结果，直到总量回到预算内。`ContentReplacementState` 在整个会话生命周期中跟踪哪些结果已被替换，保证不会重复写盘。为什么选 50K 这个值？它是一个实验性阈值——足够容纳绝大部分正常的文件读取和命令输出，同时确保单条消息不占用超过窗口的 ~40%（对于 128K 窗口的模型）。用户需要完整输出时可以去磁盘文件查看，这是一种"延迟加载"策略——和操作系统虚拟内存把冷页面换出到磁盘的思路一致。

### Q11：API 已经返回了精确的 token 用量，你为什么还保留 chars/token 估算？

**考点**：对混合策略的理解和工程实用性判断

**满分答法**：

> 两者互补而非互斥。`tokenCountWithEstimation` 的策略是：从消息列表尾部向前扫描，找到最后一条带有效 provider usage 的消息，将其 `totalTokens` 作为精确基准，usage boundary 之后的尾部消息用 chars/token 估算补齐。Provider usage 覆盖了大部分上下文（因为它是最近一次 API 调用的真实数据），估算只负责边界之后新加入的几条消息——通常就是最新一轮的用户输入和工具结果，这几条的估算误差在总 token 数中占比很小。但如果 provider usage 被 `markProviderUsageStale` 标记了——比如压缩后消息列表结构已变——那就全部退回估算模式。关键设计是 `usageStale` 标记：压缩后的保留消息虽然有旧的 provider usage 数据，但它不再反映当前消息列表的真实 token 分布（消息被删了、被摘要替代了），必须让它失效，否则会严重低估利用率。这和数据库的"stale read"问题是同构的——宁可退回到精度较低的估算，也不能让一个已经失真的精确值误导决策。TUI badge 末尾的 `usage`/`usage+est`/`est` 标签让用户能直接看到当前处于哪种模式，增加了系统的可观测性。

### Q12：如果你来重新设计这个系统，你会改什么？

**考点**：反思能力 + 成长性

**满分答法**：

> 三个改进方向：**第一**，chars/token 估算换成一个轻量的本地 tokenizer，比如用 WASM 编译的 cl100k_base，在首次使用时懒加载，精度提升后阈值可以调得更激进（比如 microcompact 从 50% 提到 60%）。**第二**，autoCompact 不应该硬编码只在 step 0 运行，应该做一个 mid-turn 的快速检测——如果当前 step 后发现利用率跃升超过 15%，说明这步产生了大量输出，下一个 step 前应该触发压缩。**第三**，也是最重要的——应该引入一个压缩质量评估机制，至少让压缩后的消息列表跑一次空模型调用（dummy call 或不实际执行的 evaluation），验证模型还能正确理解任务上下文，如果理解偏差过大就回滚。当前全靠"压缩比原始好"这个假设，缺少客观的质量信号。
