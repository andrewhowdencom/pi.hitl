# How pi.hitl Works

This document explains the design decisions behind pi.hitl's architecture. It is intended for users who want to understand *why* the system behaves the way it does, not just *how* to configure it.

## Config load and merge

pi.hitl supports three config locations — agent-wide defaults, global per-user, and project-local — loaded in that order and merged into a single effective configuration. This layering exists because:

- **Agent-wide defaults** (`~/.agents/permissions.yaml`) let an agent provider ship a conservative baseline (e.g., block all `bash` by default).
- **Global config** (`~/.pi/agent/permissions.yaml`) lets a user define personal preferences that apply to every project they work on.
- **Project-local config** (`.pi/permissions.yaml`) lets a repository encode its own security policy, which overrides the user's global settings.

Project-local takes highest precedence because a repository's security requirements should not be silently overridden by a user's personal defaults. `rules` are **merged** across configs: parent rules with matching `name` and `condition` have their children combined into a single group, so a project config can extend a global bash allowlist with additional allowed commands. Non-matching parents and leaf rules are appended. `hidden_tools` are concatenated and deduplicated. This means a global allow-rule can still short-circuit before a project block-rule if it matches first, but project-specific additions to a shared parent group are evaluated before the group's catch-all default.

## System prompt injection

When sandbox rules are detected, pi.hitl injects a short boundary note into the LLM's system prompt via the `before_agent_start` event. This is not merely decorative — it is a **feedback mechanism**.

The LLM plans tool calls before the permission gate sees them. If the LLM knows that file operations are restricted to the project directory, it is less likely to hallucinate paths outside `cwd` and waste a turn. The note is generated dynamically from the actual rules (e.g., detecting `path.startsWith(cwd)` or `tool == "bash"`), so it reflects the live configuration rather than a static text block.

## Tool call interception

Every `tool_call` event is intercepted and evaluated against the flat rule list in order. The **first match wins** design is intentional:

- It is predictable. Users can read the YAML top-to-bottom and know exactly which rule will fire for a given tool call.
- It is fast. No complex conflict resolution or priority system is needed.
- It mirrors firewall and ACL semantics, which many users already understand.

The evaluation happens synchronously before the tool executes, so a blocked call never reaches the underlying tool implementation. A confirmed call pauses execution until the user responds to the dialog.

## Nested rules

YAML nesting is a **readability convenience**, not a runtime semantic. Rules flatten at load time into a single ordered list where parent conditions are AND-ed with child conditions and parent names are prefixed.

This design was chosen because:

- **Readability**: A flat list of twenty bash rules is hard to scan. Grouping them under a `Bash` parent makes the config self-documenting.
- **DRY conditions**: Shared prefixes (`tool == "bash"`) are written once, reducing copy-paste errors.
- **Runtime simplicity**: The evaluation engine stays a single flat loop. No tree traversal, recursion, or scope management is needed at runtime, which keeps the interception path fast and easy to reason about.

The flattening is eager (at config load time), not lazy (at evaluation time), so the cost is paid once per reload rather than on every tool call.

## State persistence

The `/permissions on` and `/permissions off` toggle is persisted via `pi.appendEntry()`, not via a side file or environment variable. This design choice was driven by the pi session model:

- Sessions can be **reloaded** (`/reload`), **resumed** (`/resume`), and **forked** (`/fork`, `/clone`). A state file on disk would not survive a fork because forked sessions run in separate directories.
- `pi.appendEntry()` stores state inside the session's own entry list, which is cloned and resumed along with the session. The extension scans all entries on `session_start` and restores the most recent `permissions-state` entry.
- This makes the on/off state feel like a session property, not a filesystem property, which aligns with user intuition: "I turned it off for this session" rather than "I edited a config file."

## Non-interactive behavior

When pi runs in non-interactive modes (`-p` for print mode, `--mode json`, `--mode rpc`), the `ctx.hasUI` flag is `false` and confirmation dialogs cannot be displayed. In this case, `confirm` actions default to `block` rather than `allow`.

This is a **safety-first** default: silently allowing a destructive operation because no terminal is attached would violate the principle of least surprise. If a user wants non-interactive mode to auto-allow, they can set `default_action: allow` and rely on explicit block rules rather than confirm rules.

## Hidden tools

Tools listed in `hidden_tools` are silently blocked rather than rejected with a message. This is intentional because:

- LLMs often retry when a tool call is rejected with an explicit error. A hidden tool produces a "tool not available" response, which the LLM interprets as the tool being absent from its environment rather than blocked by policy.
- This reduces **confusion and retry loops**. If the LLM sees "blocked by permissions configuration," it may try to reason around the block or ask the user to disable the extension. If the tool simply "does not exist," the LLM falls back to alternative approaches naturally.
- It is a **deny-by-default** mechanism for tools that should never be available in a given context, such as `write` in a read-only review session.
