import { parse as parseYaml } from "yaml";
import { readFileSync } from "node:fs";
import { type Config } from "./rules.ts";
import {
	resolveAction,
	combineSegmentResults,
	type ResolvedAction,
	type CombinedAction,
} from "./evaluator.ts";
import { buildBaseContext } from "./context.ts";
import { splitBashCommand } from "./splitter.ts";
import type { Scenario, ScenarioResult, ScenarioAction } from "./scenario.ts";

/**
 * Load scenario definitions from a YAML file.
 *
 * The file must contain a top-level `tests:` array where each item is a
 * {@link Scenario}.
 */
export function loadScenariosFromFile(path: string): Scenario[] {
	const text = readFileSync(path, "utf-8");
	const parsed = parseYaml(text) as Record<string, unknown>;

	if (!parsed || typeof parsed !== "object") {
		throw new Error(`Invalid scenario file: ${path}`);
	}

	const tests = parsed.tests;
	if (!Array.isArray(tests)) {
		throw new Error(
			`Scenario file must have a "tests" array: ${path}`,
		);
	}

	return tests as Scenario[];
}

/**
 * Convert a single-segment (`ResolvedAction`) or multi-segment
 * (`CombinedAction`) result into a uniform {@link ScenarioAction}.
 */
function normalizeAction(
	action: ResolvedAction | CombinedAction,
): ScenarioAction {
	if (action.type === "allow") {
		return { type: "allow" };
	}

	// TypeScript can't narrow the union by itself, so we use a local cast.
	const a = action as Record<string, unknown>;

	if (action.type === "block") {
		const ruleNames = Array.isArray(a.ruleNames)
			? (a.ruleNames as string[])
			: typeof a.ruleName === "string"
				? [a.ruleName]
				: [];
		return {
			type: "block",
			reason: String(a.reason ?? ""),
			ruleNames,
		};
	}

	// confirm
	const ruleNames = Array.isArray(a.ruleNames)
		? (a.ruleNames as string[])
		: typeof a.ruleName === "string"
			? [a.ruleName]
			: [];
	const messages = Array.isArray(a.messages)
		? (a.messages as string[])
		: typeof a.message === "string"
			? [a.message]
			: ["This operation requires approval."];
	return { type: "confirm", ruleNames, messages };
}

/**
 * Run a single scenario against a loaded permission config.
 *
 * Replicates the extension's evaluation behaviour exactly, including
 * per-segment bash command splitting and result combination.
 */
export function runScenario(
	config: Config,
	scenario: Scenario,
): ScenarioResult {
	// ─── Build CEL context ─────────────────────────────────────────────────
	let context: Record<string, unknown>;
	if (scenario.context) {
		context = { ...scenario.context };
	} else if (scenario.tool) {
		context = buildBaseContext(
			scenario.tool,
			scenario.args ?? {},
			scenario.cwd ?? "/tmp",
		);
	} else {
		return {
			passed: false,
			scenario,
			actual: { type: "block", reason: "", ruleNames: [] },
			message:
				"Scenario must specify either 'tool' or 'context'",
		};
	}

	const hasUI = scenario.has_ui ?? true;
	let rawResult: ResolvedAction | CombinedAction;

	// ─── Bash segment handling (mirrors extension logic) ───────────────────
	if (scenario.tool === "bash" && typeof context.command === "string") {
		const segments = splitBashCommand(context.command);
		if (segments.length > 1) {
			const results = segments.map((segment) => {
				const segContext = { ...context, command: segment };
				return resolveAction(config, segContext, hasUI);
			});
			rawResult = combineSegmentResults(results);
		} else {
			rawResult = resolveAction(config, context, hasUI);
		}
	} else {
		rawResult = resolveAction(config, context, hasUI);
	}

	const actual = normalizeAction(rawResult);

	// ─── Assert expected action type ───────────────────────────────────────
	if (actual.type !== scenario.expected) {
		return {
			passed: false,
			scenario,
			actual,
			message: `Expected ${scenario.expected} but got ${actual.type}`,
		};
	}

	// ─── Assert expected_message_contains ──────────────────────────────────
	if (scenario.expected_message_contains) {
		let found = false;
		if (actual.type === "block") {
			found = actual.reason.includes(scenario.expected_message_contains);
		} else if (actual.type === "confirm") {
			found = actual.messages.some((m) =>
				m.includes(scenario.expected_message_contains),
			);
		}
		if (!found) {
			let got = "";
			if (actual.type === "block") {
				got = actual.reason;
			} else if (actual.type === "confirm") {
				got = actual.messages.join("; ");
			}
			return {
				passed: false,
				scenario,
				actual,
				message: `Expected message to contain "${scenario.expected_message_contains}" but got "${got}"`,
			};
		}
	}

	// ─── Assert expected_rule ──────────────────────────────────────────────
	if (scenario.expected_rule) {
		const ruleNames =
			actual.type === "block" || actual.type === "confirm"
				? actual.ruleNames
				: [];
		if (!ruleNames.includes(scenario.expected_rule)) {
			return {
				passed: false,
				scenario,
				actual,
				message: `Expected rule "${scenario.expected_rule}" but matching rules were [${ruleNames.join(", ")}]`,
			};
		}
	}

	return { passed: true, scenario, actual };
}

/**
 * Run a list of scenarios and return detailed results for each.
 */
export function runScenarios(
	config: Config,
	scenarios: Scenario[],
): ScenarioResult[] {
	return scenarios.map((s) => runScenario(config, s));
}
