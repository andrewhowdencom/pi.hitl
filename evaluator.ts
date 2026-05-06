import { run, isCelError, celFunc, CelScalar } from "@bufbuild/cel";
import { type Rule, type Config } from "./rules.ts";

/** Custom CEL function: regex matching. Usage: `command.matches("rm\\s+-rf")` */
const matchesFunc = celFunc(
	"matches",
	[CelScalar.STRING, CelScalar.STRING],
	CelScalar.BOOL,
	(str: string, pattern: string) => new RegExp(pattern).test(str),
);

export const CEL_OPTIONS = { funcs: [matchesFunc] };

export function evaluateRule(rule: Rule, context: Record<string, unknown>): boolean {
	try {
		const result = run(rule.condition, context as Parameters<typeof run>[1], CEL_OPTIONS);
		if (isCelError(result)) {
			console.error(`[permissions] CEL error in rule "${rule.name}":`, result);
			return false;
		}
		return result === true;
	} catch (e) {
		console.error(`[permissions] Error evaluating rule "${rule.name}":`, e);
		return false;
	}
}

export type ResolvedAction =
	| { type: "allow" }
	| { type: "block"; reason: string }
	| { type: "confirm"; ruleName: string; message?: string };

export function resolveAction(
	config: Config,
	context: Record<string, unknown>,
	hasUI: boolean,
): ResolvedAction {
	for (const rule of config.rules) {
		if (evaluateRule(rule, context)) {
			switch (rule.action) {
				case "allow":
					return { type: "allow" };

				case "block":
					return {
						type: "block",
						reason: rule.message ?? `Blocked by rule: ${rule.name}`,
					};

				case "confirm": {
					if (!hasUI) {
						return {
							type: "block",
							reason:
								rule.message ??
								`Confirmation required for rule "${rule.name}" (no UI available)`,
						};
					}
					return { type: "confirm", ruleName: rule.name, message: rule.message };
				}
			}
		}
	}

	// No rule matched — apply default action
	switch (config.default_action) {
		case "allow":
			return { type: "allow" };
		case "block":
			return { type: "block", reason: "Blocked by default — no matching permission rule" };
		case "confirm": {
			if (!hasUI) {
				return {
					type: "block",
					reason: "Confirmation required by default (no UI available)",
				};
			}
			return { type: "confirm", ruleName: "default", message: undefined };
		}
		default: {
			return { type: "block", reason: "Blocked by default — no matching permission rule" };
		}
	}
}

export type CombinedAction =
	| { type: "allow" }
	| { type: "block"; reason: string }
	| { type: "confirm"; ruleNames: string[]; messages: string[] };

export function combineSegmentResults(results: ResolvedAction[]): CombinedAction {
	const blocking = results.filter((r) => r.type === "block");
	if (blocking.length > 0) {
		return { type: "block", reason: blocking.map((r) => r.reason).join("; ") };
	}

	const confirming = results.filter((r) => r.type === "confirm");
	if (confirming.length > 0) {
		return {
			type: "confirm",
			ruleNames: confirming.map((r) => r.ruleName),
			messages: confirming.map((r) => r.message ?? "This operation requires approval."),
		};
	}

	return { type: "allow" };
}
