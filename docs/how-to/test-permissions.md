# How to test your permissions configuration

This guide shows you how to validate a `permissions.yaml` file and write scenario tests that verify your rules behave correctly.

## Validate a config file

Run the validator on any `permissions.yaml`:

```bash
npx pi-hitl-validate .pi/permissions.yaml
```

Or if you are in the pi.hitl repository:

```bash
npm run validate -- .pi/permissions.yaml
```

The validator checks:

- YAML syntax
- CEL expression validity in every `condition`
- `action` values are `allow`, `block`, or `confirm`
- Catch-all rules (`condition: 'true'`) are placed last
- No duplicate rule names
- No `hidden_tools` that shadow active rules

Output example:

```
Config loaded: 3 rules, 0 hidden tools

Warnings (1):
  ! Catch-all rule "Block outside" (index 1) is not the last rule — specific rules after it will never match

Valid with warnings.
```

Exit code `0` means the config is valid (warnings are non-fatal). Exit code `1` means there are errors that must be fixed.

## Write scenario tests

Create a `.pi/permissions.test.yaml` file next to your `permissions.yaml`:

```yaml
version: 1

tests:
  - name: "Read inside project is allowed"
    tool: "read"
    args:
      path: "./src/index.ts"
    cwd: "/home/user/project"
    expected: allow

  - name: "Write outside project is blocked"
    tool: "write"
    args:
      path: "/etc/passwd"
    cwd: "/home/user/project"
    expected: block
    expected_message_contains: "outside"

  - name: "Bash rm needs confirmation"
    tool: "bash"
    args:
      command: "rm -rf /tmp/old"
    cwd: "/home/user/project"
    expected: confirm
```

Run the scenarios:

```bash
npx pi-hitl-validate .pi/permissions.yaml .pi/permissions.test.yaml
```

Output example:

```
Config loaded: 3 rules, 0 hidden tools
Valid.

Running scenarios from .pi/permissions.test.yaml...

  ✓ Read inside project is allowed → allow
  ✓ Write outside project is blocked → block
  ✓ Bash rm needs confirmation → confirm

3 passed, 0 failed
Valid.
```

## Scenario schema

Each test under `tests:` supports these fields:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Human-readable test identifier |
| `tool` | No* | Tool name (e.g. `read`, `write`, `bash`) |
| `args` | No | Tool arguments object |
| `cwd` | No | Current working directory for path resolution |
| `context` | No* | Explicit CEL context variables (overrides `tool`/`args`/`cwd`) |
| `has_ui` | No | Whether the UI is available (default: `true`). Affects `confirm` → `block` fallback |
| `expected` | Yes | Expected outcome: `allow`, `block`, or `confirm` |
| `expected_message_contains` | No | Assert the block reason / confirm message contains this string |
| `expected_rule` | No | Assert the matching rule has this exact name |

*Either `tool` or `context` must be provided.

## Bash command splitting

When `tool: "bash"` and the command contains operators (`&&`, `\|\|`, `|`, `;`), the runner evaluates each segment independently and combines the results exactly as the pi extension does:

- If **any** segment is blocked, the whole command is blocked.
- If no block but **some** segment requires confirmation, the whole command requires confirmation.
- Only if **all** segments are allowed is the whole command allowed.

```yaml
tests:
  - name: "Compound command blocks if any segment is dangerous"
    tool: "bash"
    args:
      command: "ls && rm -rf /"
    cwd: "/home/user/project"
    expected: block
```

## Integrating with CI

You can run validation in CI as a simple shell step:

```yaml
# .github/workflows/permissions.yml
- name: Validate permissions
  run: npx pi-hitl-validate .pi/permissions.yaml .pi/permissions.test.yaml
```

Or add a test file that loads scenarios programmatically:

```typescript
// permissions.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { loadConfigFromFiles, validateConfig } from "pi.hitl/config";
import { loadScenariosFromFile, runScenarios } from "pi.hitl/scenario-runner";

const config = loadConfigFromFiles([".pi/permissions.yaml"]);
const validation = validateConfig(config!);

describe("permissions", () => {
  it("has no validation errors", () => {
    assert.strictEqual(validation.errors.length, 0);
  });

  const scenarios = loadScenariosFromFile(".pi/permissions.test.yaml");
  const results = runScenarios(config!, scenarios);

  for (const result of results) {
    it(result.scenario.name, () => {
      assert.ok(result.passed, result.message);
    });
  }
});
```

## Troubleshooting

### "Config loaded: 0 rules, 0 hidden tools"

The file loaded but contained no `rules` or `hidden_tools`. Check that the YAML has the expected top-level keys.

### Invalid CEL expression errors

CEL syntax errors are caught at validation time. Common mistakes:
- `tool = "bash"` → use `==` not `=`
- `path.startsWith(cwd)` → correct (custom function)
- `command.contains(rm)` → string literals need quotes: `command.contains("rm")`

### Catch-all ordering warning

A rule with `condition: 'true'` should be the last rule in the list. Otherwise, specific rules placed after it will never match.

### Hidden tool shadows rule

If a tool is in `hidden_tools` and also referenced in a rule `condition`, the rule can never match because hidden tools are silently blocked before rule evaluation.
