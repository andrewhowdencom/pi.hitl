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

Project-local (current project only):
```bash
mkdir -p .pi/extensions
cp index.ts .pi/extensions/permissions.ts
```

### Quick test (without installing)
```bash
pi -e ./index.ts
```

## Documentation

For the full documentation — tutorials, how-to guides, reference, and architecture explanations — see the [documentation hub](docs/index.md).

## License

See [LICENSE](LICENSE).
