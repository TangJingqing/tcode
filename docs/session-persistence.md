# 会话持久化与恢复

## 功能概览

| 功能 | 使用方式 | 说明 |
|---|---|---|
| 自动保存 | 每轮对话自动触发 | 追加写入 `~/.tcode/projects/<项目>/<sessionId>.jsonl` |
| 恢复会话 | `/resume` 或 `/resume <id>` | 打开交互式选择器，或直接按 ID 恢复 |
| 新建会话 | `/new` | 清空当前会话，分配新 sessionId，旧会话文件保留 |
| 分叉会话 | `/fork` | 把当前会话复制为独立副本，方便尝试不同方案 |
| 重命名会话 | `/rename <name>` | 给当前会话起个好记的名字 |
| 启动恢复 | `tcode --resume [id]` | 启动时直接恢复指定会话或打开选择器 |
| 过期清理 | 启动时自动 | 删除超过 30 天未修改的会话文件 |
| 压缩边界 | 持久化 compact_boundary | 恢复时只加载压缩后的内容，不加载旧消息 |

---

## 实现原理

### 1. 存储结构

```
~/.tcode/projects/
├── Users-zhihu-myproject/
│   ├── a1b2c3d4.jsonl
│   ├── e5f6g7h8.jsonl
│   └── ...
├── Users-zhihu-otherproject/
│   └── ...
```

