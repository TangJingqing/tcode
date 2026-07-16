# tcode

<p align="center">
  <img src="./docs/logo.svg" alt="tcode Logo" width="180" />
</p>

<h2 align="center">tcode</h2>

<p align="center">
  <img src="https://img.shields.io/badge/Editor-tcode-D97757?style=for-the-badge" alt="Editor: tcode" />
  <img src="https://img.shields.io/badge/%23tcode-Project-B85C3F?style=for-the-badge" alt="#tcode" />
  <img src="https://img.shields.io/badge/%23lightweight-Focus-F0EBE1?style=for-the-badge&labelColor=8B8B8B" alt="#lightweight" />
</p>

---

<p align="center">
  A lightweight, highly efficient coding tool. Designed for speed, built for simplicity.
</p>

[简体中文](./README.zh-CN.md) | [Architecture](./ARCHITECTURE.md) | [中文架构说明](./ARCHITECTURE_ZH.md) | [Contributing](./CONTRIBUTING.md) | [Roadmap](./ROADMAP.md) | [Learn Claude Code Design Through tcode](./CLAUDE_CODE_PATTERNS.md) | [技术说明](./TECHNICAL_OVERVIEW_ZH.md) | [License](./LICENSE)

A lightweight terminal coding assistant for local development workflows.

tcode provides Claude Code-like workflow and architectural ideas in a much smaller implementation, making it especially useful for learning, experimentation, and custom tooling.

## Overview

tcode is built around a practical terminal-first agent loop:

- accept a user request
- inspect the workspace
- call tools when needed
- review file changes before writing
- return a final response in the same terminal session

The project is intentionally compact, so the control flow, tool model, tracing behavior, and TUI components remain easy to understand and extend.

## Table of Contents

