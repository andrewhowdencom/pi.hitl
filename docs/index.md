# pi.hitl Documentation

pi.hitl is a CEL-based permission sandbox for the [pi coding agent](https://github.com/badlogic/pi-mono).

This documentation follows the [Diátaxis framework](https://diataxis.fr), which organizes docs into four types based on what the reader needs:
- **Tutorials** — Step-by-step lessons for first-time learners.
- **How-to Guides** — Problem-oriented recipes for specific situations.
- **Reference** — Technical descriptions of the system's nuts and bolts.
- **Explanation** — Understanding-oriented discussions of design rationale and architecture.

---

## New here?

If you're setting up pi.hitl for the first time, start with the [Getting Started tutorial](tutorials/getting-started.md). It walks you through installation, creating your first `.pi/permissions.yaml`, and testing the sandbox step by step — no prior knowledge required.

---

## Tutorials

Tutorials are **learning-oriented** step-by-step guides for first-time users.

- [Getting Started](tutorials/getting-started.md) — Step-by-step first-time setup

## How-to Guides

How-to guides are **problem-oriented** recipes for specific situations.

- [How to allow harmless tools without approval](how-to/how-to-allow-harmless-tools.md) — Blanket-allow safe tools so they don't trigger confirmation dialogs
- [How to handle MCP-CLI calls through bash](how-to/how-to-handle-mcp-cli-calls.md) — Write rules for mcp-cli running through the `bash` tool

## Reference

Reference docs are **information-oriented** descriptions of the system's nuts and bolts.

- [YAML configuration schema](reference/config-schema.md) — Top-level keys, rule objects, config locations, merge semantics, and nested rules
- [CEL variables and functions](reference/cel-variables.md) — Context variables (`tool`, `args`, `cwd`, `path`, `command`) and custom CEL functions
- [/permissions CLI commands](reference/commands.md) — Command descriptions, arguments, side effects, and state persistence details

## Explanation

Explanation docs are **understanding-oriented** discussions of design rationale and architecture.

- [About pi.hitl architecture](explanation/architecture.md) — How pi.hitl works and why it was designed this way
