# tcode Usage Guide

[Back to README](./README.md) | [简体中文](./USAGE_ZH.md)

This document contains the detailed reference material that complements the main README: command reference, long-session behavior, configuration, Skills/MCP usage, project layout, and code metrics. The README stays focused on the high-level overview and project entry point.

## Table of Contents

- [Feature Details](#feature-details)
- [Installation Details](#installation-details)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [Layered Memory and Project Initialization](#layered-memory-and-project-initialization)
- [Long Sessions and Context Management](#long-sessions-and-context-management)
- [Configuration](#configuration)
- [Skills and MCP Usage](#skills-and-mcp-usage)
- [Tracing](#tracing)
- [Project Structure](#project-structure)
- [Code Size](#code-size)
- [Development](#development)

## Feature Details

### Core workflow

- multi-step tool calls within a single turn, forming a `model -> tool -> model` loop
- full-screen card-style terminal interface with header, session feed, prompt, approval, activity, and footer panels
- input history, transcript scrolling, slash command menu, and approval interaction flows
- per-project session persistence with resume, rename, fork, and compact operations
- model-aware context statistics using provider usage as the primary data source, with estimator fallback, auto-compact, and large-output replacement
- discoverable local skills through `SKILL.md` files
- dynamic MCP tool loading over stdio and streamable HTTP, with non-blocking startup and connection status indicators
- MCP resources and prompts accessible through generic helper tools
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

- review-before-write diff for all file modifications
- path and command permission checks with allowlist / denylist support
- local installer that stores configuration independently
- Anthropic-style API endpoint compatibility
- oversized tool results persisted to disk and replaced in context with a short preview and file path, preventing long command output from dominating the conversation window

### Recent interaction improvements

- approval prompts use Up/Down navigation with Enter to confirm, plus direct letter/number shortcuts printed on each option
- "reject with guidance" lets you send corrective instructions back to the model
- edit approvals support "allow this file for this turn" and "allow all edits for this turn"
- file diffs are rendered as standard unified diff output (closer to `git diff`)
- approval views support `Ctrl+O` expand/collapse plus wheel and page-based scrolling
- `Ctrl+C` exits cleanly even with an open approval prompt
- completed tool calls auto-collapse into brief summaries to reduce transcript noise
- background shell commands launched through `run_command` are surfaced as lightweight shell tasks instead of appearing as forever-running tool calls
- TTY input events are serialized, and CRLF Enter sequences are normalized so approval confirms do not fire twice
- input-event deadlock during approval (where Up/Down/Enter could stop responding) has been fixed
- escape-sequence parsing is hardened against malformed terminal input
- `run_command` accepts single-string invocations like `"git status"` and splits arguments automatically
- unknown non-shell commands now request approval instead of being rejected immediately
- clarification questions are structured through `ask_user`, pausing the turn until the user responds
- token accounting is provider-usage-driven: the provider-reported usage figure anchors context stats, auto-compact thresholds, warning/blocking levels, and the TUI badge; the local estimator is only used when provider usage is absent or for tail messages added after the most recent usage boundary
- the TUI context badge distinguishes exact provider usage from estimated tail values (e.g., `ctx 82% ... usage+est`); compacted conversations mark retained pre-compact usage as stale so it does not get reused as the current context figure
- large tool results are persisted under tcode's local data directory and replaced in model context with a preview and file path; repeated references reuse the same stable replacement so accounting remains consistent
- thinking blocks from the model are preserved across tool-call turns, maintaining chain-of-thought continuity through multi-step execution

## Installation Details

```bash
cd tcode
npm install
npm run install-cli
```

The installer prompts for:

- model name
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_AUTH_TOKEN`

Configuration is written to:

- `~/.tcode/settings.json`
- `~/.tcode/mcp.json`

Override the config directory with `TCODE_HOME`:

```bash
export TCODE_HOME=/path/to/custom/dir
npm run install-cli
```

The launcher is installed to:

- `~/.local/bin/tcode`

Override the launcher directory with `TCODE_BIN_DIR`:

```bash
export TCODE_BIN_DIR=/path/to/custom/bin
npm run install-cli
```

If `~/.local/bin` is not on your `PATH`, add:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Quick Start

Run the installed launcher:

```bash
tcode
```

Development mode:

```bash
npm start
```

Offline demo mode:

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

### Interactive slash commands

- `/help`
- `/tools`
- `/skills`
- `/mcp`
- `/status`
- `/init`
- `/memory`
- `/model`
- `/model <name>`
- `/config-paths`
- `/permissions`
- `/trace`

### Terminal interaction

- slash command menu with suggestions
- transcript scrolling
- prompt editing
- input history navigation (Up/Down)
- approval selection with Up/Down + Enter, or direct key shortcuts

### Session management

tcode automatically persists your conversation after each turn. Every launch creates a new session with a unique identifier.

- `/resume` — open the interactive session picker
- `/resume <id>` — resume a specific session by ID
- `/rename <name>` — rename the current session
- `/new` — start a fresh session (previous session is kept)
- `/fork` — fork the current session into an independent copy
- `/compact` — manually compress context to free up context window space

CLI flags:

- `tcode --resume` — launch with the session picker
- `tcode --resume <id>` — resume a specific session
- `tcode --fork <id>` — fork a session and resume the fork

Sessions are scoped per working directory and stored under `~/.tcode/projects/` in append-only JSONL format. On exit, tcode prints the session ID so you can resume later. Sessions older than 30 days are automatically cleaned up.

## Layered Memory and Project Initialization

tcode loads instruction files at startup from a three-layer hierarchy:

1. **User global**: `~/.tcode/MINI.md` (also reads `~/.tcode/CLAUDE.md` for compatibility) plus sorted `~/.tcode/rules/*.md`
2. **Project root and ancestor directories**: walks upward from cwd, reading `MINI.md`, `MINI.local.md`, `.tcode/MINI.md`, `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md`, plus sorted `.tcode/rules/*.md` at each directory level
3. **Priority**: content closer to cwd takes precedence over content from broader scopes

Files with identical content are automatically deduplicated. Per-file limit is approximately 8k characters, total limit approximately 20k characters. Run `/memory` in the interactive UI to inspect exactly which files were loaded, their scopes, line counts, character counts, and first-line previews.

Instruction files can include other files with a line containing only `@relative/path.md`. Includes are resolved relative to the source file; absolute paths and paths containing parent-directory escapes (`..`) are skipped for safety, and include cycles are detected.

`/init` scaffolds `.tcode/`, `.tcode/rules/`, and `MINI.md` for the current project, and adds generated private rule files to `.gitignore`.

Example `MINI.md`:

```markdown
# Project Rules

- Use TypeScript strict mode.
- Run `npx tsc --noEmit` before committing.
- Keep changes minimal and focused.

@.tcode/rules/testing.md
```

## Long Sessions and Context Management

tcode treats long-running conversations as a first-class concern:

- Provider usage, when returned by the model endpoint, is recorded on assistant response boundaries and used as the primary source for token accounting.
- When messages are added after the latest provider usage boundary, tcode adds a local tail estimate and labels the badge accordingly (e.g., `usage+est`).
- If the provider does not return usage data, tcode falls back to local estimation so offline mode and compatible gateways continue to work.
- Context statistics drive the TUI badge, warning/blocking thresholds, and auto-compact trigger.
- `/compact` performs manual context compression and records a compact boundary in the session log.
- Automatic compaction can summarize or trim older turns once utilization reaches a configured threshold.
- After compaction, retained pre-compact usage is marked stale so an outdated provider total is not mistaken for the current context size.
- Oversized tool results are written to `~/.tcode/tool-results/` and replaced in visible context with a preview and the full-output path. A single result exceeding `50_000` characters is persisted; batches are reduced toward a `200_000` character visible budget.

Session storage and context compression work together: `loadSession` resumes from the most recent compact boundary, while `loadTranscript` can still reconstruct the visible transcript from the JSONL event log.

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

Project-scoped MCP configuration is also supported through Claude Code-compatible `.mcp.json`:

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

For cross-vendor MCP compatibility, tcode auto-negotiates stdio framing:

- standard MCP `Content-Length` framing is attempted first
- if that fails, tcode falls back to newline-delimited JSON
- you can force a specific mode per server with `"protocol": "content-length"` or `"protocol": "newline-json"`
- for remote MCP over HTTP, use `"protocol": "streamable-http"` with a `"url"` (and optional `"headers"`)
- header values support environment variable interpolation, e.g. `"Authorization": "Bearer $MCP_TOKEN"`

Remote MCP authentication (lightweight by design):

- use `tcode mcp login <name> --token <bearer-token>` to store a bearer token locally
- use `tcode mcp logout <name>` to clear a stored token
- tcode intentionally uses this token-based approach rather than a full built-in OAuth callback and refresh state machine
- this keeps the implementation compact and aligned with tcode's lightweight architecture; full OAuth automation may be added later as needed

Skills are discovered from these locations:

- `./.tcode/skills/<skill-name>/SKILL.md`
- `~/.tcode/skills/<skill-name>/SKILL.md`
- `./.claude/skills/<skill-name>/SKILL.md`
- `~/.claude/skills/<skill-name>/SKILL.md`

Configuration priority order:

1. `~/.tcode/settings.json`
2. `~/.tcode/mcp.json`
3. project `.mcp.json`
4. compatible existing local settings
5. process environment variables

## Skills and MCP Usage

tcode supports two extension mechanisms:

- `skills`: local workflow instructions, typically defined by a `SKILL.md` file
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

Inside the interactive UI:

```text
/skills
```

shows which skills are available in the current session.

If you mention a skill name explicitly, tcode will prefer loading it:

```text
Use the frontend-dev skill and directly rebuild the current landing page instead of stopping at a plan.
```

For more explicit control:

```text
Load the fullstack-dev skill first, then follow its workflow to implement this task.
```

A common pattern is to clone a skills repository locally and install from there:

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

To configure an MCP server scoped only to the current project, add `--project`:

```bash
tcode mcp add filesystem --project -- npx -y @modelcontextprotocol/server-filesystem .
tcode mcp list --project
```

Inside the interactive UI:

```text
/mcp
```

shows which servers are connected, which protocol each negotiated, and how many tools / resources / prompts they expose.

MCP tools are automatically registered under the naming scheme:

```text
mcp__<server_name>__<tool_name>
```

For example, with the MiniMax MCP server connected you may see:

- `mcp__minimax__web_search`
- `mcp__minimax__understand_image`

These tool names appear automatically after a successful MCP connection — no manual declaration needed.

### Using extensions in conversation

The simplest approach is to describe the task naturally and let the model decide which skill or MCP tool to invoke:

```text
Search for recent Chinese-language resources about MCP and give me 5 representative links.
```

With MiniMax MCP connected, the model will typically choose `mcp__minimax__web_search`.

For more controlled workflows, name the skill or capability explicitly:

```text
Use the frontend-dev skill and directly modify the current project files to turn this page into a more complete product landing page.
```

Or:

```text
Use the connected MCP tools to search for the MiniMax MCP guide and summarize what capabilities it provides.
```

### Skills vs MCP: when to use which

- `skills` work well for workflows, conventions, domain-specific instructions, and reusable execution patterns
- `MCP` works well for search, image understanding, browsers, filesystems, databases, and other remote capabilities

A common combination:

- use a skill such as `frontend-dev` to guide how the work should be done
- use MCP to provide external search, image understanding, or system integrations

### Compatibility notes

tcode currently focuses on:

- local `SKILL.md` discovery with `load_skill`
- stdio MCP servers
- streamable HTTP MCP endpoints
- MCP tools
- generic helper tools for MCP resources and prompts

For vendor compatibility, tcode automatically tries:

- standard `Content-Length` framing first
- then falls back to `newline-json` if needed

This means servers like MiniMax MCP, which use newline-delimited JSON over stdio, can be connected directly.

## Tracing

tcode includes an optional tracing layer for observing agent behavior. Tracing records agent turns, model inputs and outputs, tool events, loop decisions, and errors without changing runtime behavior.

Enable tracing through environment variables:

```bash
TCODE_TRACE=1 npm start
```

Or configure it in `~/.tcode/settings.json`:

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

In the interactive UI, run `/trace` to inspect the current tracing status.

## Project Structure

- `src/index.ts` — CLI entry point and mode selection
- `src/agent-loop.ts` — multi-step model/tool execution loop
- `src/tool.ts` — tool registry, validation, and execution
- `src/skills.ts` — local skill discovery and loading
- `src/mcp.ts` — stdio and streamable HTTP MCP clients with dynamic tool wrapping
- `src/manage-cli.ts` — top-level `tcode mcp` / `tcode skills` management commands
- `src/session.ts` — append-only session JSONL, resume/fork/rename, compact boundaries, and expiry cleanup
- `src/compact/*` — manual compact, auto-compact, and conversation summarization helpers
- `src/utils/token-estimator.ts` — provider-usage-first context accounting with estimation fallback
- `src/utils/tool-result-storage.ts` — large tool-output persistence and preview replacement
- `src/tools/*` — built-in tool implementations
- `src/tui/*` — terminal UI components
- `src/tracing.ts` — agent loop tracing and optional Langfuse / OpenTelemetry export
- `src/config.ts` — runtime configuration loading
- `src/install.ts` — interactive installer

## Code Size

Current core implementation is approximately **8,500 lines**.

Counting methodology:

- included: core TypeScript source, built-in tools, config, MCP, sessions, compaction, adapters, permissions, tracing, and `bin/tcode`
- excluded: documentation, tests, `node_modules/`, and TUI files (`src/tui/`, `src/tty-app.ts`)

Including `src/tty-app.ts` while still excluding `src/tui/` brings the total to approximately **10,500 lines**.

## Development

```bash
npx tsc --noEmit
```

tcode is intentionally compact and pragmatic. The goal is to keep the architecture clear, hackable, and easy to extend.