- [Product Showcase Page](#product-showcase-page)
- [Why tcode](#why-tcode)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [Layered Memory](#layered-memory)
- [Long Sessions and Context Management](#long-sessions-and-context-management)
- [Configuration](#configuration)
- [Skills and MCP Usage](#skills-and-mcp-usage)
- [Tracing](#tracing)
- [Project Structure](#project-structure)
- [Code Size](#code-size)
- [Architecture Docs](#architecture-docs)
- [Contributing](#contributing)
- [Roadmap](#roadmap)
- [Learn Claude Code Design Through tcode](#learn-claude-code-design-through-tcode)
- [Development](#development)

## Product Showcase Page

- Open [docs/index.html](./docs/index.html) in a browser for a visual product overview.

## Why tcode

tcode is a good fit if you want:

- a lightweight coding assistant instead of a large platform
- a card-style terminal UI with tool calling, transcript, and command workflow
- a small codebase that is suitable for study and modification
- a reference implementation for Claude Code-like agent architecture
- optional local tracing for agent loop and model/tool events

## Features

### Core workflow

- multi-step tool execution in a single turn
- `model -> tool -> model` loop
- full-screen terminal interface
- card-style header, session feed, prompt, approval, activity, and footer panels
- input history, transcript scrolling, and slash command menu
- per-project session persistence with resume, rename, fork, and compact commands
- model-aware context stats with provider usage, estimated tail tokens, and auto-compact
- discoverable local skills via `SKILL.md`
- dynamic MCP tool loading over stdio or streamable HTTP
- MCP resources and prompts via generic MCP helper tools
- non-blocking MCP startup with connecting / ready / error status in the UI
- optional agent-loop tracing with Langfuse / OpenTelemetry support

### Built-in tools

- `list_files`
- `grep_files`
- `read_file`
- `write_file`
- `edit_file`
- `patch_file`
- `modify_file`
- `run_command`
- `web_fetch`
- `web_search`
- `ask_user`
- `load_skill`
- `list_mcp_resources`
- `read_mcp_resource`
- `list_mcp_prompts`
- `get_mcp_prompt`

### Safety and usability

- review-before-write flow for file modifications
- path and command permission checks
- local installer with independent config storage
- support for Anthropic-style API endpoints
- oversized tool results are stored on disk with a short in-context preview, keeping long command output from crowding out useful conversation context

### Recent interaction upgrades

- approval prompts now use Up/Down selection with Enter confirm
- approval prompts also support direct letter/number shortcuts shown in each option
- supports "reject with guidance" to send corrective instructions back to the model
- edit approvals support "allow this file for this turn" and "allow all edits for this turn"
- file review now uses standard unified diff output (closer to `git diff`)
- approval view supports `Ctrl+O` expand/collapse plus wheel/page scrolling
- `Ctrl+C` now exits cleanly even when an approval prompt is open
- finished tool calls auto-collapse into concise summaries to reduce transcript noise
- explicit background shell commands launched through `run_command` are now surfaced as lightweight shell tasks instead of remaining stuck as a forever-running tool call
- TTY input handling is serialized, and CRLF Enter sequences are normalized so approval confirms do not accidentally fire twice
- fixed an input-event deadlock where approval prompts could stop accepting Up/Down/Enter
- escape-sequence parsing is hardened so malformed terminal input does not stall key handling
- `run_command` now accepts single-string invocations like `"git status"` and auto-splits args
- unknown non-shell commands now request approval instead of being rejected immediately
- clarifying questions are now structured via `ask_user`, and the turn pauses until the user replies
- context accounting is now provider-usage-driven: provider-reported usage anchors the context stats, auto-compact trigger, blocking/warning levels, and TUI context badge; the local estimator is used only when provider usage is unavailable or for messages added after the latest usage boundary
- the TUI context badge distinguishes exact provider usage from estimated tail text, for example `ctx 82% ... usage+est`; compacted conversations mark retained pre-compact usage stale so it is not reused as current context truth
- large tool results are persisted under tcode's local data directory and replaced in the model context by a preview plus file path; repeated passes reuse the same replacement so accounting stays stable

## Installation

```bash
cd tcode
npm install
npm run install-cli
```

The installer will ask for:

- model name
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_AUTH_TOKEN`

Configuration is stored in:

- `~/.tcode/settings.json`
- `~/.tcode/mcp.json`

You can override the config directory with `TCODE_HOME`:

```bash
export TCODE_HOME=/path/to/custom/dir
npm run install-cli
```

The launcher is installed to:

- `~/.local/bin/tcode`

You can override the launcher directory with `TCODE_BIN_DIR`:

```bash
export TCODE_BIN_DIR=/path/to/custom/bin
npm run install-cli
```

If `~/.local/bin` is not already on your `PATH`, add:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Quick Start

Run the installed launcher:

```bash
tcode
```

Run in development mode:

```bash
npm start
```

Run in offline demo mode:

```bash
TCODE_MODEL_MODE=mock npm start
```

## Commands

### Management commands

- `tcode mcp list`
- `tcode mcp add <name> [--project] [--protocol <mode>] [--url <endpoint>] [--header KEY=VALUE ...] [--env KEY=VALUE ...] [-- <command> [args...]]`
- `tcode mcp login <name> --token <bearer-token>`
- `tcode mcp logout <name>`
- `tcode mcp remove <name> [--project]`
- `tcode skills list`
- `tcode skills add <path> [--name <name>] [--project]`
- `tcode skills remove <name> [--project]`

### Local slash commands

- `/help`
- `/tools`
- `/skills`
- `/mcp`
- `/status`
- `/model`
- `/model <name>`
- `/config-paths`
- `/permissions`
- `/trace`
- `/init`
- `/memory`

### Terminal interaction

- command suggestions and slash menu
- transcript scrolling
- prompt editing
- input history navigation
- approval selection and feedback input flow (Up/Down + Enter, or key shortcuts)

### Session management

tcode automatically saves your conversation after each turn. Each launch creates a new session with a unique ID.

- `/resume` — open interactive session picker
- `/resume <id>` — resume a specific session by ID
- `/rename <name>` — rename the current session
- `/new` — start a fresh session (previous session is preserved)
- `/fork` — fork the current session into a new independent copy
- `/compact` — compress context to free up context window space

CLI flags:

- `tcode --resume` — launch with session picker
- `tcode --resume <id>` — resume a specific session
- `tcode --fork <id>` — fork a session and resume the fork

Sessions are scoped per working directory and stored in `~/.tcode/projects/` using append-only JSONL. On exit, tcode prints the session ID so you can resume later. Sessions older than 30 days are automatically cleaned up.

## Layered Memory

tcode loads instruction files at startup from a three-layer hierarchy:

1. **User global**: `~/.tcode/MINI.md` (also reads `~/.tcode/CLAUDE.md` for compatibility) plus sorted `~/.tcode/rules/*.md`
2. **Project root and ancestors**: walks upward from cwd, reading `MINI.md`, `MINI.local.md`, `.tcode/MINI.md`, `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md`, plus sorted `.tcode/rules/*.md` at each level
3. **Priority**: content closer to cwd takes precedence over broader layers

Files with identical content are deduplicated. Per-file limit is ~8k chars, total limit ~20k chars. Use `/memory` in the interactive UI to inspect the exact files loaded, their scopes, line counts, and previews.

Instruction files can include other files with a line containing only `@relative/path.md`. Includes are resolved relative to the source file; absolute paths and parent-directory (`..`) escapes are skipped for safety, and cycles are detected.

Example `MINI.md`:

```markdown
# Mini.md
- This project uses TypeScript.
- Use TypeScript strict mode.
- Run `npm run check` before committing.
- Keep changes minimal and focused.

@.tcode/rules/testing.md
```

The `/init` command bootstraps a project by creating `.tcode/`, adding tcode entries to `.gitignore`, and generating a `MINI.md` template with auto-detected stack. Idempotent — safe to re-run.

## Long Sessions and Context Management

tcode now treats long-running conversations as a first-class workflow:

- Provider usage, when returned by the model endpoint, is recorded on assistant response boundaries and used as the primary token source.
- If messages are added after the latest provider usage boundary, tcode adds a local tail estimate and labels the badge accordingly, for example `usage+est`.
- If no provider usage is available, tcode falls back to local estimation so offline mode and compatible gateways still work.
- Context stats feed the TUI badge, warning/blocking levels, and auto-compact trigger.
- `/compact` performs manual context compression and records a compact boundary in the session log.
- Automatic compaction can summarize older turns once utilization gets high.
- After compaction, retained pre-compact usage is marked stale so an old provider total is not mistaken for the current context size.
- Oversized tool results are written to `~/.tcode/tool-results/` and replaced in the visible context with a preview and the full-output path. A single result over `50_000` characters is persisted, and batches are reduced toward a `200_000` character visible budget.

Session storage and context compression work together: `loadSession` resumes from the latest compact boundary, while `loadTranscript` can still rebuild the visible transcript from the JSONL event log.

## Configuration

Example configuration:

```json
{
  "model": "your-model-name",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "remote-example": {
      "protocol": "streamable-http",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer your-token"
      }
    }
  },
  "trace": {
    "enabled": false,
    "langfuse": {
      "enabled": false
    }
  },
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.anthropic.com",
    "ANTHROPIC_AUTH_TOKEN": "your-token",
    "ANTHROPIC_MODEL": "your-model-name"
  }
}
```

Project-scoped MCP config is also supported through Claude Code compatible `.mcp.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    }
  }
}
```

For vendor compatibility, tcode now auto-negotiates stdio framing:

- standard MCP `Content-Length` framing is tried first
- if that fails, tcode falls back to newline-delimited JSON
- you can force a mode per server with `"protocol": "content-length"` or `"protocol": "newline-json"`
- for remote MCP over HTTP, use `"protocol": "streamable-http"` with `"url"` (and optional `"headers"`)
- header values support environment interpolation, e.g. `"Authorization": "Bearer $MCP_TOKEN"`

Remote MCP authentication strategy (lightweight by design):

- use `tcode mcp login <name> --token <bearer-token>` to store a bearer token locally
- use `tcode mcp logout <name>` to clear a stored token
- for now, tcode intentionally uses this token-based path instead of a full built-in OAuth callback + refresh state machine
- this keeps the implementation small and aligned with tcode's lightweight architecture goals; full OAuth automation may be added later when needed

Skills are discovered from:

- `./.tcode/skills/<skill-name>/SKILL.md`
- `~/.tcode/skills/<skill-name>/SKILL.md`
- `./.claude/skills/<skill-name>/SKILL.md`
- `~/.claude/skills/<skill-name>/SKILL.md`

Configuration priority:

1. `~/.tcode/settings.json`
2. `~/.tcode/mcp.json`
3. project `.mcp.json`
4. compatible existing local settings
5. process environment variables

## Skills and MCP Usage

tcode supports two extension layers:

- `skills`: local workflow instructions, usually described by a `SKILL.md`
- `MCP`: external tool providers that expose tools, resources, and prompts into tcode

### Skills: install, inspect, trigger

Install a local skill:

```bash
tcode skills add ~/minimax-skills/skills/frontend-dev --name frontend-dev
```

List installed or discovered skills:

```bash
tcode skills list
```

Inside the interactive UI, you can also run:

```text
/skills
```

to inspect which skills are available in the current session.

If you explicitly mention a skill name, tcode will prefer loading it. For example:

```text
Use the frontend-dev skill and directly rebuild the current landing page instead of stopping at a plan.
```

If you want to be even more explicit:

```text
Load the fullstack-dev skill first, then follow its workflow to implement this task.
```

A common pattern is to clone an official or Claude Code-compatible skills repo locally and install from there:

```bash
git clone https://github.com/MiniMax-AI/skills.git ~/minimax-skills
tcode skills add ~/minimax-skills/skills/frontend-dev --name frontend-dev
```

### MCP: install, inspect, trigger

Install a user-scoped MCP server:

```bash
tcode mcp add MiniMax --env MINIMAX_API_KEY=your-key --env MINIMAX_API_HOST=https://api.minimaxi.com -- uvx minimax-coding-plan-mcp -y
```

List configured MCP servers:

```bash
tcode mcp list
```

To configure an MCP server only for the current project, add `--project`:

```bash
tcode mcp add filesystem --project -- npx -y @modelcontextprotocol/server-filesystem .
tcode mcp list --project
```

Inside the interactive UI, run:

```text
/mcp
```

to see which servers are connected, which protocol they negotiated, and how many tools / resources / prompts they expose.

MCP tools are automatically registered as:

```text
mcp__<server_name>__<tool_name>
```

For example, after connecting the MiniMax MCP server you may see:

- `mcp__minimax__web_search`
- `mcp__minimax__understand_image`

These tool names are not hand-written in tcode. They appear automatically after a successful MCP connection.

### How to use them in chat

The simplest approach is to just describe the task naturally and let the model decide when to use a skill or MCP tool:

```text
Search for recent Chinese-language resources about MCP and give me 5 representative links.
```

If MiniMax MCP is connected, the model will typically choose `mcp__minimax__web_search`.

If you want a more controlled workflow, name the skill or target capability explicitly:

```text
Use the frontend-dev skill and directly modify the current project files to turn this page into a more complete product landing page.
```

Or:

```text
Use the connected MCP tools to search for the MiniMax MCP guide and summarize what capabilities it provides.
```

### When to use skills vs MCP

- `skills` are better for workflow, conventions, domain-specific instructions, and reusable execution patterns
- `MCP` is better for search, image understanding, browsers, filesystems, databases, and other remote capabilities

A common combination is:

- use a skill such as `frontend-dev` to shape how the work should be done
- use MCP to provide external search, image understanding, or system integrations

### Compatibility notes

tcode currently focuses on:

- local `SKILL.md` discovery with `load_skill`
- stdio MCP servers
- streamable HTTP MCP endpoints
- MCP tools
- generic helper tools for MCP resources and prompts

For vendor compatibility, tcode automatically tries:

- standard `Content-Length` framing
- then falls back to `newline-json` if needed

That means servers such as MiniMax MCP, which use newline-delimited JSON over stdio, can still be connected directly.

## Tracing

tcode adds an optional tracing layer for debugging agent behavior.

Tracing can be enabled through environment variables:

```bash
TCODE_TRACE=1 npm start
```

or through `~/.tcode/settings.json`:

```json
{
  "trace": {
    "enabled": true,
    "langfuse": {
      "enabled": true,
      "publicKey": "your-public-key",
      "secretKey": "your-secret-key",
      "baseUrl": "https://cloud.langfuse.com"
    }
  }
}
```

In the interactive UI, run:

```text
/trace
```

to inspect the current trace status.

## Learn Claude Code Design Through tcode

If you want to study the project as a learning resource, continue with:

- [What Claude Code Design Ideas You Can Learn Through tcode](./CLAUDE_CODE_PATTERNS.md)

## Project Structure

- `src/index.ts`: CLI entry
- `src/agent-loop.ts`: multi-step model/tool loop
- `src/tool.ts`: tool registry and execution
- `src/skills.ts`: local skill discovery and loading
- `src/mcp.ts`: stdio / streamable HTTP MCP clients and dynamic tool wrapping
- `src/manage-cli.ts`: top-level `tcode mcp` / `tcode skills` management commands
- `src/session.ts`: append-only session JSONL, resume/fork/rename, compact boundaries, and expiry cleanup
- `src/compact/*`: manual compact, auto-compact, and conversation summarization helpers
- `src/utils/token-estimator.ts`: provider-usage-first context accounting with estimate fallback
- `src/utils/tool-result-storage.ts`: large tool-output persistence and preview replacement
- `src/tools/*`: built-in tools
- `src/tui/*`: terminal UI modules
- `src/tracing.ts`: agent loop tracing and optional Langfuse export
- `src/config.ts`: runtime configuration loading
- `src/install.ts`: interactive installer

## Code Size

Current core implementation size is about **8,500 lines**.

Counting scope:

- included: core TypeScript source, built-in tools, config, MCP, sessions, compaction, adapters, permissions, tracing, and `bin/tcode`
- excluded: docs, tests, `node_modules/`, and TUI files (`src/tui/`, `src/tty-app.ts`)

If `src/tty-app.ts` is included while still excluding `src/tui/`, the total is about **10,500 lines**.

## Architecture Docs

- [Architecture Overview](./ARCHITECTURE.md)
- [中文架构说明](./ARCHITECTURE_ZH.md)
- [技术说明](./TECHNICAL_OVERVIEW_ZH.md)
- [MCP 功能技术说明](./MCP_TECHNICAL_ZH.md)

## Contributing

- [Contribution Guidelines](./CONTRIBUTING.md)
- [中文贡献规范](./CONTRIBUTING_ZH.md)

## Roadmap

- [Roadmap](./ROADMAP.md)
- [路线图（中文）](./ROADMAP_ZH.md)

## Development

```bash
npx tsc --noEmit
```

tcode is intentionally small and pragmatic. The goal is to keep the architecture understandable, hackable, and easy to extend.
