# Plan: Add Bash Command Segmentation for Per-Segment Permission Evaluation

## Objective

Modify pi.hitl's permission evaluation for `bash` tool calls so that compound commands (chained with `&&`, `||`, `|`, `;`, `&`, or newlines) are split into individual segments, and CEL rules are evaluated against each segment independently. This allows permission rules to safely whitelist useful chained commands (e.g. `tail -n1000 | head -20`) while correctly blocking or confirming dangerous commands hidden in later segments (e.g. `ls && rm -rf /`).

## Context

- **pi.hitl** is a CEL-based permission sandbox for the pi coding agent, intercepting tool calls and evaluating them against YAML rules.
- **Current behavior**: The `tool_call` handler in `index.ts` evaluates the rule set once against the full `command` string. A rule like `command.startsWith("ls")` allows `ls && rm` because the full string starts with `"ls"`. Conversely, `tail -n1000 | head -20` is blocked by whitelist rules because the full string doesn't start with a safe prefix.
- **The pi coding agent guidelines** prohibit bash chaining (`&&`, `||`, `|`, `;`), but agents legitimately use chaining for context window management (e.g. `tail | head`, `grep | sort`).
- **Existing validation** (`flatten-rules.test.ts`) covers rule flattening and CEL syntax validation, but there is no test coverage for the `tool_call` evaluation loop itself.
- **Minimal dependency footprint**: pi.hitl currently depends only on `@bufbuild/cel` and `yaml`. The project philosophy favors minimal, zero-dependency solutions where possible.
- **`buildBaseContext`** (`context.ts`) assembles the CEL context including the `command` variable for `bash` tool calls. The `command` variable contains the raw, full command string.
- **CEL functions**: Custom functions `path.startsWith()`, `path.contains()`, and `str.matches()` are available. Standard CEL list operations (`exists`, `all`) are assumed supported by `@bufbuild/cel`.

## Architectural Blueprint

### Selected Approach: Per-Segment Evaluation with Custom Quote-Aware Splitter

After evaluating alternatives, we select a **custom quote-aware command splitter** combined with **per-segment rule evaluation** (previously discussed as "Option C").

#### Tree-of-Thought Deliberation

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **A. `shell-quote` dependency** (0 deps, 24KB) | Quote-aware, battle-tested, recognizes all operators | Normalizes quotes/escapes in reconstructed segments, which can break CEL regex rules. Adds external dependency. | Rejected |
| **B. `bash-parser` dependency** (21 deps, 168KB) | Full AST parser | Reconstructing segment text from AST loses original syntax fidelity. Heavy dependency footprint. CJS-only. | Rejected |
| **C. Custom quote-aware splitter** (~50–100 lines, 0 deps) | Preserves exact original text. Zero dependencies. Tailored to exact operators we need. Aligned with pi.hitl minimalism. | Must be tested for shell edge cases. Slightly more code to maintain. | **Selected** |

The splitter scans the command string character-by-character, tracking single-quote, double-quote, and backslash-escape state. It splits only when it encounters a command separator (`&&`, `||`, `|`, `;`, `&`, or newline) outside of any quote context. It returns an array of segment strings with original text preserved (trimmed of surrounding whitespace).

The `tool_call` handler is modified to:
1. For all `bash` tool calls, split the `command` into segments.
2. For each segment, create a copy of the CEL evaluation context with `command` set to the segment text.
3. Evaluate the full rule set against each segment context independently.
4. Combine segment results using precedence: **block > confirm > default_action > allow**.
   - If ANY segment resolves to `block` → block the whole compound command.
   - Else if ANY segment resolves to `confirm` → show ONE confirmation dialog for the whole compound command.
   - Else if ALL segments resolve to `allow` → allow the whole compound command.
   - Else (mixed/no-match) → apply `default_action`.
5. For single-segment commands (no operators), behavior is identical to current evaluation.

### New Components

- **`splitter.ts`**: Quote-aware bash command segment splitter.
- **`splitter.test.ts`**: Unit tests for the splitter covering quotes, escapes, operators, edge cases.

### Modified Components

- **`index.ts`**: `tool_call` handler — adds per-segment evaluation loop and result combination logic.
- **`docs/reference/cel-variables.md`**: Document per-segment evaluation semantics.
- **`README.md`**: Update quick example to mention compound command behavior.
- **`docs/how-to/how-to-handle-mcp-cli-calls.md`**: Add note about compound mcp-cli invocations.

## Requirements

