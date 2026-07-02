# Contributing to tcode

Thanks for helping improve tcode. The project is intentionally small, so contributions should keep the runtime readable and easy to modify.

## Principles

- Prefer focused changes over broad rewrites.
- Keep the agent loop and tool model easy to inspect.
- Use existing patterns before adding new abstractions.
- Preserve review-before-write and permission boundaries.
- Add documentation when behavior or workflows change.
- Validate changes with `npx tsc --noEmit` when possible.

## Development Setup

```bash
npm install
npm start
```

Run the TypeScript checker:

```bash
npx tsc --noEmit
```

Run in mock mode:

```bash
TCODE_MODEL_MODE=mock npm start
```

## Pull Request Guidelines

Good PRs usually include:

- a short description of the user-visible behavior
- a focused explanation of why the change is needed
- notes about permissions, file writes, or command execution if affected
- validation steps, including type checks or manual TUI checks
- documentation updates for new commands, tools, or settings

Avoid bundling unrelated refactors with feature work.

## Areas That Need Care

### Agent Loop

Changes to `src/agent-loop.ts` affect turn completion, tool execution, retries, and tracing. Keep behavior explicit and add comments only where the control flow would otherwise be hard to follow.

### Tools

New tools should:

- have a stable name
- validate input with Zod
- return a normalized `ToolResult`
- participate in permission checks when they read, write, or execute local state
- be registered in `src/tools/index.ts`
- be documented in `README.md` and `README.zh-CN.md`

### Permissions

Do not bypass `PermissionManager` for filesystem writes, external path reads, or dangerous commands. If a new capability can affect local state, route it through the existing approval model.

### TUI

The TUI uses native stdin/stdout and ANSI rendering. Keep rendering functions deterministic and avoid mixing long-running work directly into rendering code.

### Tracing

Tracing should help explain agent behavior without changing it. Keep trace payloads useful but compact, and avoid recording secrets.

## Documentation

When adding features, update the most relevant docs:

- `README.md`
- `README.zh-CN.md`
- `ARCHITECTURE.md`
- `ARCHITECTURE_ZH.md`
- `ROADMAP.md`
- `ROADMAP_ZH.md`

## License

By contributing, you agree that your contributions are provided under the repository license.
