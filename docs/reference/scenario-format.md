# Scenario Test Format Reference

Scenario tests live in YAML files (conventionally `.pi/permissions.test.yaml`) and declare expected outcomes for specific tool calls against a `permissions.yaml` config.

## File Structure

```yaml
version: 1

tests:
  - name: "Test name"
    ...scenario fields...
```

- `version` — Currently must be `1`.
- `tests` — Array of scenario objects. Each object is an independent test case.

## Scenario Fields

### `name` (required)

Human-readable identifier displayed in test output.

```yaml
name: "Read inside project is allowed"
```

### `tool`, `args`, `cwd` (group: high-level)

Describe a tool call the way the pi extension sees it. The runner constructs the CEL context using `buildBaseContext` internally, so path resolution and `command` injection behave exactly like the real extension.

```yaml
tool: "read"
args:
  path: "./src/index.ts"
cwd: "/home/user/project"
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `tool` | `string` | — | Tool name (`read`, `write`, `edit`, `bash`, or any custom tool) |
| `args` | `object` | `{}` | Tool arguments map (e.g. `{ path: "./file.ts" }`) |
| `cwd` | `string` | `"/tmp"` | Absolute or relative working directory. Relative paths are resolved to absolute before CEL evaluation. |

### `context` (group: low-level)

Explicit CEL evaluation context. Use this when you need to test variables that would normally be injected by other extensions (e.g. `tool_source`, `tool_scope`) or when you want to bypass `buildBaseContext` entirely.

```yaml
context:
  tool: "custom_tool"
  tool_source: "builtin"
  my_var: "hello"
```

When both `context` and `tool` are present, `context` takes precedence.

### `has_ui` (optional)

Whether the evaluation should assume a UI is available. Affects `confirm` actions:

- `true` (default) — `confirm` rules produce `confirm`
- `false` — `confirm` rules fall back to `block`

```yaml
has_ui: false
expected: block  # because confirm → block when no UI
```

### `expected` (required)

Expected outcome. Must be one of:

- `allow` — Operation is permitted
- `block` — Operation is blocked
- `confirm` — Operation requires user confirmation

```yaml
expected: allow
```

### `expected_message_contains` (optional)

Assert that the block reason or confirm message contains the given substring.

- For `block` results, checks the `reason` string.
- For `confirm` results, checks each message and passes if **any** message contains the substring.

```yaml
expected: block
expected_message_contains: "outside the project"
```

### `expected_rule` (optional)

Assert that the matching rule (or one of the matching rules, for multi-segment bash commands) has the given exact name.

```yaml
expected: confirm
expected_rule: "Confirm rm"
```

For multi-segment bash commands, the assertion passes if the expected rule name appears in the combined result's rule list.

## Bash Command Splitting

When `tool: "bash"` and `args.command` contains shell operators (`&&`, `\|\|`, `|`, `;`, `&`, `;;`, or newlines), the scenario runner splits the command into segments and evaluates each independently, combining the results:

| Segment results | Combined result |
|-----------------|-----------------|
| All allow | `allow` |
| Any block | `block` (reasons joined with `; `) |
| No block, some confirm | `confirm` |

This mirrors the pi extension's exact behaviour.

```yaml
# Single-segment: evaluated directly
tests:
  - name: "Simple ls"
    tool: "bash"
    args:
      command: "ls -la"
    expected: allow

# Multi-segment: each part evaluated separately
tests:
  - name: "Compound blocks if dangerous"
    tool: "bash"
    args:
      command: "ls && rm -rf /"
    expected: block
```

## Complete Example

```yaml
version: 1

tests:
  - name: "Read inside project is allowed"
    tool: "read"
    args:
      path: "./src/index.ts"
    cwd: "/home/user/project"
    expected: allow

  - name: "Write outside project is blocked"
    tool: "write"
    args:
      path: "/etc/passwd"
    cwd: "/home/user/project"
    expected: block
    expected_message_contains: "outside"

  - name: "Bash rm needs confirmation"
    tool: "bash"
    args:
      command: "rm -rf /tmp/old"
    cwd: "/home/user/project"
    expected: confirm
    expected_rule: "Confirm rm"

  - name: "Bash rm blocks when no UI"
    tool: "bash"
    args:
      command: "rm -rf /tmp/old"
    cwd: "/home/user/project"
    has_ui: false
    expected: block

  - name: "Compound command blocks if any segment is dangerous"
    tool: "bash"
    args:
      command: "ls && rm -rf /"
    cwd: "/home/user/project"
    expected: block

  - name: "Custom context test"
    context:
      tool: "my_tool"
      custom_var: "hello"
    expected: allow
```
