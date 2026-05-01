# YAML Configuration Schema

This document describes the structure of `permissions.yaml` configuration files.

## Top-level keys

| Key | Type | Required | Default | Description |
|-----|------|----------|---------|-------------|
| `version` | `number` | No | `1` | Config format version. Must be `1`. |
| `default_action` | `string` | No | `block` | Action applied when no rule matches. One of: `allow`, `block`, `confirm`. |
| `rules` | `Rule[]` | No | `[]` | Ordered list of rules evaluated top-to-bottom. |
| `hidden_tools` | `string[]` | No | `[]` | Tool names that are silently blocked on every call. |

## Rule object

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `name` | `string` | Yes | Human-readable identifier for debugging and UI messages. |
| `condition` | `string` | Yes | CEL expression that must evaluate to `true` for the rule to match. |
| `action` | `string` | Yes (leaf) | One of: `allow`, `block`, `confirm`. |
| `message` | `string` | No | Message shown when the rule blocks or confirms. |
| `rules` | `Rule[]` | No (parent) | Child rules. Mutually exclusive with `action`. Parent conditions are AND-ed with children. |

A rule with `rules` is a **parent** — it has no `action` and its `condition` is prepended to every child's condition. A rule with `action` is a **leaf** and must not have `rules`.

## Config locations (merged)

| Location | Scope | Precedence |
|----------|-------|------------|
| `~/.agents/permissions.yaml` | Agent-wide defaults | Lowest |
| `~/.pi/agent/permissions.yaml` | Global (all projects) | Middle |
| `.pi/permissions.yaml` | Project-local | Highest |

**Merge semantics:**
- Project-local overrides global, which overrides agent-wide defaults.
- `rules` and `hidden_tools` are **concatenated** (not replaced). Project-local rules appear after global rules in the evaluated list.
- All other keys (`version`, `default_action`) are overwritten by the highest-precedence config that defines them.

## Nested rules

Nested rules are a YAML convenience for grouping related conditions without repeating shared prefixes.

At load time, nested rules are **flattened** into a single ordered list:

- The parent's `condition` is **AND-ed** with each child's `condition`.
- The parent's `name` is **prefixed** onto each child's name (e.g., `Bash > rm`).
- The runtime engine evaluates the flat list top-to-bottom, first match wins.

Include an explicit `condition: 'true'` catch-all as the last child to define a group default.

## Examples

### Read-only sandbox

```yaml
version: 1
default_action: block
rules:
  - name: "Allow reads"
    condition: 'tool == "read"'
    action: allow
```

### Confirm destructive operations

```yaml
version: 1
default_action: allow
rules:
  - name: "Confirm rm"
    condition: 'tool == "bash" && command.contains("rm")'
    action: confirm
  - name: "Block sudo"
    condition: 'tool == "bash" && command.contains("sudo")'
    action: block
    message: "sudo is not allowed"
```

### Nested bash policy

```yaml
version: 1
default_action: block
rules:
  - name: "Allow reads in project"
    condition: 'path.startsWith(cwd)'
    action: allow

  - name: "Bash"
    condition: 'tool == "bash"'
    rules:
      - name: "Allow safe commands"
        condition: 'command.matches("^(ls|find|grep|git\\s+status)\\b")'
        action: allow
      - name: "Block destructive commands"
        condition: 'command.contains("rm") || command.contains("sudo")'
        action: block
        message: "Destructive shell commands are blocked"
      - name: "Confirm other bash"
        condition: 'true'
        action: confirm
        message: "Shell commands require manual approval"
```
