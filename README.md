# tcode

<p align="center">
  <img src="https://img.shields.io/badge/Editor-tcode-D97757?style=for-the-badge" alt="Editor: tcode" />
  <img src="https://img.shields.io/badge/%23tcode-Project-B85C3F?style=for-the-badge" alt="#tcode" />
  <img src="https://img.shields.io/badge/%23lightweight-Focus-F0EBE1?style=for-the-badge&labelColor=8B8B8B" alt="#lightweight" />
</p>

---

<p align="center">
  A lightweight, highly efficient coding tool. Designed for speed, built for simplicity.
</p>

[简体中文](./README.zh-CN.md) | [Usage Guide](./USAGE.md) | [Architecture](./ARCHITECTURE.md) | [Contributing](./CONTRIBUTING.md) | [Roadmap](./ROADMAP.md) | [License](./LICENSE)

tcode is a lightweight terminal coding assistant for local development workflows.

It provides Claude Code-like workflow and architectural ideas in a much smaller implementation, making it especially useful for learning, experimentation, and custom tooling.

## Overview

tcode is built around a practical terminal-first agent loop:

- accept a user request
- inspect the workspace
- call tools when needed
- review file changes before writing
- return a final response in the same terminal session

The project is intentionally compact, so the control flow, tool model, tracing behavior, and TUI components remain easy to understand and extend.

## Why tcode

tcode is a good fit if you want:

- a lightweight coding assistant instead of a large platform
- a card-style terminal UI with tool calling, transcript, and command workflow
- a small codebase that is suitable for study and modification
- a reference implementation for Claude Code-like agent architecture
- optional local tracing for agent loop and model/tool events

## Core Capabilities

- Multi-step tool execution in a single turn, forming a `model -> tool -> model` loop.
- Full-screen card-style terminal UI with header, session feed, prompt, approval, activity, and footer panels.
- Per-project session persistence with resume, rename, fork, and compact commands.
- Provider-usage-first context stats with tail estimates, auto-compact, and large-output replacement.
- Built-in tools for files, search, editing, command execution, web fetch/search, and structured user prompts.
- Local skills discovered through `SKILL.md`, plus MCP tools/resources/prompts over stdio or streamable HTTP.
- Review-before-write file edits with path and command permission checks.
- Optional agent-loop tracing with Langfuse / OpenTelemetry support.
- Oversized tool results are stored on disk and replaced in context with a short preview and file path.

Full command references, configuration examples, session details, tracing setup, and Skills/MCP usage are covered in the [Usage Guide](./USAGE.md).

## Installation

```bash
cd tcode
npm install
npm run install-cli
```

The installer asks for the model name, `ANTHROPIC_BASE_URL`, and `ANTHROPIC_AUTH_TOKEN`. Configuration is stored in:

- `~/.tcode/settings.json`
- `~/.tcode/mcp.json`

You can override the config directory with `TCODE_HOME` and the launcher directory with `TCODE_BIN_DIR`. See [Installation Details](./USAGE.md#installation-details) for more.

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

## Common Entry Points

- `/help` — show interactive help.
- `/tools` — list available tools.
- `/skills` — list discovered skills.
- `/mcp` — show MCP connection status.
- `/status` — show session and context status.
- `/init` — scaffold `.tcode/` and `MINI.md` for the current project.
- `/memory` — inspect the layered memory files loaded for the current turn.
- `/model` / `/model <name>` — inspect or switch the model.
- `/resume` — open the session picker.
- `/compact` — manually compact the context.
- `/trace` — inspect current tracing status.

Management commands include `tcode mcp ...` and `tcode skills ...`. See [Commands](./USAGE.md#commands) for the full reference.

## Documentation

- [Usage Guide](./USAGE.md)
- [Architecture Overview](./ARCHITECTURE.md)
- [中文架构说明](./ARCHITECTURE_ZH.md)
- [Contribution Guidelines](./CONTRIBUTING.md)
- [中文贡献规范](./CONTRIBUTING_ZH.md)
- [Roadmap](./ROADMAP.md)
- [路线图](./ROADMAP_ZH.md)
- [Learn Claude Code Design Through tcode](./CLAUDE_CODE_PATTERNS.md)
- [技术说明](./TECHNICAL_OVERVIEW_ZH.md)
- [MCP 功能技术说明](./MCP_TECHNICAL_ZH.md)

## Development

```bash
npx tsc --noEmit
```

tcode is intentionally small and pragmatic. The goal is to keep the architecture understandable, hackable, and easy to extend.
