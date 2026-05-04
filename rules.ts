import { parse as parseCel } from "@bufbuild/cel";

export type Action = "allow" | "block" | "confirm";

export interface Rule {
	name: string;
	condition: string;
	action: Action;
	message?: string;
}

export interface Config {
	version: number;
	default_action: Action;
	timeout: number;
	rules: Rule[];
	hidden_tools: string[];
}

/**
 * Parse and validate a timeout value from raw YAML input.
 *
 * Returns the parsed number and an optional warning message when the input
 * is invalid (non-numeric, negative, or non-finite). Defaults to 10000 ms.
 */
export function parseTimeout(raw: unknown): { value: number; warning?: string } {
	const timeout = Number(raw ?? 10000);
	if (isNaN(timeout) || timeout < 0 || !isFinite(timeout)) {
		return { value: 10000, warning: `Invalid timeout "${raw}", using 10000` };
	}
	return { value: timeout };
}

/**
 * Recursively flatten nested rules into a single ordered list.
 *
 * Parent conditions are AND-ed with child conditions:
 *   parent: `tool == "bash"`
 *   child:  `command.contains("rm")`
 *   flat:   `(tool == "bash") && (command.contains("rm"))`
 *
 * Parent names are prefixed onto child names for debugging:
 *   parent: "Bash"
 *   child:  "rm"
 *   flat:   "Bash > rm"
 *
 * Leaf rules may be written with a `default: <action>` shorthand, which
 * expands to `name: "Default"`, `condition: "true"`, `action: <action>`.
 * Explicit `name`, `condition`, or `action` override the inferred values.
 */
export function flattenRules(
	rawRules: unknown[],
	parentCondition?: string,
	parentName?: string,
): Rule[] {
	const rules: Rule[] = [];

	for (const entry of rawRules) {
		if (!entry || typeof entry !== "object") continue;

		const raw = entry as Record<string, unknown>;
		let name = String(raw.name ?? "");
		let condition = String(raw.condition ?? "");
		const message = raw.message ? String(raw.message) : undefined;
		let action = raw.action ? (String(raw.action) as Action) : undefined;
		const nested = Array.isArray(raw.rules) ? raw.rules : undefined;

		// Handle default shorthand
		if (raw.default !== undefined) {
			if (nested) {
				console.error(
					`[permissions] Warning: Rule "${name || "unnamed"}" has both "default" and nested rules; ignoring "default"`,
				);
			} else {
				const defaultValue = String(raw.default);
				if (!["allow", "block", "confirm"].includes(defaultValue)) {
					console.error(
						`[permissions] Warning: Invalid default action "${defaultValue}":`,
						entry,
					);
					continue;
				}

				if (raw.action !== undefined) {
					console.error(
						`[permissions] Warning: Rule has both "default" and explicit "action"; using explicit "action"`,
					);
				}
				if (raw.condition !== undefined) {
					console.error(
						`[permissions] Warning: Rule has both "default" and explicit "condition"; using explicit "condition"`,
					);
				}

				action = (action as Action) || (defaultValue as Action);
				condition = condition || "true";
				name = name || "Default";
			}
		}

		if (!name || !condition) {
			console.error(
				`[permissions] Warning: Invalid rule (missing name or condition):`,
				entry,
			);
			continue;
		}

		const fullName = parentName ? `${parentName} > ${name}` : name;
		const fullCondition = parentCondition
			? `(${parentCondition}) && (${condition})`
			: condition;

		if (nested) {
			// Parent rule with children — action is ignored
			if (action) {
				console.error(
					`[permissions] Warning: Rule "${name}" has both action and nested rules; ignoring action`,
				);
			}
			rules.push(...flattenRules(nested, fullCondition, fullName));
		} else if (action) {
			// Leaf rule
			if (!["allow", "block", "confirm"].includes(action)) {
				console.error(
					`[permissions] Warning: Invalid action "${action}" in rule "${fullName}"`,
				);
				continue;
			}

			// Validate CEL syntax eagerly so broken rules fail at load time
			try {
				parseCel(fullCondition);
			} catch (e) {
				console.error(
					`[permissions] Warning: Invalid CEL expression in rule "${fullName}":`,
					e,
				);
				continue;
			}

			rules.push({
				name: fullName,
				condition: fullCondition,
				action,
				message,
			});
		} else {
			console.error(
				`[permissions] Warning: Rule "${name}" has neither action nor nested rules:`,
				entry,
			);
			continue;
		}
	}

	return rules;
}

/**
 * Reorder children so that catch-all rules (those with a `default` key or a
 * `condition` of `"true"`) appear at the end, preserving relative order among
 * specific rules and among catch-all rules.
 */
function reorderChildren(children: unknown[]): unknown[] {
	const specific: unknown[] = [];
	const defaults: unknown[] = [];

	for (const child of children) {
		if (!child || typeof child !== "object") {
			specific.push(child);
			continue;
		}
		const raw = child as Record<string, unknown>;
		// Only leaf rules can be catch-alls
		if (Array.isArray(raw.rules)) {
			specific.push(child);
			continue;
		}
		if (raw.default !== undefined || String(raw.condition ?? "") === "true") {
			defaults.push(child);
		} else {
			specific.push(child);
		}
	}

	return [...specific, ...defaults];
}

/**
 * Recursively merge two rule arrays. Parent rules with matching `name` and
 * `condition` have their children merged. Within merged parents, catch-all
 * children (those with a `default` key or `condition === "true"`) are
 * reordered to the end so specific rules are evaluated first.
 */
export function mergeRules(base: unknown[], override: unknown[]): unknown[] {
	const result: unknown[] = [...base];

	for (const entry of override) {
		if (!entry || typeof entry !== "object") {
			console.error(
				`[permissions] Warning: Invalid rule (not an object):`,
				entry,
			);
			continue;
		}

		const raw = entry as Record<string, unknown>;
		const name = String(raw.name ?? "");
		const condition = String(raw.condition ?? "");
		const nested = Array.isArray(raw.rules) ? raw.rules : undefined;

		if (!name || !condition) {
			console.error(
				`[permissions] Warning: Invalid rule (missing name or condition):`,
				entry,
			);
			continue;
		}

		if (nested) {
			// Parent rule — try to merge with existing parent
			const matchIndex = result.findIndex((r) => {
				if (!r || typeof r !== "object") return false;
				const existing = r as Record<string, unknown>;
				return (
					String(existing.name ?? "") === name &&
					String(existing.condition ?? "") === condition &&
					Array.isArray(existing.rules)
				);
			});

			if (matchIndex !== -1) {
				const existing = result[matchIndex] as Record<string, unknown>;
				const existingChildren = Array.isArray(existing.rules)
					? existing.rules
					: [];
				const mergedChildren = reorderChildren(
					mergeRules(existingChildren, nested),
				);
				existing.rules = mergedChildren;
				continue;
			}
		}

		// No merge match or leaf rule — append
		result.push(entry);
	}

	return result;
}
