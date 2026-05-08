# pi.hitl

CEL-based permission sandbox for the [pi coding agent](https://github.com/badlogic/pi-mono).

This extension intercepts every tool call the LLM attempts and evaluates it against CEL (Common Expression Language) rules defined in YAML. Rules can **allow** operations within a sandbox, **block** dangerous actions, or **confirm** sensitive operations with an interactive dialog.

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
- `bash ls && rm -rf /` → ❌ blocked (the `rm` segment is dangerous, so the whole compound command is blocked)
- `bash tail -n1000 | head -20` → ✅ auto-approved (both segments are safe when whitelisted)

The conditions above use `tool`, `path`, and `cwd`. Other available CEL variables include `args`, `command`, `tool_source`, and `tool_scope`. The `matches` function is a custom CEL extension that works as a method on string values, e.g. `command.matches("rm\\s+-rf")`. See the [full CEL variable reference](docs/reference/cel-variables.md) for details.

## Installation

### Via `pi install` (recommended)

Install globally:
```bash
pi install git:github.com/andrewhowdencom/pi.hitl
```

Or project-local:
```bash
pi install -l git:github.com/andrewhowdencom/pi.hitl
```

### Manual copy

Global (all projects):
```bash
cp index.ts ~/.pi/agent/extensions/permissions.ts
```

> The destination file name is not significant; `permissions.ts` is just a convention.

Project-local (current project only):
```bash
mkdir -p .pi/extensions
cp index.ts .pi/extensions/permissions.ts
```

### Quick test (without installing)
```bash
pi -e ./index.ts
```

## Testing your permissions

Validate a `permissions.yaml` file without running the full pi extension:

```bash
npx pi-hitl-validate .pi/permissions.yaml
```

Add scenario tests in `.pi/permissions.test.yaml` and run them:

```bash
npx pi-hitl-validate .pi/permissions.yaml .pi/permissions.test.yaml
```

The validator checks CEL syntax, rule ordering, hidden-tool shadowing, and simulates how specific tool calls would be handled. See [How to test your permissions](docs/how-to/test-permissions.md) and the [scenario format reference](docs/reference/scenario-format.md) for details.

## Documentation

For the full documentation — tutorials, how-to guides, reference, and architecture explanations — see the [documentation hub](docs/index.md).

## License

See [LICENSE](LICENSE).
