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
	rules: Rule[];
	hidden_tools: string[];
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
		const name = String(raw.name ?? "");
		const condition = String(raw.condition ?? "");
		const message = raw.message ? String(raw.message) : undefined;
		const action = raw.action ? (String(raw.action) as Action) : undefined;
		const nested = Array.isArray(raw.rules) ? raw.rules : undefined;

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
