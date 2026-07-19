# 上下文压缩系统

## 一句话总结

对话太长时，自动清理旧工具输出、生成摘要，防止超出模型上下文窗口，让长对话不中断。

## 五级压缩机制

```
利用率 0% ────── 50% ────── 70% ────── 75% ───────── 85% ───── 95% ──── 100%
   │               │          │          │               │         │         │
   └── 正常        └── microcompact  └── snipCompact  └── contextCollapse  └── autoCompact  └── 阻塞
                      轻量清理         确定性截断       LLM 摘要投影       LLM 全量压缩
```

### 前置：Tool Result Storage（大输出落盘）

在五级压缩之前，有一个全流程生效的机制——当工具输出太大时，自动把完整内容写到磁盘文件，上下文里只留一个简短的预览标记。

- **单个结果 > 50K 字符**：写盘到 `~/.tcode/tool-results/`，上下文只保留前 2K 字符预览
- **单轮累计 > 200K 字符**：按从大到小排序，优先把最大的结果持久化，直到总量回到预算内
- 同一结果不会重复写盘，已持久化的内容不会被二次处理

**设计理由**：这是"从源头控制"的思路——后面的五级压缩处理的都是"对话自然增长"的问题，但如果某个工具单次输出了 100K 的日志，瞬间就能把利用率从 50% 推到 90%，等下一级压缩反应过来可能已经来不及了。与其等压缩来救火，不如在输出阶段就把特大内容拦截下来。

**优点**：零延迟，纯文件 I/O；用户随时可以查看完整输出；不丢信息。

**缺点**：模型只看到 2K 预览，如果预览不能体现完整输出的关键信息，模型可能做出错误判断——比如日志的前 2K 没有报错，但后面全是 error。

### 第一级：microcompact（轻量清理，利用率 ≥ 50%）

**做什么**：把早期的 `tool_result` 内容替换为 `[Output cleared for context space]`，消息条数不变但体积大幅下降。只清理 `read_file`、`run_command`、`search_files`、`list_files`、`web_fetch` 这 5 种工具的输出，保留最近 3 条。

**设计理由**：50% 是最宽松的触发线——此时上下文才用了一半，远没到危险区。但很多工具输出（比如读了一个 5000 行的文件）体积大但时效性短——模型看完了、改完了，这个输出就不再需要了。此时清掉它们是"零风险"操作：利用率低，即使估算不准也不会误伤；消息结构不变，不会破坏 tool_use/tool_result 配对；清掉的是最老旧、最不可能被再次需要的内容。

**优点**：极快（O(n) 遍历），不调模型，不影响消息结构，API 不会感知到变化。

**缺点**：只清 content 不删消息，消息条数不变——如果对话到了几百条消息，即使每条 content 都很短，消息本身的元数据（role、toolUseId 等）也会累积占用空间。所以它只能"延缓"增长，不能"逆转"增长。

### 第二级：snipCompact（确定性截断，利用率 ≥ 70%）

**做什么**：不调用模型，纯算法找到对话历史中段"安全"的连续消息区间，直接删除，在被删位置插入一条 `snip_boundary` 标记。

**设计理由**：这是 microcompact 不够用、但 autoCompact 又太重的中间地带。microcompact 只清 content 不删消息——当对话从 50 条涨到 200 条，光靠清 content 已经压不住了。但 autoCompact 需要调一次 LLM（2-5 秒 + 消耗 token），在 70% 这个利用率触发 LLM 压缩显得过早——此时还有 30% 空间，约 40K-60K tokens，完全够好几轮对话。所以需要一个比 microcompact 更激进（直接删消息）但又比 autoCompact 更轻量（不调模型）的手段。

**怎么判断"安全"**：以下消息不会被删——

- 最近 12 条消息
- 最后一条用户消息之后的所有内容
- system / context_summary / snip_boundary 等边界消息
- 文件编辑工具（edit/patch/write/modify）及其前后各一条
- 包含错误信息（error/failed/exception/traceback）的消息及其前后各一条
- 不完整的 tool_call 和孤立的 tool_result

算法选 token 最多的安全区间，目标是把利用率降到 60%。

**保护机制示意**：

```
[system]              ← 保护（边界消息）
[user: 开始]
[assistant: 旧回复1]
[user: 旧追问1]        ← 安全区间①（可删，token 最多）
[assistant: 旧回复2]
[assistant: 分析]      ← 保护（文件编辑的邻居）
[patch_file 调用]      ← 保护（文件编辑工具）
[patch_file 结果]      ← 保护（配对不可拆）
[assistant: 继续]      ← 保护（文件编辑的邻居）
[assistant: 旧回复3]
[user: 旧追问3]        ← 安全区间②（可删，token 较少）
[assistant: 最新回复]
[user: 当前任务]        ← 保护（最近 12 条 / 最新 user 之后）
```

