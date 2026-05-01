# Handle MCP-CLI calls through bash

The pi coding agent can use [mcp-cli](../README.md) to interact with MCP servers. Since mcp-cli runs through the `bash` tool, the `path` CEL variable is `""` by default — the actual path is buried inside JSON in the command string.

## Problem

An mcp-cli invocation looks like this:

```bash
mcp-cli call filesystem read_file '{"path": "./README.md"}'
```

pi.hitl sees:
- `tool` = `"bash"`
- `command` = `"mcp-cli call filesystem read_file '{\\"path\\": \"./README.md\"}'"`

`path.startsWith(cwd)` does not work because `path` is `""` for bash commands.

## Solution

Use `command.contains()` or `command.matches()` (regex) to match mcp-cli patterns in the bash command string.

## Examples

### Allow safe discovery operations

> **YAML escaping note:** The double backslash `\\` in `\\s` is required because the condition string is inside a YAML double-quoted string. YAML interprets `\\` as a single `\`, which is what the CEL regex engine receives.

```yaml
rules:
  - name: "Allow mcp-cli discovery"
    condition: 'tool == "bash" && command.matches("mcp-cli\\s+(info|grep|list)")'
    action: allow
```

### Allow filesystem reads

```yaml
rules:
  - name: "Allow mcp-cli filesystem reads"
    condition: 'tool == "bash" && command.contains("mcp-cli call filesystem read_file")'
    action: allow
```

### Confirm filesystem writes

```yaml
rules:
  - name: "Confirm mcp-cli filesystem writes"
    condition: 'tool == "bash" && command.contains("mcp-cli call filesystem") && (command.contains("write_file") || command.contains("edit_file"))'
    action: confirm
    message: "MCP filesystem write requires approval"
```

### Block dangerous GitHub operations

```yaml
rules:
  - name: "Block dangerous github operations"
    condition: 'tool == "bash" && command.contains("mcp-cli call github") && command.matches("(delete_file|create_issue|create_pull_request)")'
    action: block
    message: "This GitHub MCP operation is blocked by policy"
```

### Confirm all remaining mcp-cli calls

```yaml
rules:
  - name: "Confirm any other mcp-cli call"
    condition: 'tool == "bash" && command.contains("mcp-cli call")'
    action: confirm
```

## Caveats

- Arguments piped from stdin (`cat args.json | mcp-cli call ...`) can't be inspected — the rule matches on the visible command string only.
- Only coarse server/tool-level rules are possible. You cannot do path-based sandboxing (e.g. "only allow reads within cwd") without parsing the JSON arguments.
- If you need path-based rules for MCP filesystem operations, the mcp-cli arguments must be inline in the command. Piped JSON is invisible to CEL.

## See also

- [Allow safe built-in tools without confirmation dialogs](allow-harmless-tools.md)
- [CEL variables, including `command`](../reference/cel-variables.md)
- [YAML rule schema](../reference/config-schema.md)
