# Agent Context

This document lists the skill files and agent-specific instructions available in this repository.

## Skills

| Directory | Purpose | Audience |
|-----------|---------|----------|
| `skills/hitl/` | pi.hitl permission sandbox configuration | AI agents editing `permissions.yaml` files |

### `skills/hitl/SKILL.md`

Provides instructions for creating and editing `permissions.yaml` configuration files for the pi.hitl CEL-based permission sandbox. Covers:

- Configuration file locations and merge precedence
- Top-level schema (`version`, `default_action`, `rules`, `hidden_tools`)
- Rule structure (leaf vs parent rules, evaluation order, flattening)
- CEL variables and custom functions
- Common configuration patterns (sandbox, read-only, MCP-CLI, etc.)
- `/permissions` commands
- Validation workflow and common errors
- Best practices for rule ordering and tool gating

## For Extension Authors

If you are building a pi extension that wants to expose custom CEL variables for permission rules, emit a `hitl:register_context` event on the shared `pi.events` bus. See `ARCHITECTURE.md` for the registration contract and announcement protocol.

## Adding New Skills

To add a new skill:

1. Create a directory under `skills/<name>/`.
2. Add a `SKILL.md` file with a YAML frontmatter block:
   ```yaml
   ---
   name: <skill-name>
   description: <brief description of what the skill covers>
   ---
   ```
3. Update this `AGENTS.md` file to list the new skill in the table above.

The skill file should be self-contained and follow the same structure as `skills/hitl/SKILL.md`: problem-oriented guidance, concrete examples, and clear references to related documentation.
