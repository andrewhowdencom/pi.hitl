import type { ResolvedAction, CombinedAction } from "./evaluator.ts";

/**
 * Normalized action result used in scenario output.
 *
 * Converts both single-segment (`ResolvedAction`) and multi-segment
 * (`CombinedAction`) results into a uniform shape so assertions can be written
 * without caring how many bash segments were involved.
 */
export type ScenarioAction =
	| { type: "allow" }
	| { type: "block"; reason: string; ruleNames: string[] }
	| { type: "confirm"; ruleNames: string[]; messages: string[] };

/**
 * A single test scenario for permission rule evaluation.
 *
 * Either `context` (low-level CEL variables) or `tool` + `args` + `cwd`
 * (high-level tool call) must be provided. When `tool` is given, the runner
 * constructs the CEL context using `buildBaseContext`, matching the
 * extension's behavior exactly.
 */
export interface Scenario {
	/** Human-readable test name shown in output. */
	name: string;

	/** Optional longer description. */
	description?: string;

	/** Tool name (e.g. "read", "write", "bash"). */
	tool?: string;

	/** Tool arguments object. */
	args?: Record<string, unknown>;

	/** Current working directory for context resolution. */
	cwd?: string;

	/**
	 * Explicit CEL evaluation context. Overrides `tool`/`args`/`cwd` when
	 * both are present. Use this to simulate variables added by other
	 * extensions (e.g. `tool_source`, `tool_scope`).
	 */
	context?: Record<string, unknown>;

	/** Whether the UI is available (affects confirm → block fallback). */
	has_ui?: boolean;

	/** Expected outcome: allow, block, or confirm. */
	expected: "allow" | "block" | "confirm";

	/**
	 * For block / confirm results, assert that the reason / message
	 * string contains this substring.
	 */
	expected_message_contains?: string;

	/**
	 * For block / confirm results, assert that the matched rule has
	 * this exact name.
	 */
	expected_rule?: string;
}

/** Result of executing a single scenario. */
export interface ScenarioResult {
	/** True when all assertions pass. */
	passed: boolean;

	/** The scenario that was run. */
	scenario: Scenario;

	/** Normalized action produced by the permission engine. */
	actual: ScenarioAction;

	/** Human-readable failure message when `passed` is false. */
	message?: string;
}
