# tcode

[简体中文](./README.zh-CN.md) | [Architecture](./ARCHITECTURE.md) | [中文架构说明](./ARCHITECTURE_ZH.md) | [Contributing](./CONTRIBUTING.md) | [Roadmap](./ROADMAP.md) | [Learn Claude Code Design Through tcode](./CLAUDE_CODE_PATTERNS.md) | [技术说明](./TECHNICAL_OVERVIEW_ZH.md) | [License](./LICENSE)

A lightweight terminal coding assistant for local development workflows.

tcode follows the same compact, terminal-first design style as MiniCode: it keeps the core coding-agent loop small enough to study and customize, while still supporting practical file tools, permissions, local skills, MCP tools, and agent tracing.

## Overview

tcode is built around a practical terminal-first agent loop:

- accept a user request
- inspect the workspace
- call tools when needed
- review file changes before writing
- return a final response in the same terminal session

The project is intentionally compact, so the control flow, tool model, tracing behavior, and TUI components remain easy to understand and extend.

## Table of Contents

- [Why tcode](#why-tcode)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [Configuration](#configuration)
- [Skills and MCP Usage](#skills-and-mcp-usage)
- [Tracing](#tracing)
- [Project Structure](#project-structure)
- [Architecture Docs](#architecture-docs)
- [Development](#development)

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
- discoverable local skills via `SKILL.md`
- dynamic MCP tool loading over stdio
- MCP resources and prompts via generic MCP helper tools
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
- approval prompts with expand/collapse, scrolling, selection, and feedback input
- finished tool calls auto-collapse into concise summaries to reduce transcript noise

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

The launcher is installed to:

- `~/.local/bin/tcode`

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
- `tcode mcp add <name> [--project] [--protocol <mode>] [--env KEY=VALUE ...] -- <command> [args...]`
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

### Terminal interaction

- command suggestions and slash menu
- transcript scrolling
- prompt editing
- input history navigation
- approval selection and feedback input flow
- card-style approval and activity panels

## Configuration

Example configuration:

```json
{
  "model": "your-model-name",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
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

For vendor compatibility, tcode auto-negotiates stdio framing:

- standard MCP `Content-Length` framing is tried first
- if that fails, tcode falls back to newline-delimited JSON
- you can force a mode per server with `"protocol": "content-length"` or `"protocol": "newline-json"`

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

## Project Structure

- `src/index.ts`: CLI entry
- `src/agent-loop.ts`: multi-step model/tool loop
- `src/tool.ts`: tool registry and execution
- `src/skills.ts`: local skill discovery and loading
- `src/mcp.ts`: stdio MCP client and dynamic tool wrapping
- `src/manage-cli.ts`: top-level `tcode mcp` / `tcode skills` management commands
- `src/tools/*`: built-in tools
- `src/tui/*`: terminal UI modules
- `src/tracing.ts`: agent loop tracing and optional Langfuse export
- `src/config.ts`: runtime configuration loading
- `src/install.ts`: interactive installer

## Architecture Docs

- [中文架构说明](./ARCHITECTURE_ZH.md)
- [技术说明](./TECHNICAL_OVERVIEW_ZH.md)

## Development

```bash
npx tsc --noEmit
```

tcode is intentionally small and pragmatic. The goal is to keep the architecture understandable, hackable, and easy to extend.
