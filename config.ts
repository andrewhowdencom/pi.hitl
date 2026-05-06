import { parse as parseYaml } from "yaml";
import { existsSync, readFileSync } from "node:fs";
import { type Action, type Config, flattenRules, mergeRules } from "./rules.ts";
import { parse as parseCel } from "@bufbuild/cel";

export interface ValidationResult {
	errors: string[];
	warnings: string[];
}

/**
 * Load, merge, and flatten permission configs from an ordered list of file paths.
 *
 * Files are loaded in the given order; later files override earlier ones.
 * `rules` and `hidden_tools` are merged (concatenated); all other keys are
 * overwritten by the latest file that defines them.
 *
 * Returns `undefined` if no files exist or if no config content is found.
 */
export function loadConfigFromFiles(
	paths: string[],
	onLog?: (...args: unknown[]) => void,
): Config | undefined {
	const log = onLog ?? console.error;
	let raw: Record<string, unknown> = {};
	let foundAny = false;

	for (const path of paths) {
		if (!existsSync(path)) continue;
		foundAny = true;

		try {
			const text = readFileSync(path, "utf-8");
			const parsed = parseYaml(text) as Record<string, unknown>;
			if (parsed && typeof parsed === "object") {
				raw = {
					...raw,
					...parsed,
					rules: mergeRules(
						Array.isArray(raw.rules) ? raw.rules : [],
						Array.isArray(parsed.rules) ? parsed.rules : [],
						onLog,
					),
					hidden_tools: [
						...(Array.isArray(raw.hidden_tools)
							? raw.hidden_tools
							: []),
						...(Array.isArray(parsed.hidden_tools)
							? parsed.hidden_tools
							: []),
					],
				};
			}
		} catch (e) {
			log(
				`[permissions] Warning: Could not parse ${path}:`,
				e,
			);
		}
	}

	const rawRules = Array.isArray(raw.rules) ? raw.rules : [];
	if (rawRules.length === 0 && !Array.isArray(raw.hidden_tools)) {
		return undefined;
	}

	const rules = flattenRules(rawRules, undefined, undefined, onLog);

	const hidden_tools = Array.isArray(raw.hidden_tools)
		? [...new Set(raw.hidden_tools.map(String))]
		: [];

	let default_action = (raw.default_action as Action) ?? "block";
	if (!["allow", "block", "confirm"].includes(default_action)) {
		log(
			`[permissions] Warning: Invalid default_action "${default_action}", using "block"`,
		);
		default_action = "block";
	}

	return {
		version: Number(raw.version ?? 1),
		default_action,
		rules,
		hidden_tools,
	};
}

/**
 * Validate a loaded Config for structural correctness, CEL syntax, and
 * semantic issues.
 *
 * Errors represent problems that will cause the config to behave
 * unexpectedly or fail at runtime. Warnings highlight likely mistakes that
 * may still load successfully.
 */
export function validateConfig(config: Config): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (config.version !== 1) {
		errors.push(
			`Unsupported version: ${config.version} (must be 1)`,
		);
	}

	if (!["allow", "block", "confirm"].includes(config.default_action)) {
		errors.push(
			`Invalid default_action: "${config.default_action}" (must be allow, block, or confirm)`,
		);
	}

	const seenNames = new Set<string>();

	for (let i = 0; i < config.rules.length; i++) {
		const rule = config.rules[i];

		try {
			parseCel(rule.condition);
		} catch (e) {
			errors.push(
				`Rule "${rule.name}" (index ${i}): Invalid CEL expression: "${rule.condition}"`,
			);
		}

		if (!["allow", "block", "confirm"].includes(rule.action)) {
			errors.push(
				`Rule "${rule.name}" (index ${i}): Invalid action: "${rule.action}"`,
			);
		}

		if (seenNames.has(rule.name)) {
			warnings.push(
				`Duplicate rule name: "${rule.name}" (index ${i})`,
			);
		}
		seenNames.add(rule.name);

		if (rule.condition === "true" && i < config.rules.length - 1) {
			warnings.push(
				`Catch-all rule "${rule.name}" (index ${i}) is not the last rule — specific rules after it will never match`,
			);
		}
	}

	for (const tool of config.hidden_tools) {
		for (const rule of config.rules) {
			if (
				rule.condition.includes(`tool == "${tool}"`) ||
				rule.condition.includes(`tool.startsWith("${tool}")`)
			) {
				warnings.push(
					`Hidden tool "${tool}" may shadow rule "${rule.name}" — the rule may never match because the tool is hidden`,
				);
			}
		}
	}

	return { errors, warnings };
}
