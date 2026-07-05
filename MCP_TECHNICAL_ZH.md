# tcode MCP 功能技术说明

本文说明本次 MCP 相关改动解决了什么问题，以及它在代码中如何实现。

## 1. 这些功能有什么用

本次改动让 `tcode` 的 MCP 能力从“同步加载本地 stdio MCP”扩展为“支持本地和远端 MCP，并且启动更稳”。

主要能力：

- 支持本地 stdio MCP server。
- 支持远端 `streamable-http` MCP endpoint。
- 支持通过 header 和 bearer token 连接需要鉴权的远端 MCP。
- MCP 在后台加载，坏掉或很慢的 MCP 不会卡住 `tcode` 启动。
- UI 能展示 MCP 的 `connecting`、`connected`、`error` 状态。
- stdio MCP 的协议探测结果会缓存，后续启动更快。
- MCP resources 和 prompts 改为按需查询，减少启动时的额外请求。

一句话总结：这些改动让 `tcode` 可以更可靠地接入外部工具服务，同时保持终端启动速度和可观测性。

## 2. 使用方式

添加本地 stdio MCP：

```bash
tcode mcp add filesystem -- npx -y @modelcontextprotocol/server-filesystem .
```

添加远端 streamable HTTP MCP：

```bash
tcode mcp add mock-http --protocol streamable-http --url http://127.0.0.1:8787/mcp
```

为远端 MCP 保存 bearer token：

```bash
tcode mcp login mock-http --token your-token
```

添加自定义请求头：

```bash
tcode mcp add remote-tools --protocol streamable-http --url https://example.com/mcp --header X-API-Key=your-key
```

在交互界面查看 MCP 状态：

```text
/mcp
```

连接成功后，MCP 工具会注册成：

```text
mcp__<server_name>__<tool_name>
```

例如 `mock-http` 暴露 `echo` 工具时，工具名是：

```text
mcp__mock_http__echo
```

## 3. 配置如何保存

MCP server 配置保存在：

- 用户级：`~/.tcode/mcp.json`
- 项目级：`./.mcp.json`

远端 MCP token 保存在：

- `~/.tcode/mcp-tokens.json`

stdio MCP 协议缓存保存在：

- `~/.tcode/mcp-protocol-cache.json`

配置类型在 `src/config.ts` 中定义。`McpServerConfig` 现在支持：

- `command` / `args`：本地 stdio MCP 启动命令。
- `url`：远端 MCP endpoint。
- `headers`：HTTP 请求头。
- `env`：本地 MCP 环境变量。
- `protocol`：`auto`、`content-length`、`newline-json` 或 `streamable-http`。

## 4. 启动流程如何变化

以前 `tcode` 启动时会同步连接 MCP。只要某个 MCP 很慢或失败，启动体验就会受影响。

现在启动分两步：

1. `createDefaultToolRegistry()` 先注册内置工具，并把配置中的 MCP 标记为 `connecting`。
2. `hydrateMcpTools()` 在后台连接 MCP，连接成功后动态追加 MCP 工具并更新状态。

相关代码：

- `src/tools/index.ts`
- `src/tool.ts`
- `src/index.ts`
- `src/tty-app.ts`

`ToolRegistry` 因此新增了动态能力：

- `addTools()`：追加后台加载出来的 MCP 工具。
- `setMcpServers()`：更新 MCP server 状态。
- `addDisposer()`：注册 MCP 关闭逻辑。

## 5. streamable HTTP MCP 如何实现

远端 MCP 由 `StreamableHttpMcpClient` 实现，代码在 `src/mcp.ts`。

它会向配置中的 `url` 发送 JSON-RPC `POST` 请求：

```http
POST /mcp
Content-Type: application/json
Accept: application/json, text/event-stream
```

启动时按 MCP 协议调用：

1. `initialize`
2. `notifications/initialized`
3. `tools/list`
4. `resources/list`
5. `prompts/list`

调用工具时发送：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "echo",
    "arguments": {
      "message": "hello"
    }
  }
}
```

如果保存过 token，请求会自动带上：

```text
Authorization: Bearer <token>
```

如果配置过 `headers`，也会一并发送。

## 6. stdio MCP 如何更快

本地 MCP 仍由 `StdioMcpClient` 实现。

stdio MCP 常见两种 framing：

- `content-length`
- `newline-json`

`protocol: auto` 时，`tcode` 会自动尝试。为减少等待，本次改动加入了两点优化：

- 第一次探测使用较短超时，避免错误协议卡太久。
- 成功协商后的协议写入 `~/.tcode/mcp-protocol-cache.json`，下次优先使用缓存协议。

这样同一个 MCP server 第二次启动通常更快。

## 7. resources 和 prompts 为什么按需查询

有些 MCP server 的 `resources/list` 或 `prompts/list` 很慢，甚至可能失败。

本次改动不再依赖启动时完整缓存 resources/prompts，而是：

- 启动时只记录数量和可用性。
- 用户调用 `list_mcp_resources` 时再实时查询 resources。
- 用户调用 `list_mcp_prompts` 时再实时查询 prompts。

这样可以减少启动成本，也避免 resources/prompts 的问题影响 MCP tools 的使用。

## 8. UI 状态如何展示

新增 `src/mcp-status.ts` 用来汇总 MCP 状态：

- 总 server 数
- 已连接数量
- 连接中数量
- 错误数量
- MCP 工具数量

TUI header 和 footer 会显示这些状态。`/mcp` 命令也会展示每个 server 的状态、工具数、协议和错误。

常见状态含义：

- `connecting`：已读到配置，正在后台连接。
- `connected`：连接成功，工具已注册。
- `error`：连接失败，错误信息会显示在 `/mcp` 中。
- `disabled`：配置中显式禁用。

## 9. 如何排查

如果 `/mcp` 显示：

```text
status=error ... error=fetch failed
```

说明远端 HTTP endpoint 没有连通。可以先用 curl 测：

```bash
curl -i -X POST http://127.0.0.1:8787/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

如果 curl 成功但 `tcode` 仍失败，通常检查：

- 是否重启了 `tcode`，因为 MCP hydrate 在启动时执行。
- `~/.tcode/mcp.json` 中的 URL 是否正确。
- 当前运行的 `tcode` 是否来自当前工作区。

如果本地 stdio MCP 失败，常见原因是：

- 命令不存在。
- `npx` / `uvx` 等依赖未安装。
- MCP server 启动慢。
- MCP server 使用的 framing 和默认探测不一致。

可查看：

```text
~/.tcode/mcp-protocol-cache.json
```

确认协议缓存是否生成。

## 10. 关键文件

- `src/config.ts`：MCP 配置、token 文件、协议缓存相关路径。
- `src/manage-cli.ts`：`tcode mcp add/login/logout/list/remove`。
- `src/mcp.ts`：stdio 和 streamable HTTP MCP client。
- `src/tool.ts`：动态工具注册和 disposer 管理。
- `src/tools/index.ts`：内置工具注册和 MCP 后台 hydrate。
- `src/index.ts`：启动时触发 MCP 后台加载。
- `src/tty-app.ts`：TUI 中刷新 MCP 状态。
- `src/tui/chrome.ts`：header/footer MCP 状态展示。
- `src/mcp-status.ts`：MCP 状态统计。
- `src/utils/errors.ts`：统一错误码判断。
