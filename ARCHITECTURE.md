# tcode Architecture

[简体中文](./ARCHITECTURE_ZH.md)

This document describes the lightweight architecture decisions behind `tcode`.
The goal is not to build a giant all-in-one terminal agent platform, but to prioritize the most valuable execution loop, interaction experience, safety boundaries, and observability.

## Design Principles

tcode prioritizes these capabilities:

1. the main `model -> tool -> model` loop
2. full-screen TUI interaction rhythm
3. directory awareness, permission checks, and dangerous-action confirmation
4. a componentized transcript / tool / input UI structure
5. a user-reviewable file modification flow
6. optional tracing for agent loop observability

In other words, tcode is a smaller, more controllable terminal coding assistant with built-in debugging visibility.

## Current implementation focus

- Keep the skeleton of the `model -> tool -> model` loop
- Keep a unified tool contract and centralized registration
- Keep a message-driven terminal interaction rhythm
- Keep safety boundaries: path permissions, command permissions, and write approval
- Keep Claude Code-inspired extension points: local skills and MCP-backed tools
- Keep long-running sessions usable through append-only session history, compact boundaries, provider-usage context accounting, and large tool-output replacement
- Keep agent behavior observable through optional tracing

## Planned / not yet built

- Full Ink/React rendering stack
- Bridge / IDE two-way communication
- Remote session
- Task swarm / sub-agent orchestration
- LSP
- Skill marketplace
- More complex permission modes
- Feature-flag system
- Telemetry / analytics
- Layered project memory and richer session search

## Current implementation

- `src/index.ts`: CLI entry and mode selection
- `src/agent-loop.ts`: multi-turn tool-calling loop
- `src/tool.ts`: registration, validation, execution
- `src/tools/*`: `list_files` / `grep_files` / `read_file` / `write_file` / `edit_file` / `patch_file` / `modify_file` / `run_command` / `web_fetch` / `web_search` / `ask_user` / `load_skill`
- `src/config.ts`: uses dedicated `~/.tcode`
- `src/skills.ts`: scans `.tcode/skills` and compatible `.claude/skills` directories
- `src/mcp.ts`: launches stdio MCP servers, negotiates framing compatibility, and wraps remote MCP tools into local tool definitions
- `src/background-tasks.ts`: minimal background shell task registry used by `run_command` and the TUI
- `src/manage-cli.ts`: manages persisted MCP configs and installed local skills
- `src/anthropic-adapter.ts`: Anthropic-compatible Messages API adapter
- `src/utils/token-estimator.ts`: structured token accounting. Provider-reported usage is the primary source when available; local estimation is reserved for missing usage and for tail messages after the latest provider usage boundary.
- `src/utils/tool-result-storage.ts`: persists oversized tool results under tcode's local data directory, replaces visible context with a preview plus path, and reuses stable replacements across a run.
- `src/compact/*`: context compression and auto-compact. Auto-compact uses structured accounting totals, and compaction marks retained pre-compact provider usage stale.
- `src/mock-model.ts`: offline fallback adapter
- `src/permissions.ts`: path, command, and edit approval with allowlist / denylist
- `src/session.ts`: multi-session persistence with append-only JSONL, parentUuid tree structure, compact boundary, session forking, and expiry cleanup
- `src/file-review.ts`: diff review before writing files
- `src/tracing.ts`: agent loop tracing and optional Langfuse / OpenTelemetry export
- `src/tui/*`: transcript / chrome / input / screen / markdown terminal components
- `src/tty-app.ts`: full-screen TUI state management, input event handling, and agent callback integration

## Runtime State Model

tcode keeps runtime state deliberately simple:

- Conversation messages stay in memory during a turn and are appended to the session log after successful turns.
- Sessions are stored per working directory in `~/.tcode/projects/` as JSONL events, with `parentUuid` links for ordinary event chains and compact boundaries for summarized history.
- Resuming a session loads messages from the latest compact boundary, while transcript reconstruction can still use the full event stream.
- Provider usage is attached to assistant-side response boundaries and treated as the source of truth for context accounting whenever it is fresh.
- Local token estimation is only a fallback or a tail estimate after the latest provider usage boundary.
- Very large tool outputs are moved out of the prompt context and stored under `~/.tcode/tool-results/`, leaving the model a preview and a path to the full output.
- Tracing spans are created per session and per agent turn, recording key decisions without changing behavior.

## UI Architecture

The current TUI uses native stdin/stdout and ANSI control sequences, without React/Ink.

The interface follows a card-style layout:

- `header`: displays project, provider, model, messages, events, skills, mcp, and context usage info
- `session feed`: renders user, assistant, progress, and tool call records
- `prompt`: shows the input box, shortcut hints, and slash command menu
- `approval`: displays path, command, and file edit permission requests
- `activity`: shows current tool and recent tool results
- `footer`: shows current status and tools/skills availability

`src/tui/chrome.ts` provides banner, panel, footer, slash menu, and approval prompt UI components.
`src/tui/transcript.ts` handles transcript rendering and panel-height-based scrolling.
`src/tty-app.ts` connects state changes, input events, and agent callbacks to these components.

## Why it is good for learning

One strength of tcode is that it delivers Claude Code–like behavior and core architectural ideas in a much lighter implementation.

That makes it well suited to:

- Learning the basic pieces of a terminal coding agent
- Studying tool-calling loops
- Understanding permission approval and file review flows
- Seeing how skills and external MCP tools can be added without a heavy plugin platform
- Seeing a lightweight Claude Code-style distinction between foreground tool execution and background shell tasks
- Studying how session restore, compact boundaries, provider usage, and large output storage fit into a compact runtime
- Observing agent turn, model response, and tool call execution details through tracing
- Experimenting with how terminal UIs are organized
- Customizing further on top of a small codebase

## Future improvements

1. A more complete virtual-scrolling transcript
2. Richer input editing behavior
3. A finer-grained tool execution status panel
4. Session history and project memory (session persistence is now implemented; project memory is still planned)
5. Stronger UI componentization
6. More granular trace filtering and local trace viewer