**优点**：零 API 调用，毫秒级完成，不消耗 token；保护规则保守，误删风险低；被删位置有 `snip_boundary` 标记，模型知道有内容被移除了。

**缺点**：不可逆——删了就没了，session 恢复后也看不到被删的内容（只有一条 boundary 标记告诉你"这里删了 18 条消息"）；保护规则是静态的，不能理解语义——比如一段看似"安全"的对话可能包含了关键的设计决策，算法判断不出来；只做一次截断，如果利用率还是很高不会继续删。

### 第三级：contextCollapse（LLM 摘要投影，利用率 ≥ 75%）

**做什么**：和 snipCompact 的本质区别——**消息一条不删**，只是发给模型之前，把老旧的安全区间替换为 LLM 生成的摘要。原始对话在 session 文件和用户界面上完整保留，只有模型看到的是摘要版。

可以理解成给模型戴了一副"摘要眼镜"——模型透过眼镜看到的是压缩后的视图，但你和 session 记录看到的始终是完整对话。

**设计理由**：snipCompact 到 70% 才触发、只做一次，如果对话继续增长，删完一轮后利用率可能又慢慢涨回来了。此时有两个选择：再删一轮（但 snipCompact 每个 turn 只做一次），或者上 autoCompact（但 75% 离 85% 还有距离，上全量压缩太激进）。contextCollapse 卡在中间——它比 snipCompact 聪明（LLM 理解语义后再压缩），又比 autoCompact 温和（只压缩老旧区间，不碰最近的对话，且原始消息不丢）。

**优点**：
- 消息不丢，session 随时可以恢复完整对话
- LLM 理解语义，摘要质量比纯规则截断高
- 可以累积多个 span，每次 max 2 个，渐进式压缩
- 用户界面完全无感——你看到的 transcript 始终是完整的

**缺点**：
- 需要调 LLM，有 2-5 秒延迟和 token 消耗
- 摘要质量依赖模型能力——模型如果没理解关键信息，摘要可能漏掉重要细节
- 连续 3 次失败自动禁用，之后只能靠 autoCompact 兜底
- 状态管理复杂——每次 `/new`、`/snip`、`/compact` 都要重置投影

**和另外两种的区别**：

| | snipCompact | contextCollapse | autoCompact |
|---|---|---|---|
| 调用模型 | 否 | 是 | 是 |
| 消息是否删除 | 直接删除（不可逆） | 不删，原始 transcript 完整保留 | 全部历史替换为一条摘要 |
| 压缩范围 | 中间安全区间 | 老旧安全区间（可累积多个） | 全部早期消息 |
| 延迟 | < 1ms | 2-5 秒 | 2-5 秒 |

### 第四级：autoCompact（LLM 全量压缩，利用率 ≥ 85%）

**做什么**：把早期对话全部发给 LLM，生成一段结构化摘要（用户请求 / 关键决策 / 修改文件 / 遇到的错误 / 当前状态 / 待办任务），早期消息被替换为一条 `context_summary`。从尾部向前保留最近约 40K tokens，不切断 tool_use/tool_result 配对。

**设计理由**：85% 是"再不压就来不及了"的线——此时剩余空间约 20K-30K tokens，刚好是一次完整 tool-call 往返的典型消耗（读文件 + 搜索 + 执行命令 + 模型输出）。前面三级（Tool Result Storage → microcompact → snipCompact → contextCollapse）已经尽力了，如果利用率还是到了 85%，说明对话确实太长了，需要一次彻底的"大扫除"。

**优点**：
- 压缩比最高——一次能把几百条消息压成几百字的摘要
- 结构化摘要强制 LLM 保留关键信息（文件路径、错误信息、决策记录）
- 保留最近 40K tokens 的尾部，当前工作上下文不受影响

**缺点**：
- 延迟最高（需要等 LLM 生成摘要）
- 不可逆——历史消息全部被摘要替代，丢失细节
- 摘要质量完全依赖 LLM，如果摘要遗漏了重要信息，后续对话可能"跑偏"
- 连续 3 次失败自动禁用，此时系统只剩 microcompact 和 snipCompact 可用

### 第五级：手动命令

