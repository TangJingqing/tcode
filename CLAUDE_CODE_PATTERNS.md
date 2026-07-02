# What Claude Code Design Ideas You Can Learn Through tcode

tcode is not a clone of Claude Code, but it makes several Claude Code-style design ideas visible in a small TypeScript codebase.

## 1. Agent Loop

Claude Code is centered on an agent loop:

- receive user input
- assemble context
- call the model
- execute tools when requested
- feed tool results back into the model
- stop only when the current turn can actually end

tcode follows the same direction in `src/agent-loop.ts`. The loop is small enough to read directly, while still handling progress messages, tool calls, clarifying questions, retries, and tracing.

## 2. Structured Message Model

Claude Code does not treat the session as plain chat text. It distinguishes between user input, assistant output, progress, tool calls, and tool results.

tcode uses the same idea in `src/types.ts`:

- `user`
- `assistant`
- `assistant_progress`
- `assistant_tool_call`
- `tool_result`

This keeps the runtime from confusing progress updates with final answers.

## 3. Tool Use as a Protocol

Tool use is a protocol, not a direct function call from model text.

tcode makes that protocol explicit:

- tools are registered in one registry
- inputs are described for the model
- inputs are validated locally with Zod
- permissions can participate before local side effects
- results return through one normalized shape

Local tools and MCP-backed tools share this execution path.

## 4. Clarification as a Tool

Real coding agents sometimes need user input before continuing. tcode exposes this as `ask_user`, a normal tool that returns `awaitUser`.

That keeps clarification inside the same execution model as other tools instead of relying on ambiguous assistant text.

## 5. Permissions Belong Inside Execution

Risky operations such as writing files, accessing paths outside the workspace, or running dangerous commands should pass through a permission boundary.

tcode keeps this logic in `src/permissions.ts` and routes tools through it. Approvals are part of the runtime, not only a UI feature.

## 6. MCP as Dynamic Capability Injection

MCP lets external servers expose tools, resources, and prompts at runtime.

tcode discovers MCP-backed tools in `src/mcp.ts`, then registers them alongside built-in tools. The agent loop does not need to know whether a tool is local or remote.

## 7. Skills as Local Workflow Memory

Skills are reusable workflow instructions stored in `SKILL.md` files.

tcode discovers skills from `.tcode/skills` and compatible `.claude/skills` locations, then exposes them to the model and provides a `load_skill` tool for full content loading.

## 8. Tracing for Agent Behavior

Agent behavior is much easier to debug when each loop decision is observable.

tcode has optional tracing in `src/tracing.ts`, including model inputs, tool events, loop decisions, errors, and optional Langfuse export.

## 9. Small Architecture as a Learning Tool

The main value of tcode is that the design is visible:

- the loop is in one file
- tools use one protocol
- permissions are centralized
- TUI state is explicit
- MCP and skills plug into the same runtime
- tracing records the decisions without owning the behavior

That makes tcode useful both as a local assistant and as a study project for terminal coding-agent architecture.
