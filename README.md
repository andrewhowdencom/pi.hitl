# pi.hitl

Pi (Harness): Human in the Loop approval for the [pi coding agent](https://github.com/badlogic/pi-mono).

This extension intercepts **every** tool call the LLM attempts and presents a confirmation dialog before execution. In non-interactive modes (print, JSON, RPC), tool calls are blocked by default since no UI is available for manual approval.

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
pi install git:github.com/andrewhowdencom/pi.hitl@v0.1.0
```

### Manual copy

#### Global (all projects)

```bash
cp index.ts ~/.pi/agent/extensions/hitl.ts
```

#### Project-local (current project only)

```bash
mkdir -p .pi/extensions
cp index.ts .pi/extensions/hitl.ts
```

### Quick test (without installing)

```bash
pi -e ./index.ts
```

## Usage

Once loaded, every tool call triggers a confirmation dialog:

```
🔒 Approve Tool: bash

Command:
  ls -la

Allow this tool call to execute?
```

### Commands

| Command | Description |
|---------|-------------|
| `/hitl` | Toggle approval gate on/off |
| `/hitl on` | Enable approval gate |
| `/hitl off` | Disable approval gate |
| `/hitl status` | Show current gate state |

### Behavior

- **Enabled (default):** Every tool call shows a `confirm()` dialog. Press `y` or select "Yes" to approve, `n` / `Esc` / "No" to block.
- **Disabled:** Tool calls execute normally without approval.
- **Denied in a turn:** If you deny one tool in a multi-tool turn, all remaining tools in that turn are automatically blocked to avoid approval spam.
- **Non-interactive modes:** When running `pi -p` (print mode), `--mode json`, or `--mode rpc`, the gate blocks all tool calls with a message explaining why.

### State Persistence

The on/off state is persisted in the session via `pi.appendEntry()`, so it survives:
- Session reload (`/reload`)
- Session resume (`/resume`)
- Session forks (`/fork`, `/clone`)

## Why HITL?

The pi coding agent has powerful tools (`bash`, `edit`, `write`) that can modify your system. This extension gives you a safety net — nothing executes until you explicitly approve it.

## License

See [LICENSE](LICENSE).