- **`/snip`** — 确定性截断，不调用模型，零延迟。适合在发起大任务前主动腾空间
- **`/collapse`** — LLM 摘要投影，原始 transcript 不丢。适合想长期保留完整对话的场景
- **`/compact`** — LLM 全量压缩，忽略阈值强制执行。适合"我不管现在利用率多少，先压了再说"

## 整体设计思路

五级压缩不是一开始就规划好的，而是按"代价从低到高"逐步叠加的：

```
代价:  零 ───────────→ 低 ───────────→ 中 ────────────→ 高
       Tool Result    microcompact    contextCollapse   autoCompact
       Storage        snipCompact
```

**核心原则**：能用便宜的方法解决问题，就绝不用贵的。所以顺序是——

1. 先拦源头（大输出落盘）
2. 再清死数据（清旧 tool_result content）
3. 还不够就删安全区间（纯算法截断）
4. 还不够就用 LLM 压缩老旧区间（保留原文）
5. 最后才全量压缩（全部历史换摘要）

每一级都是上一级不够用时的"升级选项"，而不是替代关系。它们同时存在、按阈值依次触发，形成一条从"几乎无代价"到"高代价但高效果"的渐进防御链。

## Token 估算

系统用两层策略计算 token 数：

**第一层：chars/token 估算**（兜底方案）。不同角色的消息用不同的比例估算——user 消息约 3.0 chars/token，assistant 约 3.5，tool_result 约 2.0。CJK 字符（中日韩）统一按 1.5 chars/token 计算，因为它们编码密度远高于拉丁字母。

**第二层：Provider Usage 精确计数**（优先使用）。当 API 返回了 `usage` 字段（Anthropic 返回 `input_tokens`/`output_tokens`），就用 API 的精确值作为基准，只对 API 返回之后新增的尾部消息用估算补齐。这样大部分上下文的计数是精确的，估算误差只在很小的尾部。

TUI 上用后缀区分计数来源：`usage`（完全精确）、`usage+est`（精确+估算混合）、`est`（纯估算）。

## 模型上下文窗口映射

不同模型有不同的上下文窗口大小，系统预留一部分给模型输出，剩余作为有效输入空间：

```
claude-opus-4-6     200K 窗口 → 184K 有效输入
gemini-2.5-pro      1M 窗口   → 1,032K 有效输入
deepseek-chat       128K 窗口 → 124K 有效输入
未知模型             128K 窗口 → 120K 有效输入
```

## 完整数据流

```
用户输入 → runAgentTurn()
  │
  └─ 每个 step:
       ├─ snipCompactConversation()  利用率 ≥ 70% → 删除安全区间，插入 snip_boundary
       ├─ microcompact()             利用率 ≥ 50% → 清理旧 tool_result 内容
       ├─ contextCollapse()          利用率 ≥ 75% → LLM 生成区间摘要，构建投影视图
       ├─ computeContextStats()      计算利用率（优先用 provider usage）
       ├─ autoCompact()              利用率 ≥ 85% → LLM 全量压缩，重置 collapse 状态
       ├─ model.next()               正常推理（使用 collapse 投影视图）
       └─ 工具执行后:
             ├─ replaceLargeToolResult()  单个 > 50K chars → 持久化到磁盘
             └─ applyToolResultBudget()   整批 > 200K chars → 大者优先落盘
```

## TUI 展示

状态栏左上方显示上下文利用率 badge：

```
ctx: 25% ▓▓░░░░░░░░ usage       绿色 = normal
ctx: 58% ▓▓▓▓▓▓░░░░ usage+est   黄色 = warning（精确+估算）
ctx: 88% ▓▓▓▓▓▓▓▓▓░ est         红色 = critical（纯估算）
ctx: 97% ▓▓▓▓▓▓▓▓▓▓ est         亮红 = blocked
```

footer 栏显示压缩状态：`| snip saved ~2500 tokens`、`| collapse saved ~3000 tokens`、`| Saved 45% (85000 tokens)`，5 秒后自动消失。

## 涉及文件

```
src/compact/
├── constants.ts          所有阈值配置
├── prompt.ts             摘要 prompt 构建和解析
├── compact.ts            核心压缩逻辑（保留边界 + LLM 摘要）
├── auto-compact.ts       自动压缩触发判断
├── microcompact.ts       轻量 tool_result 清理
├── manual-compact.ts     /compact 入口
├── snipCompact.ts        确定性中间段截断
└── context-collapse.ts   LLM 摘要投影（安全区间 + 投影视图 + span 管理）

src/utils/
├── model-context.ts       模型上下文窗口映射
├── token-estimator.ts     Token 估算 + Provider Usage 精确计数
└── tool-result-storage.ts 大工具输出持久化

src/agent-loop.ts          snip → microcompact → contextCollapse → autoCompact
src/session.ts             压缩事件的持久化与状态恢复
src/tty-app.ts             /compact + /snip + /collapse 命令处理
src/cli-commands.ts        命令注册
```