1. A new utility function `splitBashCommand(command: string): string[]` must be implemented in `splitter.ts` that splits compound bash commands into segments while respecting quotes and escapes. [explicit]
2. The splitter must recognize command separators: `&&`, `||`, `|`, `;`, `&` (when not part of `&&`, `|&`, `>&`, `<&`), and newlines. [explicit]
3. The splitter must NOT split inside single quotes (`'...'`), double quotes (`"..."`), or after backslash escapes. [explicit]
4. The `tool_call` handler in `index.ts` must evaluate the rule set independently for each command segment. [explicit]
5. Results across segments must be combined with precedence: `block` > `confirm` > `default_action` > `allow`. [explicit]
6. Single-segment commands (no operators) must behave identically to the current single-evaluation behavior. [inferred]
7. The confirmation dialog for compound commands must appear at most once, for the whole command, not per-segment. [inferred]
8. If any segment blocks, the confirmation dialog must NOT be shown. [inferred]
9. Unit tests must cover: simple commands, piped commands, `&&`/`||` chains, quoted strings containing operators, escaped operators, newlines as separators, and empty segments. [explicit]
10. Existing test suites (`context.test.ts`, `flatten-rules.test.ts`, `merge-rules.test.ts`) must continue to pass. [inferred]
11. Documentation must be updated to explain the new per-segment evaluation semantics to rule authors. [explicit]

## Task Breakdown

### Task 1: Implement Quote-Aware Bash Command Splitter
- **Goal**: Create a utility that splits compound bash commands into segments while respecting quotes and escapes.
- **Dependencies**: None.
- **Files Affected**: None (new files).
- **New Files**: `splitter.ts`, `splitter.test.ts`
- **Interfaces**: `export function splitBashCommand(command: string): string[]`
- **Details**: Implement `splitBashCommand` in `splitter.ts`. The function scans the input string character-by-character, tracking quote state (single, double, escaped) and splitting on command separators only when outside quotes. Return an array of trimmed segment strings. Empty or whitespace-only segments should be filtered out. In `splitter.test.ts`, add comprehensive unit tests covering: simple commands (`ls -la`), pipes (`tail | head`), logical operators (`ls && rm`, `foo || bar`), sequential separators (`echo a; echo b`), backgrounding (`foo & bar`), quoted strings containing operators (`echo "a && b"`), escaped operators (`echo a \&& b`), newlines as separators, and edge cases like multiple consecutive operators or empty segments.

### Task 2: Modify `tool_call` Handler for Per-Segment Evaluation
- **Goal**: Update the `tool_call` event handler in `index.ts` to evaluate rules per command segment and combine results.
- **Dependencies**: Task 1.
- **Files Affected**: `index.ts`
- **New Files**: None.
- **Interfaces**: No new public interfaces. Internal change to the `tool_call` handler evaluation loop.
- **Details**: In the `tool_call` handler, after building the base context and before evaluating rules, check if `event.toolName === "bash"`. If so, call `splitBashCommand(String(context.command))` to get segments. If only one segment (no operators), evaluate rules once as before (fast path). If multiple segments, evaluate the rule set against each segment independently:
  1. Clone the CEL context object for each segment, setting `command` to the segment text.
  2. Run the existing `evaluateRule` / rule-matching loop for each segment context.
  3. Collect the resolved action for each segment (`allow`, `block`, `confirm`, or `default_action`).
  4. Combine using precedence: if any `block` → `block`; else if any `confirm` → `confirm`; else if all `allow` → `allow`; else → `default_action`.
  5. For `confirm`, show ONE confirmation dialog using the full original command string in the dialog message (not per-segment). If the user denies, set `deniedThisTurn = true`.
  6. For `block`, construct a reason message that mentions the segment(s) that triggered the block (e.g., "Blocked by rule: Bash > rm (segment 2 of 2)").

### Task 3: Add Integration Tests for Per-Segment Evaluation
- **Goal**: Verify that compound commands are correctly evaluated segment-by-segment.
- **Dependencies**: Task 2.
- **Files Affected**: `index.ts` (may require minor refactoring for testability)
- **New Files**: `index.test.ts` (if testable), or extend existing test infrastructure
- **Interfaces**: May require extracting the evaluation loop into a testable function.
- **Details**: Add tests that verify the full permission gate behavior for compound commands. Because `index.ts` currently has no test coverage and the `tool_call` handler depends on `pi` extension API and UI, this may require:
  - Extracting the evaluation + combination logic into a pure function that takes `(config, rules, context, segments)` and returns an action result, OR
  - Creating a mock `pi` extension API and `ExtensionContext` for integration tests.
  Test cases must cover:
  - `ls && rm` with a block rule for `rm` → whole command blocked
  - `tail | head` with allow rules for both → whole command allowed
  - `ls && echo hi` with an allow rule for `ls` only → falls to `default_action`
  - `echo "a && b"` (quoted operator) → single segment, not split
  - Single command `ls -la` → identical to current behavior

