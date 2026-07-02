# tcode Architecture

[README](./README.md) | [中文架构说明](./ARCHITECTURE_ZH.md) | [Technical Overview](./TECHNICAL_OVERVIEW_ZH.md)

tcode is a compact terminal coding assistant. Its architecture keeps the agent loop, tool protocol, permissions, local skills, MCP integration, and tracing visible enough to study and modify.

## Design Goals

tcode optimizes for:

- a small `model -> tool -> model` execution loop
- a terminal-first interaction model
- explicit permission boundaries for paths, commands, and edits
- reviewable file modifications
- local extension through skills and MCP servers
- optional observability through Langfuse / OpenTelemetry tracing

The project does not try to become a full IDE agent platform. It is intended to be understandable, hackable, and practical for local development workflows.

## Runtime Flow

1. `src/index.ts` loads runtime configuration.
2. `createDefaultToolRegistry()` registers built-in tools and MCP-backed tools.
3. `PermissionManager` loads persisted permissions and handles approvals.
4. `buildSystemPrompt()` assembles system instructions, permissions, skills, and MCP status.
5. The selected model adapter receives messages and tool definitions.
6. `runAgentTurn()` loops until the model returns a final answer, asks the user, or reaches the step limit.
7. Tool results are appended back into the structured message list.

## Core Modules

- `src/index.ts`: CLI entry and mode selection
- `src/agent-loop.ts`: multi-step agent turn loop
- `src/types.ts`: structured chat message and model step types
- `src/tool.ts`: tool registry, validation, execution, and normalized results
- `src/tools/*`: built-in tools such as file operations, command execution, skill loading, and `ask_user`
- `src/permissions.ts`: path, command, and edit approvals
- `src/file-review.ts`: unified diff generation for write review
- `src/anthropic-adapter.ts`: Anthropic-compatible Messages API adapter
- `src/mock-model.ts`: offline demo adapter
- `src/skills.ts`: local `SKILL.md` discovery
- `src/mcp.ts`: stdio MCP client and dynamic tool wrapping
- `src/tracing.ts`: agent loop tracing and optional Langfuse export
- `src/tty-app.ts`: full-screen terminal application state
- `src/tui/*`: terminal rendering and input parsing helpers

## Tool Protocol

Tools are plain TypeScript objects with:

- a stable tool name
- a JSON-schema-like input description for the model
- a Zod schema for local validation
- a `run()` function returning a normalized `ToolResult`

`ToolResult` supports normal output, background shell task metadata, and `awaitUser`. The `ask_user` tool uses `awaitUser` to stop the current turn after displaying a clarifying question.

## Permissions

tcode treats permissions as part of execution, not as a separate afterthought.

- Access inside the workspace is allowed by default.
- Paths outside the workspace can require approval.
- Dangerous commands require confirmation.
- Edits go through a review-before-write flow.
- Approvals can be scoped once, for the current turn, or persisted depending on the choice.

## Extension Layers

tcode has two lightweight extension layers:

- Skills: local workflow instructions stored as `SKILL.md`
- MCP: external stdio servers that dynamically expose tools, resources, and prompts

MCP tools are normalized into the same registry as built-in tools, so the agent loop does not need a separate execution path for them.

## Tracing

Tracing is optional and can be enabled through `TCODE_TRACE=1` or runtime settings. When enabled, tcode records:

- turn start and end metadata
- summarized model inputs
- model steps
- tool start and end events
- loop decisions and errors

Langfuse export can also be enabled for deeper inspection.