---

## 常见问题

### Q1：为什么用 chars/token 估算而不是接入 tiktoken？

这是有意为之的 trade-off。tiktoken 需要引入 Python 依赖或打包 tokenizer 文件（cl100k_base 约 2MB），冷启动多 50-100ms。对于 50% 和 85% 这类阈值判断，估算误差通常在 ±15% 以内，不会影响压缩决策——因为决策依赖的是趋势而非绝对值。最坏情况也只会晚一步触发或多做一次清理，两种都比引入重量级依赖的维护成本低。

### Q2：microcompact 清理掉旧 tool_result，模型后续需要那些信息怎么办？

保留最近 3 条是关键——模型在单步推理中最需要的是"刚刚发生了什么"，不是"10 步前的 grep 结果"。被清理的工具输出已经被模型消化并转化为后续行为。如果确实需要，autoCompact 的摘要里会记录关键细节。而且清理后的标记 `[Output cleared for context space]` 本身就是一种信号——告诉模型"此处曾有输出，如需详细信息请重新操作"。这比直接删消息安全，因为删消息会破坏 tool_use/tool_result 配对导致 API 报错。

### Q3：50% 和 85% 这些阈值怎么来的？

没有大规模 A/B 测试，但有几层依据：50% 是"安全冗余线"——大部分模型窗口 128K-200K，在 50%（64K-100K）做轻量清理对用户完全无感；85% 触发 LLM 压缩是因为剩余空间约 20K-30K tokens，刚好是一次完整 tool-call 往返的典型消耗，再等就来不及了。

### Q4：如果 LLM 生成的摘要质量很差怎么办？

多层防护：入口处有基础检查（消息太少跳过）；LLM 返回空响应直接放弃；解析不到 `<summary>` 标签也放弃；最重要的是兜底——连续 3 次失败自动禁用整个压缩机制，防止反复浪费 token。

### Q5：为什么不用 API 自带的 prompt caching？

两者解决不同问题。Prompt caching 解决"同一个 prefix 重复发送时的带宽和延迟"——一旦中间插入新消息，后续缓存全部失效。上下文压缩解决"消息太多，不压就爆窗口"——即使 API 免费秒回，窗口满了也会被截断。两者互补：压缩减少消息量，caching 让剩余消息传输更快。

### Q6：tool_use 和 tool_result 的配对怎么保证不切断？

保留边界算法会检查边界位置——如果恰好是 tool_result，就向前扫描找到匹配的 tool_use，把边界前移。要么一整对都保留，要么一整对都压缩，不会出现上半截在摘要里、下半截在保留区的情况（那会导致 API 400 错误）。

### Q7：为什么 autoCompact 只在 step 0 执行，中间上下文涨超了怎么办？

现在已经是五道防线：snipCompact(70%) → microcompact(50%) → contextCollapse(75%) → autoCompact(85%)，后三道在每个 step 都会评估。Tool Result Storage 在工具输出阶段就把 >50K 的单次输出写入磁盘，从源头减少 mid-turn 暴涨的概率。

### Q8：压缩的延迟对用户体验有什么影响？

snipCompact 和 microcompact 完全无感——纯 CPU 计算，不到 1ms。contextCollapse 和 autoCompact 需要 LLM 调用（2-5 秒），但发生在 turn 开始时用户等待第一个响应的阶段，这个时间窗口本身就在用户预期内。手动命令会阻塞输入直到完成，但那是用户主动触发的——就像 `git gc`，你知道它要跑一会儿。

### Q9：工具输出太大怎么处理？

Tool Result Storage 分两层：单个结果 > 50K 字符就写盘，上下文只保留 2K 预览；整轮累计 > 200K 字符就按从大到小排序，优先持久化最大的结果。用户需要完整输出时去磁盘文件查看——和操作系统把冷内存换出到磁盘的思路一致。

### Q10：API 返回了精确 token 用量，为什么还保留估算？

两者互补。优先用 API 的精确值，只对 API 返回后新增的尾部消息用估算补齐。但如果消息列表被压缩改变了结构，旧的精确值就不再准确（类似数据库的 stale read），此时宁可退回到估算，也不能让失真数据误导决策。TUI 上的 `usage`/`usage+est`/`est` 标签让用户能看到当前用的是哪种模式。
