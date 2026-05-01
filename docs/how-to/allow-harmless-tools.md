# Allow harmless tools without approval

Some tools (like `TaskCreate`, `TaskUpdate`, etc.) are read-only or tracking-only but still trigger the `default_action` — causing confirmation dialogs or blocks on every call. This guide shows how to blanket-allow them so they execute without interrupting your workflow.

## Problem

With `default_action: confirm` (or `block`), every tool call that doesn't match an `allow` rule triggers a dialog — even for harmless operations like creating a task tracking entry.

## Solution

Match on the `tool` CEL variable. Tool names are exact strings like `TaskCreate`, `TaskUpdate`, `TaskList`, etc.

## Examples

### Allow all Task* tools except TaskExecute

```yaml
rules:
  - name: "Allow harmless task management"
    condition: 'tool.startsWith("Task") && tool != "TaskExecute"'
    action: allow
```

### Allow specific tools explicitly

```yaml
rules:
  - name: "Allow task tracking"
    condition: 'tool == "TaskCreate" || tool == "TaskUpdate" || tool == "TaskList" || tool == "TaskGet" || tool == "TaskOutput"'
    action: allow
```

### Allow read-only tools, keep writes confirmed

```yaml
rules:
  - name: "Allow read-only task tools"
    condition: 'tool == "TaskList" || tool == "TaskGet" || tool == "TaskOutput"'
    action: allow

  - name: "Allow task tracking updates"
    condition: 'tool == "TaskCreate" || tool == "TaskUpdate"'
    action: allow
```

## Warning

Be selective about which tools you allow. `TaskExecute` runs subagents and should usually stay behind `confirm` or `block`:

```yaml
rules:
  - name: "Keep TaskExecute gated"
    condition: 'tool == "TaskExecute"'
    action: confirm
    message: "Running a subagent requires approval"
```

## General pattern for harmless tools

You can apply the same pattern to any tool that is safe to auto-allow:

```yaml
rules:
  - name: "Allow harmless built-ins"
    condition: 'tool == "TaskList" || tool == "TaskGet" || tool == "TaskOutput" || tool == "TaskCreate" || tool == "TaskUpdate"'
    action: allow
```
