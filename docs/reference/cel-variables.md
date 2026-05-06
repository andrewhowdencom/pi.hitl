# CEL Variables and Functions

This document lists all context variables and custom functions available in pi.hitl rule conditions.

## Variables

| Variable | Type | Description |
|----------|------|-------------|
| `tool` | `string` | Tool name: `read`, `write`, `edit`, `bash`, or any custom tool name. |
| `args` | `map` | Full tool arguments object. Access nested fields with dot notation: `args.path`, `args.timeout`. |
| `cwd` | `string` | Absolute current working directory of the session. |
| `path` | `string` | Resolved absolute path for file-based tools (`read`, `write`, `edit`). Empty string (`""`) for `bash` and tools without a `path` argument. |
| `command` | `string` | Bash command string. Available only when `tool == "bash"`. Empty string for all other tools. When the command contains compound operators, rules are evaluated per-segment — see [Bash command segmentation](#bash-command-segmentation) below. |
| `tool_source` | `string` | Tool origin: `"builtin"`, `"sdk"`, the extension path that registered it, or `"unknown"`. |
| `tool_scope` | `string` | Tool scope: `"user"`, `"project"`, `"temporary"`, or `"unknown"`. |

## Functions

| Function | Signature | Description | Example |
|----------|-----------|-------------|---------|
| `path.startsWith(prefix)` | `(string, string) → bool` | String prefix check. | `path.startsWith(cwd)` |
| `path.contains(substr)` | `(string, string) → bool` | Substring check. | `command.contains("sudo")` |
| `str.matches(pattern)` | `(string, string) → bool` | Regex match. The pattern is a JavaScript `RegExp` string. | `command.matches("rm\\s+-rf")` |

Standard CEL functions also work: `==`, `!=`, `&&`, `\|\|`, `!`, comparison operators, string methods, and boolean logic.

## Bash command segmentation

For `bash` tool calls, compound commands that contain operators (`&&`, `||`, `|`, `;`, `&`, or newlines) are automatically split into individual command segments. CEL rules are evaluated **independently for each segment**, with the `command` variable set to that segment's text.

### Splitting behavior

The splitter respects shell quoting and escaping:
- **Single quotes** (`'...'`) and **double quotes** (`"..."`) prevent splitting inside the quoted region.
- **Backslash escapes** (`\&&`, `\|`) prevent splitting on the escaped operator.
- **Redirect operators** (`>`, `<`, `>>`, `>&`, `<&`, `&>`) are **not** treated as command separators.

### Combining precedence

After evaluating rules for each segment, segment results are combined using this precedence:

`block` > `confirm` > `default_action` > `allow`

- If **any** segment matches a `block` rule → the whole compound command is **blocked**.
- If **no** block but **any** segment matches a `confirm` rule → a **single** confirmation dialog is shown for the whole command.
- If **all** segments match `allow` rules → the whole command is **allowed**.
- If some segments have no matching rule → the segment falls through to `default_action`, which may result in block or confirm.

### Example: whitelist with compound commands

```yaml
rules:
  - name: "Allow safe commands"
    condition: 'command.startsWith("ls") || command.startsWith("cat") || command.startsWith("tail")'
    action: allow
  - name: "Block everything else"
    condition: 'tool == "bash"'
    action: block
```

With this config:
- `ls -la` → ✅ allowed (single segment matches)
- `tail -n1000 | head -20` → ✅ allowed (both `tail` and `head` segments match)
- `ls && rm -rf /` → ❌ blocked (`ls` segment allows, but `rm` segment falls to default `block`)
- `echo "a && b"` → ✅ allowed (the `&&` is inside quotes, so it's one segment: `echo "a && b"`)

## Path resolution

All relative paths are resolved to **absolute paths** before CEL evaluation. This means `path.startsWith(cwd)` correctly handles relative inputs such as:

- `./src/file.ts` → resolves to `/home/user/project/src/file.ts`
- `../other/file.ts` → resolves to `/home/user/other/file.ts` (will not match `cwd`)

Path resolution uses `node:path.resolve(cwd, args.path)`. The `cwd` variable itself is also resolved to an absolute path.

## Extension-Provided Variables

Other pi extensions can inject their own variables into the CEL context by registering a **context builder** function. This lets permission rules reference extension-specific state — for example, the currently active agent, execution mode, or custom flags — without pi.hitl needing to import or know about those extensions.

### Registration contract

Extensions register a builder by emitting an event on the shared `pi.events` bus:

```typescript
pi.events.emit("hitl:register_context", {
  name: "my_extension",
  builder: (toolName, input, cwd, ctx) => ({ my_var: 42 }),
});
```

The builder receives the same arguments pi.hitl uses for its base context:

| Parameter | Type | Description |
|-----------|------|-------------|
| `toolName` | `string` | Name of the tool being evaluated. |
| `input` | `unknown` | The tool's input arguments. |
| `cwd` | `string` | Current working directory (absolute). |
| `ctx` | `ExtensionContext` | Full pi extension context (session manager, UI, etc.). |

The builder returns a plain object whose keys are merged into the CEL context. Return values may be synchronous or asynchronous (a `Promise` that resolves to the object).

### Announcement protocol

Because extensions load in an unpredictable order, pi.hitl may start listening **after** another extension has already emitted its registration. To handle this, pi.hitl emits `hitl:announce` during every `session_start`. Extensions that loaded earlier should listen for this event and re-emit their registration:

```typescript
pi.events.on("hitl:announce", () => {
  pi.events.emit("hitl:register_context", {
    name: "my_extension",
    builder: (toolName, input, cwd, ctx) => ({ my_var: 42 }),
  });
});
```

Emitting in **both** places (proactively at startup and reactively on `hitl:announce`) ensures the registration is captured regardless of load order.

### Builder error isolation

If a builder throws an exception, pi.hitl logs the error (including the builder's name) and continues evaluating the remaining builders and rules. A failing builder does not break the permission gate for that tool call.

### Key override rules

When multiple builders return the same key, **later builders override earlier ones**. Built-in variables (`tool`, `args`, `cwd`, `path`, `command`, `tool_source`, `tool_scope`) are set before any extension builders run, so an extension builder can override them if needed. Extension authors should use **namespaced keys** (e.g., `myext_foo`) to avoid accidental collisions.
