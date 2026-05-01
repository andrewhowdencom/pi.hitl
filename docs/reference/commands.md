# /permissions CLI Commands

These commands are registered by the pi.hitl extension and available in every pi session.

## Command reference

| Command | Aliases | Description | Arguments | Side effects |
|---------|---------|-------------|-----------|------------|
| `/permissions` | — | Show current rules, hidden tools, enabled/disabled state, and default action. | None | None |
| `/permissions status` | — | Same as `/permissions`. | None | None |
| `/permissions reload` | — | Reload config from disk. Re-evaluates all config locations and re-flattenes nested rules. | None | Overwrites in-memory config. |
| `/permissions on` | `/permissions enable`, `/permissions true` | Enable permission checks. | None | Persists `enabled: true` via `pi.appendEntry("permissions-state")`. Survives session reload, resume, and fork. |
| `/permissions off` | `/permissions disable`, `/permissions false` | Disable permission checks. All tool calls are allowed without evaluation. | None | Persists `enabled: false` via `pi.appendEntry("permissions-state")`. Survives session reload, resume, and fork. |

## Example usage

Show current state:
```
/permissions status
```

Enable after temporarily disabling:
```
/permissions on
```

Edit `.pi/permissions.yaml` in another terminal, then reload:
```
/permissions reload
```

## State persistence

The `on` and `off` states are stored in the session's custom entry list via `pi.appendEntry()`. This means the state survives:

- `/reload` — session reload
- `/resume` — session resume
- `/fork`, `/clone` — session forks

When a session starts, the extension iterates over all entries and restores the most recent `permissions-state` entry.
