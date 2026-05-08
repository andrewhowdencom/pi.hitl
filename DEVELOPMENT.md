# Development

This document is for contributors who want to build, test, or modify pi.hitl.

## Prerequisites

- [Node.js](https://nodejs.org/) ≥ 20 (for native `node:test` and `tsx` support)
- npm (comes with Node.js)

## Setup

```bash
git clone <repository-url>
cd pi.hitl
npm install
```

## Running Tests

All tests use Node.js's built-in test runner (`node:test`) and assertion module (`node:assert`):

```bash
npm test
```

This runs `tsx --test *.test.ts`, which discovers and executes all `*.test.ts` files in the project root.

### Test files

| File | Coverage |
|------|----------|
| `index.test.ts` | Extension event handlers and command registration |
| `context.test.ts` | Context building and tool metadata caching |
| `flatten-rules.test.ts` | Rule flattening and `default` shorthand expansion |
| `merge-rules.test.ts` | Config merge semantics (parent matching, child reordering) |
| `scenario.test.ts` | Scenario test parsing and field defaults |
| `scenario-runner.test.ts` | Scenario execution and bash segment combining |
| `splitter.test.ts` | Bash command splitting (quotes, escapes, operators) |
| `validator.test.ts` | Config validation (CEL syntax, duplicate names, catch-all ordering) |

## Running the Validator CLI Locally

```bash
npm run validate -- <config.yaml> [scenarios.yaml]
```

Or directly with tsx:

```bash
npx tsx validate.ts <config.yaml> [scenarios.yaml]
```

The validator checks YAML syntax, CEL expression validity, rule ordering, duplicate names, hidden-tool shadowing, and optionally runs scenario tests.

## Project Structure

```
pi.hitl/
├── index.ts              # Extension entry point (event handlers, commands)
├── config.ts             # Config loading, merging, and validation
├── rules.ts              # Rule/Config types, flattening, and merge logic
├── evaluator.ts          # CEL evaluation engine and action resolution
├── context.ts            # Context building and extension builder registry
├── splitter.ts           # Bash command segmentation
├── scenario.ts           # Scenario test types and loader
├── scenario-runner.ts    # Scenario test execution engine
├── validate.ts           # Standalone CLI validator
├── *.test.ts             # Unit tests (one per module)
├── docs/                 # User-facing documentation (Diátaxis framework)
├── skills/hitl/SKILL.md  # Agent skill documentation
└── package.json
```

## Key Concepts for Contributors

### Why CEL?

CEL was chosen because it is a lightweight, sandboxed expression language with a TypeScript implementation. It supports boolean logic, string operations, and custom functions without requiring a full scripting runtime. The alternative (a JS/TS evaluator) would require `eval()` or a VM, both of which increase the attack surface for a security-oriented extension.

### First Match Wins

Rules are evaluated top-to-bottom, first match wins. This mirrors firewall/ACL semantics and is intentionally simple — no priority system, no complex conflict resolution. A catch-all `condition: 'true'` at the end is the standard pattern.

### Eager Flattening

Nested parent/child rules are flattened at config load time, not at evaluation time. This means:
- The runtime engine is a single flat loop (no recursion).
- The cost is paid once per `/permissions reload` rather than on every tool call.
- Parent names are prefixed (`Bash > rm`) for clear debugging output.

### Non-Interactive Mode

When `ctx.hasUI` is `false` (e.g., `--mode json`, `--mode rpc`, or `-p` print mode), `confirm` actions fall back to `block`. This is a safety-first default — silently allowing destructive operations because no terminal is attached would violate the principle of least surprise.

### Extension Builder Isolation

Other extensions can inject CEL context variables via `hitl:register_context`. If a builder throws, the error is caught and logged; the permission gate continues with the remaining builders. This prevents a buggy third-party extension from breaking the entire sandbox.

## Submitting Changes

1. Add or update tests for any behavior change.
2. Run the full test suite: `npm test`.
3. Run the validator on the example configs: `npm run validate:example`.
4. Update relevant documentation in `docs/` (user-facing) or `README.md` / `ARCHITECTURE.md` (developer-facing).
5. Follow the existing code style — the project does not use a linter, so match the surrounding formatting.
