# tcode Roadmap

tcode already has a usable lightweight terminal coding workflow. The roadmap below focuses on the most valuable missing capabilities while preserving the project's small, readable shape.

## P0

### 1. Model-Aware Context Management

Long sessions need better context control.

This includes:

- model-aware context window configuration
- provider-reported usage accounting
- context usage display in the TUI
- automatic compaction for long conversations

### 2. API Retry and Backoff

Transient provider failures should not leak directly into the user workflow.

This includes:

- retry on 429 and 5xx responses
- exponential backoff
- support for `Retry-After` when available

### 3. Session Persistence and Resume

tcode should be able to save and resume sessions reliably.

This includes:

- autosave
- manual resume
- basic session recovery

## P1

### 4. Layered Memory Loading

tcode can support a lightweight project memory hierarchy similar in spirit to Claude Code.

Possible layers:

- global memory
- project memory
- nested or local memory
- simple include support

### 5. Stronger Provider Abstraction

tcode currently works with Anthropic-style APIs and compatible providers. The provider layer can become more explicit.

Target direction:

- Anthropic
- OpenAI-compatible endpoints
- OpenRouter
- LiteLLM-style gateways

### 6. Lightweight Task Tracking

A small built-in task tracker would improve long multi-step execution without turning the runtime into a heavyweight planning system.

### 7. Sub-Agent Support

Sub-agents would be useful for parallel investigation and review, but should come after context, session, and provider behavior are more stable.

### 8. Expand the Core Toolset Selectively

tcode should add tools that support core runtime capabilities, not chase tool-count parity.

Priority areas:

- session and memory tools
- context management helpers
- lightweight task tracking
- high-value built-in tools where MCP is not a sufficient substitute

## P2

### 9. Notebook Editing Support

Useful for data and research workflows, but not essential for the main terminal coding loop.

### 10. Built-In Web Tools

MCP can already provide web search and fetch capabilities, so built-in web tools are useful but lower priority.

### 11. Evaluation Infrastructure

This includes:

- benchmark harnesses
- structured trace capture
- reproducible agent evaluation

### 12. Prompt Caching

Worth exploring once context accounting and provider integration are more mature.

## Contribution Notes

When contributing to roadmap items:

- keep PRs focused
- preserve the lightweight architecture
- document user-facing behavior
- explain validation steps

See:

- [Contribution Guidelines](./CONTRIBUTING.md)
- [中文贡献规范](./CONTRIBUTING_ZH.md)
