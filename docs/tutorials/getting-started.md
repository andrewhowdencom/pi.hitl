# Getting Started with pi.hitl

This tutorial walks you through installing pi.hitl and setting up your first permission sandbox. No prior knowledge of CEL or pi extensions is assumed.

## Learning Objectives

By the end of this tutorial, you will be able to:

- Install pi.hitl in your pi environment.
- Write a basic `permissions.yaml` configuration with allow, block, and confirm rules.
- Predict how different tool calls are evaluated against your rules.
- Reload a changed configuration without restarting your pi session.

## Intended Audience & Prerequisites

- **Who this is for:** First-time pi.hitl users who want to set up a permission sandbox for their projects.
- **Prerequisites:**
  - A working [pi](https://github.com/badlogic/pi-mono) installation.
  - Basic familiarity with YAML syntax (key-value pairs, lists, indentation).

## Background

pi.hitl is a permission sandbox that intercepts every tool call an LLM makes inside pi and evaluates it against rules you define in YAML. Each rule has a CEL (Common Expression Language) condition and an action: **allow** the call through, **block** it, or **confirm** it with an interactive dialog. Rules are checked top-to-bottom, and the first matching rule wins — like a firewall. This tutorial builds a simple three-rule sandbox step by step so you can see how each rule behaves in isolation.

---

## Step 1: Install pi.hitl

Run this command to install pi.hitl globally:

```bash
pi install git:github.com/andrewhowdencom/pi.hitl
```

Expected output:
```
Installing pi.hitl...
Done.
```

> **Tip:** You can also install project-local with `pi install -l git:...` if you want the extension active only in a single project.

---

## Step 2: Create the config directory

Inside your project directory, create the `.pi` folder where configuration lives:

```bash
mkdir -p .pi
```

---

## Step 3: Add the first rule — confirm all bash commands

Create `.pi/permissions.yaml` with a single rule that requires manual approval for every shell command:

```bash
cat > .pi/permissions.yaml << 'EOF'
version: 1
rules:
  - name: "Confirm bash commands"
    condition: 'tool == "bash"'
    action: confirm
    message: "Shell commands require manual approval"
EOF
```

What this does:
- Whenever the agent tries to run a `bash` command, a confirmation dialog appears.
- File reads and writes are not matched by this rule, so they fall through to the default action (`block`).

Verify the file:

```bash
cat .pi/permissions.yaml
```

---

## Step 4: Test the bash confirmation rule

Start a `pi` session in your project directory and ask it to run a bash command:

```
pi
> list the files in the current directory
```

Expected behavior:
```
🔒 Permission Rule: Confirm bash commands
Shell commands require manual approval

Tool: bash
Args:
{
  "command": "ls -la"
}

Allow this tool call to execute? (Y/n)
```

Type **Y** and press Enter to approve. The command runs, and you see the directory listing.

Try another command:

```
> show me the current git status
```

You will see the same confirmation dialog again because every `bash` call matches this rule.

---

## Step 5: Add the second rule — allow file operations inside the project

Now add a rule that auto-approves file reads and writes when the path is inside your project directory. Update the file to include both rules:

```bash
cat > .pi/permissions.yaml << 'EOF'
version: 1
rules:
  - name: "Confirm bash commands"
    condition: 'tool == "bash"'
    action: confirm
    message: "Shell commands require manual approval"

  - name: "Allow within project"
    condition: 'path.startsWith(cwd)'
    action: allow
EOF
```

What this does:
- **Rule 1** still matches first for bash commands ( confirmation dialog).
- **Rule 2** matches file operations (`read`, `write`, `edit`) whose resolved path starts with the current working directory.
- Rules are checked top-to-bottom. The first matching rule wins.

Verify the file:

```bash
cat .pi/permissions.yaml
```

---

## Step 6: Test the allow-within-project rule

Inside your active pi session, ask the agent to read a file:

```
> read the contents of README.md
```

Expected behavior:
```
✅ read README.md — allowed (path is under cwd)
```

The file read goes through without any dialog because it matches the "Allow within project" rule.

---

## Step 7: Add the third rule — block operations outside the project

Add a catch-all rule at the end that blocks anything not matched above:

```bash
cat > .pi/permissions.yaml << 'EOF'
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
EOF
```

What this does:
- **Rule 1** — Bash commands → confirmation dialog.
- **Rule 2** — File operations inside the project → auto-approved.
- **Rule 3** — Anything else (operations outside the project) → blocked immediately.

The `condition: 'true'` is a catch-all that matches every tool call. Because it is the last rule, it only catches calls that Rules 1 and 2 did not match.

Verify the file:

```bash
cat .pi/permissions.yaml
```

---

## Step 8: Test the block-outside-project rule

Ask the agent to read a file outside your project:

```
> read /etc/passwd
```

Expected behavior:
```
❌ Blocked by rule: Block outside project
Operations outside the project directory are blocked
```

The request is rejected immediately. No dialog appears because the "Block outside project" rule matches first.

Test a compound bash command to see how segmentation works:

```
> run ls && rm -rf /
```

Expected behavior:
```
❌ Blocked by rule: Block outside project
```

Wait — this is a bash command, so why didn't it show the confirmation dialog? Because the `rm -rf /` segment is evaluated independently and falls through to the default action (`block`), which blocks the entire compound command. (For details, see [Bash command segmentation](../reference/cel-variables.md#bash-command-segmentation).)

---

## Step 9: Check the loaded rules

Type the permissions command to see what rules are currently active:

```
/permissions
```

Expected output:
```
Permissions Config (3 rules, 0 hidden tools):
Status: enabled
Default action: block

Rules:
  1. [confirm] Confirm bash commands: tool == "bash"
  2. [allow] Allow within project: path.startsWith(cwd)
  3. [block] Block outside project: true
```

This confirms that all three rules were loaded from `.pi/permissions.yaml`.

---

## Step 10: Edit the config and reload without restarting

Open `.pi/permissions.yaml` in an editor and change the default action from `block` to `confirm`:

```yaml
version: 1
default_action: confirm   # <-- changed from block
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

Then reload the config inside the active session:

```
/permissions reload
```

Expected output:
```
Permissions reloaded: 3 rule(s), 0 hidden tool(s)
```

Now try reading `/etc/passwd` again:

```
> read /etc/passwd
```

Because `default_action` is now `confirm` and no earlier rule matched, a confirmation dialog appears instead of an immediate block.

---

## What next?

- Learn practical rule recipes in the [How-to Guides](../index.md#how-to-guides).
- Understand every CEL variable and function in the [Reference](../reference/cel-variables.md).
- Read why pi.hitl is designed this way in [About pi.hitl architecture](../explanation/architecture.md).
