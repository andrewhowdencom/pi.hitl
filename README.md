# pi.hitl

Pi (Harness): CEL-based permission sandbox for the [pi coding agent](https://github.com/badlogic/pi-mono).

This extension intercepts every tool call the LLM attempts and evaluates it against a set of CEL (Common Expression Language) rules defined in YAML configuration. Rules can **allow** operations within a sandbox, **block** dangerous actions, or **confirm** sensitive operations with an interactive dialog.

## Quick Example

Create `.pi/permissions.yaml` in your project:

```yaml
version: 1
rules:
  - name: "Confirm bash commands"
    condition: 'tool == "bash"'
    action: confirm
    message: "Shell commands require manual approval"

  - name: "Allow within project"
    condition: 'path.startsWith(cwd)'
    action: allow

  - name: "Block outside project"
    condition: 'true'
    action: block
    message: "Operations outside the project directory are blocked"
```

Result:
- `read src/main.ts` → ✅ auto-approved (path is under cwd)
- `write /etc/passwd` → ❌ blocked (outside cwd)
- `bash rm -rf /` → 🔒 confirmation dialog appears

## Installation

### Via `pi install` (recommended)

Install from git globally:

```bash
pi install git:github.com/andrewhowdencom/pi.hitl
```

Or install project-local:

```bash
pi install -l git:github.com/andrewhowdencom/pi.hitl
```

Pin to a specific version with a ref:

```bash
pi install git:github.com/andrewhowdencom/pi.hitl@v0.2.0
```

### Manual copy

#### Global (all projects)

```bash
cp index.ts ~/.pi/agent/extensions/permissions.ts
```

#### Project-local (current project only)

```bash
mkdir -p .pi/extensions
cp index.ts .pi/extensions/permissions.ts
```

### Quick test (without installing)

```bash
pi -e ./index.ts
```

## Configuration

Rules are defined in YAML files loaded at startup and on `/permissions reload`.

### Config locations (merged, project overrides global)

| Location | Scope |
|----------|-------|
| `~/.pi/agent/permissions.yaml` | Global (all projects) |
| `.pi/permissions.yaml` | Project-local (overrides global) |

### Config schema

```yaml
version: 1
default_action: block   # Optional; defaults to block if omitted

rules:
  - name: "Human-readable rule name"
    condition: 'CEL expression'   # Must evaluate to true for the rule to fire
    action: allow | block | confirm
    message: "Optional message shown when blocking"

hidden_tools:
  - "tool_name"  # These tools are silently blocked (LLM can still see them)
```

### Rule evaluation order

Rules are evaluated **top-to-bottom**. The **first matching rule wins**.

### Default action

If no rule matches, the `default_action` is applied:
- `allow` — execute the tool
- `block` — reject with a message (safest default)
- `confirm` — show a confirmation dialog (or block in non-interactive mode)

### CEL variables

Available in every rule's `condition`:

| Variable | Type | Description |
|----------|------|-------------|
| `tool` | `string` | Tool name: `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`, or custom tool name |
| `args` | `map` | Full tool arguments object (e.g., `args.path`, `args.timeout`) |
| `cwd` | `string` | Current working directory (absolute, resolved) |
| `path` | `string` | Resolved absolute path for file-based tools; `""` for bash and tools without a path argument |
| `command` | `string` | Bash command string (bash tool only) |

### CEL functions

| Function | Description | Example |
|----------|-------------|---------|
| `path.startsWith(prefix)` | String prefix check | `path.startsWith(cwd)` |
| `path.contains(substr)` | Substring check | `command.contains("sudo")` |
| `str.matches(pattern)` | Regex match (custom) | `command.matches("rm\\s+-rf")` |

Standard CEL functions like `==`, `!=`, `&&`, `\|\|`, `!` also work.

### Path resolution

All relative paths are resolved to **absolute paths** before CEL evaluation. This means:

- `path.startsWith(cwd)` correctly handles `./src/file.ts` → resolves to `/home/user/project/src/file.ts`
- `../other/file.ts` → resolves to `/home/user/other/file.ts` (won't match `cwd`)

## Commands

| Command | Description |
|---------|-------------|
| `/permissions` | Show current rules, status, and hidden tools |
| `/permissions reload` | Reload config from disk |
| `/permissions on` | Enable permission checks |
| `/permissions off` | Disable permission checks (allow all) |

## Example configs

### Read-only mode

```yaml
version: 1
rules:
  - name: "Allow reads"
    condition: 'tool == "read" || tool == "grep" || tool == "find" || tool == "ls"'
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

### Hide tools entirely

```yaml
version: 1
default_action: allow
rules: []
hidden_tools:
  - "bash"
  - "write"
```

## How it works

1. **Config load** — On session start, the extension loads and merges `~/.pi/agent/permissions.yaml` and `.pi/permissions.yaml`
2. **System prompt injection** — If sandbox rules are detected, a note is injected into the system prompt so the LLM knows its constraints
3. **Tool call interception** — Every `tool_call` event evaluates the rules in order against the tool's context (name, arguments, cwd, resolved path)
4. **Action** — The first matching rule determines the outcome:
   - `allow`: execute normally
   - `block`: reject with an explanatory message
   - `confirm`: show a `ctx.ui.confirm()` dialog; in non-interactive modes (`-p`, `--mode json`, `--mode rpc`), confirmation defaults to **block**

## State Persistence

The on/off state from `/permissions on|off` is persisted in the session via `pi.appendEntry()`, so it survives:
- Session reload (`/reload`)
- Session resume (`/resume`)
- Session forks (`/fork`, `/clone`)

## Behavior

- **Denied in a turn:** If you deny one tool in a multi-tool turn, all remaining tools in that turn are automatically blocked to avoid approval spam.
- **Non-interactive modes:** When running `pi -p` (print mode), `--mode json`, or `--mode rpc`, `confirm` actions default to **block** since no UI is available.
- **Hidden tools:** Tools listed in `hidden_tools` are silently blocked on every call.

## License

See [LICENSE](LICENSE).