### Task 4: Update CEL Variables Documentation
- **Goal**: Document the new per-segment evaluation semantics for rule authors.
- **Dependencies**: Task 2.
- **Files Affected**: `docs/reference/cel-variables.md`
- **New Files**: None.
- **Interfaces**: None.
- **Details**: Update the `command` variable description in `docs/reference/cel-variables.md` to state that for `bash` tool calls, compound commands are automatically split into segments and rules are evaluated against each segment independently. Add an example showing how a whitelist rule like `command.startsWith("ls")` behaves with compound commands. Add a note about the combining precedence (`block > confirm > default > allow`). Mention that quoted operators are not split.

### Task 5: Update README and How-To Guides
- **Goal**: Update project documentation to reflect compound command support.
- **Dependencies**: Task 4.
- **Files Affected**: `README.md`, `docs/how-to/how-to-handle-mcp-cli-calls.md`
- **New Files**: None (or optionally `docs/how-to/write-rules-for-compound-commands.md`)
- **Interfaces**: None.
- **Details**: In `README.md`, update the quick example to mention that compound bash commands are evaluated per-segment. In `docs/how-to/how-to-handle-mcp-cli-calls.md`, add a note that mcp-cli commands run through `bash` also benefit from per-segment evaluation. Optionally create a new how-to guide `docs/how-to/write-rules-for-compound-commands.md` with examples of whitelist and blacklist rules for compound commands.

## Dependency Graph

- Task 1 → Task 2
- Task 2 → Task 3
- Task 2 → Task 4
- Task 4 → Task 5
- Task 3 || Task 4 (parallel after Task 2)

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| **Breaking semantic change for existing rules** | High | High | Document the change prominently in README and release notes. Existing rules using `command.startsWith()` on compound commands will now evaluate per-segment. This is the intended behavior but may surprise users. Provide migration guidance. |
| **Splitter edge cases (heredocs, command substitution, nested subshells)** | Medium | Medium | The splitter is intentionally simple — it does not attempt full shell parsing. For complex scripts, it may split incorrectly. Document limitations clearly. Mitigate with tests for common patterns. If edge cases prove problematic, future work can adopt `shell-quote` or `bash-parser`. |
| **Performance degradation from N rule evaluations** | Low | Low | With typical rule counts (10–20) and segment counts (1–3), the overhead is negligible. CEL evaluation is fast. If performance becomes an issue, add a fast path for single-segment commands. |
| **Confirm dialog UX for mixed allow/confirm segments** | Medium | Low | If one segment allows and another requires confirmation, the whole command gets one confirm dialog. This is correct but may confuse users. Clear dialog messaging (showing the full command and which rule triggered confirmation) mitigates this. |
| **Test coverage for `index.ts` evaluation loop** | High | High | `index.ts` currently has no unit tests. Task 3 requires either refactoring for testability or building mock infrastructure. Consider extracting the evaluation logic into a pure function to make testing straightforward. |

## Validation Criteria

- [ ] `splitBashCommand("ls -la")` returns `["ls -la"]`
- [ ] `splitBashCommand('echo "a && b"')` returns `['echo "a && b"']` (no split inside quotes)
- [ ] `splitBashCommand("ls && rm")` returns `["ls", "rm"]`
- [ ] `splitBashCommand("tail -n1000 | head -20")` returns `["tail -n1000", "head -20"]`
- [ ] `splitBashCommand("foo || bar")` returns `["foo", "bar"]`
- [ ] `splitBashCommand("echo a; echo b")` returns `["echo a", "echo b"]`
- [ ] `splitBashCommand("foo & bar")` returns `["foo", "bar"]`
- [ ] A block rule for `rm` blocks the whole command `ls && rm -rf /`
- [ ] An allow rule for `tail` and `head` allows the whole command `tail -n1000 | head -20`
- [ ] A whitelist with only `ls` allowed causes `ls && echo hi` to fall through to `default_action`
- [ ] Single command `ls -la` behaves identically to before (backward compatibility for simple commands)
- [ ] All existing tests (`npm test`) pass without modification
- [ ] Documentation accurately describes per-segment evaluation semantics
