# Getting Started with pi.hitl

This tutorial walks you through installing pi.hitl and setting up your first permission sandbox. No prior knowledge of CEL or pi extensions is assumed.

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

## Step 2: Create a permission configuration

Inside your project directory, create the folder and file `.pi/permissions.yaml`:

```bash
mkdir -p .pi
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
- **Rule 1** — Every `bash` tool call shows a confirmation dialog before running.
- **Rule 2** — File operations inside your project directory are auto-approved.
- **Rule 3** — Anything not matched above (operations outside the project) is blocked.

Rules are checked top-to-bottom. The first matching rule wins.

---

## Step 3: Test a file read inside the project

Start a `pi` session in your project directory and ask it to read a file:

```
pi
> read the contents of README.md
```

Expected behavior:
```
✅ read README.md — allowed (path is under cwd)
```

The file read goes through without any dialog because it matches the "Allow within project" rule.

---

## Step 4: Test a shell command

Ask the agent to run a bash command:

```
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

---

## Step 5: Test a file read outside the project

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

---

## Step 6: Check the loaded rules

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

## Step 7: Edit the config and reload without restarting

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
- Read why pi.hitl is designed this way in the [Architecture Explanation](../explanation/architecture.md).
