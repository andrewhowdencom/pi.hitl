# CEL Variables and Functions

This document lists all context variables and custom functions available in pi.hitl rule conditions.

## Variables

| Variable | Type | Description |
|----------|------|-------------|
| `tool` | `string` | Tool name: `read`, `write`, `edit`, `bash`, or any custom tool name. |
| `args` | `map` | Full tool arguments object. Access nested fields with dot notation: `args.path`, `args.timeout`. |
| `cwd` | `string` | Absolute current working directory of the session. |
| `path` | `string` | Resolved absolute path for file-based tools (`read`, `write`, `edit`). Empty string (`""`) for `bash` and tools without a `path` argument. |
| `command` | `string` | Bash command string. Available only when `tool == "bash"`. Empty string for all other tools. |

## Functions

| Function | Signature | Description | Example |
|----------|-----------|-------------|---------|
| `path.startsWith(prefix)` | `(string, string) → bool` | String prefix check. | `path.startsWith(cwd)` |
| `path.contains(substr)` | `(string, string) → bool` | Substring check. | `command.contains("sudo")` |
| `str.matches(pattern)` | `(string, string) → bool` | Regex match. The pattern is a JavaScript `RegExp` string. | `command.matches("rm\\s+-rf")` |

Standard CEL functions also work: `==`, `!=`, `&&`, `\|\|`, `!`, comparison operators, string methods, and boolean logic.

## Path resolution

All relative paths are resolved to **absolute paths** before CEL evaluation. This means `path.startsWith(cwd)` correctly handles relative inputs such as:

- `./src/file.ts` → resolves to `/home/user/project/src/file.ts`
- `../other/file.ts` → resolves to `/home/user/other/file.ts` (will not match `cwd`)

Path resolution uses `node:path.resolve(cwd, args.path)`. The `cwd` variable itself is also resolved to an absolute path.
