# Architecture

This document describes the high-level design, data flow, and extension points of pi.hitl for developers and contributors.

## Overview

pi.hitl is a pi extension that intercepts every `tool_call` event and evaluates it against CEL (Common Expression Language) rules defined in YAML. The extension can **allow** the call to proceed, **block** it with a reason, or **confirm** it with an interactive UI dialog.

## Extension Lifecycle

pi.hitl registers handlers for four pi events:

| Event | Purpose |
|-------|---------|
| `session_start` | Load and merge config files, restore persisted on/off state, refresh tool metadata cache, announce to other extensions |
| `turn_start` | Reset per-turn denial tracking so a new user turn starts fresh |
| `before_agent_start` | Inject a sandbox boundary note into the system prompt so the LLM knows its constraints |
| `tool_call` | Main gate — evaluate the tool call against rules and decide allow / block / confirm |

### State Persistence

The `/permissions on` and `/permissions off` toggle is stored via `pi.appendEntry("permissions-state")`, not a side file. This is intentional because pi sessions can be **reloaded** (`/reload`), **resumed** (`/resume`), and **forked** (`/fork`, `/clone`). A file on disk would not survive a fork. Session entries are cloned and resumed along with the session, making the state feel like a session property.

On `session_start`, the extension iterates over all session entries and restores the most recent `permissions-state` entry.

## Permission Evaluation Pipeline

When a `tool_call` event fires, the evaluation follows this pipeline:

```
┌─────────────────┐
│  tool_call      │
│  event          │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  hidden_tools   │──Yes──►│  silent block   │
│  check          │     │  (tool not avail)│
└────────┬────────┘     └─────────────────┘
         │ No
         ▼
┌─────────────────┐
│  buildBase      │
│  Context()      │
│  (tool, args,   │
│   cwd, path,    │
│   command)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  tool metadata  │────►│  add tool_source │
│  cache lookup   │     │  & tool_scope    │
└─────────────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐
│  contextBuilders│
│  registry       │
│  (extensions)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  per-turn       │──Yes──►│  block (user    │
│  denial check   │     │  denied earlier)│
└────────┬────────┘     └─────────────────┘
         │ No
         ▼
┌─────────────────┐
│  resolveAction  │
│  (flat rules,   │
│   first match)  │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼         ▼
┌───────┐ ┌───────┐ ┌─────────────┐
│ allow │ │ block │ │   confirm   │
│  pass │ │ reason│ │  UI dialog  │
└───────┘ └───────┘ └─────────────┘
                              │
                         ┌────┴────┐
                         ▼         ▼
                      ┌───────┐ ┌───────┐
                      │ allow │ │ block │
                      │ user  │ │ user  │
                      │ says Y│ │ says N│
                      └───────┘ └───────┘
```

### Context Building

The CEL evaluation context is assembled in layers:

1. **Base context** (`buildBaseContext` in `context.ts`): Built-in variables — `tool`, `args`, `cwd`, `path`, `command`.
2. **Tool metadata** (`createToolMetadataCache`): Adds `tool_source` and `tool_scope` from `pi.getAllTools()`.
3. **Extension builders** (`createContextBuilderRegistry`): Other extensions can register builders via `hitl:register_context` event to inject their own variables.

Each layer is merged with `Object.assign`. Later builders override earlier ones for conflicting keys.

### Bash Command Segmentation

For `bash` tool calls, compound commands containing shell operators (`&&`, `||`, `|`, `;`, `&`, `;;`, or newlines) are split into segments. Each segment is evaluated independently, and results are combined with this precedence:

**block > confirm > allow**

- If **any** segment is blocked → the whole command is blocked.
- If **no** block but **some** segment requires confirmation → a single confirmation dialog is shown for the whole command.
- Only if **all** segments are allowed → the whole command is allowed.

The splitter respects shell quoting and escaping (single quotes, double quotes, backslash escapes). Redirect operators (`>`, `<`, `>>`) are **not** treated as command separators.

See `splitter.ts` for the full implementation.

## Config Loading and Merge Semantics

Three config locations are loaded in order of increasing precedence:

| Location | Scope | Precedence |
|----------|-------|------------|
| `~/.agents/permissions.yaml` | Agent-wide defaults | Lowest |
| `~/.pi/agent/permissions.yaml` | Global (all projects) | Middle |
| `.pi/permissions.yaml` | Project-local | Highest |

**Merge rules:**
- `rules` are **merged** across configs: parent rules with matching `name` and `condition` have their children combined into a single parent group. Within merged parents, catch-all children (`default` or `condition: "true"`) are reordered to the end.
- `hidden_tools` are **concatenated** and deduplicated.
- All other keys (`version`, `default_action`) are **overwritten** by the highest-precedence config that defines them.

**Flattening:** Nested rules are flattened at load time (not evaluation time). Parent conditions are AND-ed with child conditions; parent names are prefixed onto child names (e.g., `Bash > rm`). This keeps the runtime evaluation engine a simple flat loop.

## Interaction with Other Extensions

pi.hitl emits `hitl:announce` during every `session_start` so extensions that loaded earlier can re-emit their `hitl:register_context` registration. Extensions should emit their registration both proactively at startup and reactively on `hitl:announce` to handle unpredictable load ordering.

The registration payload:

```typescript
pi.events.emit("hitl:register_context", {
  name: "my_extension",
  builder: (toolName, input, cwd, ctx) => ({ my_var: 42 }),
});
```

If a builder throws, pi.hitl logs the error and continues — a failing builder does not break the permission gate.

## Key Source Files

| File | Responsibility |
|------|--------------|
| `index.ts` | Extension entry point — event handlers, commands, UI interaction |
| `config.ts` | Config loading, merging, and validation |
| `rules.ts` | Rule flattening, merging, and the `Rule`/`Config` types |
| `evaluator.ts` | CEL rule evaluation, action resolution, segment result combining |
| `context.ts` | Context building, tool metadata cache, extension builder registry |
| `splitter.ts` | Bash command segmentation into independent segments |
| `scenario.ts` | Scenario test model/types |
| `scenario-runner.ts` | Scenario test execution |
| `validate.ts` | Standalone CLI validator entry point |

## System Prompt Injection

When sandbox rules are detected, pi.hitl injects a short boundary note into the LLM's system prompt via `before_agent_start`. This is a **feedback mechanism** — the LLM plans tool calls before the permission gate sees them. If the LLM knows that file operations are restricted to the project directory, it is less likely to hallucinate paths outside `cwd`.

The note is generated dynamically from the actual rules (detecting patterns like `path.startsWith(cwd)`, `tool == "bash"`, etc.), so it reflects the live configuration rather than a static text block.