- 按工作目录隔离，路径中的 `/` `\` `:` 替换为 `-`
- 每次启动生成 8 位 UUID 作为 sessionId
- 每个会话一个 `.jsonl` 文件，追加写入，不覆盖已有数据

### 2. JSONL 事件封包

每条消息包装成一个 JSON 事件，一行一条：

```json
{"type":"user","message":{"role":"user","content":"修一下登录 bug"},"uuid":"evt-001","timestamp":"2026-07-08T10:30:00Z","sessionId":"a1b2c3d4","cwd":"/Users/zhihu/myproject","parentUuid":null}
{"type":"assistant","message":{"role":"assistant","content":"好的，我来看看"},"uuid":"evt-002","timestamp":"...","sessionId":"a1b2c3d4","cwd":"/Users/zhihu/myproject","parentUuid":"evt-001"}
```

核心字段：

| 字段 | 作用 |
|---|---|
| `uuid` | 事件唯一 ID |
| `parentUuid` | 指向上一条事件的 uuid，形成链式结构 |
| `type` | 事件类型：user / assistant / tool_call / tool_result / summary / compact_boundary / rename |
| `message` | 原始 ChatMessage 对象 |

`parentUuid` 链让事件形成树结构，为后续功能（如回溯、可视化对话分支）留了扩展空间。

### 3. 差分追加保存

```ts
// session.ts: saveSession
export async function saveSession(cwd, sessionId, messages, alreadySavedCount) {
  // 跳过 system prompt (index 0) 和已保存的消息
  const toSave = messages.slice(1).slice(alreadySavedCount)
  if (toSave.length === 0) return

  // 读取文件中最后一条事件的 uuid 作为 parent
  let parentUuid = await readLastEventUuid(filePath)

  for (const msg of toSave) {
    const line = wrapEvent(msg, sessionId, cwd, parentUuid)
    parentUuid = JSON.parse(line).uuid  // 链式关联
    lines.push(line)
  }

  // 追加到文件末尾，不覆盖已有内容
  await appendFile(filePath, lines.join('\n') + '\n')
}
```

`alreadySavedCount` 参数防止重复写入。每次 save 只看「新增的消息」，追加到文件末尾。

### 4. 恢复加载

```ts
// session.ts: loadSession
export async function loadSession(cwd, sessionId) {
  const content = await readFile(sessionFilePath(cwd, sessionId), 'utf8')
  const lines = content.trim().split('\n').filter(Boolean)

  // 找到最后一个 compact_boundary
  let lastBoundaryIndex = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (parseEvent(lines[i])?.type === 'compact_boundary') {
      lastBoundaryIndex = i; break
    }
  }

  // 只加载边界之后的消息
  const startLine = lastBoundaryIndex >= 0 ? lastBoundaryIndex + 1 : 0
  const messages = []
  for (let i = startLine; i < lines.length; i++) {
    const msg = unwrapMessage(parseEvent(lines[i]))
    if (msg) messages.push(msg)
  }
  return messages
}
```

关键逻辑：从后往前找 compact_boundary，找到后只取它后面的内容。这样压缩后的会话恢复时不会把旧消息塞回 context window。

### 5. 交互式会话选择器

`/resume` 不带参数时打开选择器：

```
┌─ sessions ────────────────────────────────────────────┐
│ Select a session to resume:                           │
│                                                       │
│  > a1b2c3d4  修一下登录 bug       12 messages  5m ago │
│    e5f6g7h8  重构用户模块         8 messages   2h ago  │
│    9i0j1k2l  添加单元测试         3 messages   1d ago  │
│                                                       │
│ ↑/↓ to select, Enter to resume, d to delete,          │
│ Tab for all projects, Esc to cancel                   │
└───────────────────────────────────────────────────────┘
```

实现上，选择器是一个 `SessionPicker` 状态对象，挂到 `ScreenState` 上。键盘事件被劫持到选择器的处理逻辑：上下键移动、回车确认、`d` 两次删除、Tab 切换到跨项目浏览、Esc 取消。

### 6. 会话分叉

```ts
// session.ts: forkSession
export async function forkSession(cwd, sessionId) {
  const loaded = await loadSession(cwd, sessionId)
  if (!loaded) return null

  const newId = randomUUID().slice(0, 8)           // 新 ID
  await saveSession(cwd, newId, [{ role: 'system', content: '' }, ...loaded])  // 复制消息

  // 自动命名：原标题_fork1, 原标题_fork2 ...
  const source = (await listSessions(cwd)).find(s => s.id === sessionId)
  const baseTitle = source?.title ?? 'session'
  const nextNum = /* 计算已有 fork 编号 */ 1
  await renameSession(cwd, newId, `${baseTitle}_fork${nextNum}`)
  return newId
}
```

本质就是 `loadSession` + `saveSession` 到新文件，两份数据完全独立。

### 7. 压缩边界持久化

```ts
// session.ts: appendCompactBoundary
export async function appendCompactBoundary(cwd, sessionId, summaryText, trigger, preTokens, postTokens) {
  const boundary = {
    type: 'compact_boundary',
    parentUuid: null,                    // 树断点
    logicalParentUuid: lastUuid,        // 逻辑上仍指向上一事件
    compactMetadata: { trigger, preTokens, postTokens }
  }
  const summary = {
    type: 'user',
    message: { role: 'user', content: summaryText },
    parentUuid: boundary.uuid           // 链到 boundary
  }

  // 追加两行到文件
  await appendFile(filePath, JSON.stringify(boundary) + '\n' + JSON.stringify(summary) + '\n')
}
```

compact_boundary 的 `parentUuid` 为 null（树结构断点），但 `logicalParentUuid` 保留对上一事件的引用，兼顾树形结构和语义连续性。

### 8. 过期清理

```ts
// session.ts: cleanupExpiredSessions
export async function cleanupExpiredSessions(cwd, maxAgeMs) {
  const entries = await readdir(projectDir(cwd))
  for (const name of entries.filter(e => e.endsWith('.jsonl'))) {
    const stats = await stat(filePath)
    if (Date.now() - stats.mtime.getTime() > maxAgeMs) {
      await unlink(filePath)  // 超过 30 天，删除
    }
  }
}
```

启动时自动调用，清理 30 天未修改的会话文件。

---

## 数据流示意

```
用户输入 → handleInput → runAgentTurn
                              ↓
                         args.messages 更新
                              ↓
                   saveSession(cwd, sessionId, messages, alreadySavedCount)
                              ↓
                   只追加新消息到 .jsonl 文件末尾

下次启动 → loadSession(cwd, sessionId)
                    ↓
          只读 compact_boundary 之后的行 → 恢复 args.messages
                    ↓
          loadTranscript 重建 UI 展示
```

---

## 关键设计决策

- **JSONL 而非 JSON**：支持追加写入，不会因为一次 save 就重写整个文件；支持多进程安全（append 操作是原子的）
- **parentUuid 树结构**：为对话分支、回溯等高级功能预留扩展；compact_boundary 在树上形成断点但保留语义链
- **按 cwd 隔离**：不同项目的会话互不干扰，列表只显示当前项目的会话
- **差分保存**：用 `alreadySavedCount` 追踪已持久化的消息数，每次只写新增数据，O(n) 变 O(1)
