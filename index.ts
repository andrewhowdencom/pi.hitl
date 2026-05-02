/**
 * pi.hitl — CEL-based Permission System
 *
 * Rule-based tool approval using CEL (Common Expression Language) and YAML
 * configuration. Allows autonomous tool execution within a defined sandbox
 * while requiring approval (or blocking) for operations outside it.
 *
 * Configuration files (merged, project takes precedence):
 *   ~/.agents/permissions.yaml       (agent-wide defaults)
 *   ~/.pi/agent/permissions.yaml    (global)
 *   .pi/permissions.yaml            (project-local)
 *
 * Each rule has a CEL `condition`, an `action` (allow / block / confirm),
 * and an optional `message` shown when blocking.
 *
 * Built-in CEL variables:
 *   tool      — tool name (string)
 *   args      — tool arguments map
 *   cwd       — current working directory (absolute path)
 *   command   — bash command string (bash tool only)
 *   path      — resolved absolute path for file-based tools; "" for bash
 *   tool_source — tool origin (builtin, sdk, extension path, or unknown)
 *   tool_scope  — tool scope (user, project, temporary, or unknown)
 *
 * Built-in CEL functions:
 *   path.startsWith(prefix)  — string prefix check
 *   path.contains(substr)    — substring check
 *   str.matches(pattern)     — regex match (custom function)
 *
 * Commands:
 *   /permissions             — Show current rules
 *   /permissions reload      — Reload config from disk
 *   /permissions on          — Enable permission checks
 *   /permissions off         — Disable permission checks (allow all)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { run, isCelError, celFunc, CelScalar, parse as parseCel } from "@bufbuild/cel";
import { parse as parseYaml } from "yaml";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { type Action, type Rule, type Config, flattenRules, mergeRules } from "./rules.ts";
import {
	createContextBuilderRegistry,
	createToolMetadataCache,
	buildBaseContext,
	type ContextBuilderRegistration,
} from "./context.ts";

interface PermissionsState {
	enabled: boolean;
}

// ─── CEL setup ──────────────────────────────────────────────────────────────

/** Custom CEL function: regex matching. Usage: `command.matches("rm\\s+-rf")` */
const matchesFunc = celFunc(
	"matches",
	[CelScalar.STRING, CelScalar.STRING],
	CelScalar.BOOL,
	(str: string, pattern: string) => new RegExp(pattern).test(str),
);

const CEL_OPTIONS = { funcs: [matchesFunc] };

// ─── Config loading ─────────────────────────────────────────────────────────

function loadConfig(cwd: string): Config | undefined {
	const agentsPath = resolve(homedir(), ".agents", "permissions.yaml");
	const globalPath = resolve(getAgentDir(), "permissions.yaml");
	const projectPath = resolve(cwd, ".pi", "permissions.yaml");

	let raw: Record<string, unknown> = {};

	// Load agent-wide defaults
	if (existsSync(agentsPath)) {
		try {
			const text = readFileSync(agentsPath, "utf-8");
			const parsed = parseYaml(text) as Record<string, unknown>;
			if (parsed && typeof parsed === "object") {
				raw = { ...parsed };
			}
		} catch (e) {
			console.error(`[permissions] Warning: Could not parse ${agentsPath}:`, e);
		}
	}

	// Load global config (merged with agent-wide defaults)
	if (existsSync(globalPath)) {
		try {
			const text = readFileSync(globalPath, "utf-8");
			const parsed = parseYaml(text) as Record<string, unknown>;
			if (parsed && typeof parsed === "object") {
				raw = {
					...raw,
					...parsed,
					rules: mergeRules(
						Array.isArray(raw.rules) ? raw.rules : [],
						Array.isArray(parsed.rules) ? parsed.rules : [],
					),
					hidden_tools: [
						...(Array.isArray(raw.hidden_tools) ? raw.hidden_tools : []),
						...(Array.isArray(parsed.hidden_tools) ? parsed.hidden_tools : []),
					],
				};
			}
		} catch (e) {
			console.error(`[permissions] Warning: Could not parse ${globalPath}:`, e);
		}
	}

	// Load and merge project config (project overrides global)
	if (existsSync(projectPath)) {
		try {
			const text = readFileSync(projectPath, "utf-8");
			const parsed = parseYaml(text) as Record<string, unknown>;
			if (parsed && typeof parsed === "object") {
				raw = {
					...raw,
					...parsed,
					rules: mergeRules(
						Array.isArray(raw.rules) ? raw.rules : [],
						Array.isArray(parsed.rules) ? parsed.rules : [],
					),
					hidden_tools: [
						...(Array.isArray(raw.hidden_tools) ? raw.hidden_tools : []),
						...(Array.isArray(parsed.hidden_tools) ? parsed.hidden_tools : []),
					],
				};
			}
		} catch (e) {
			console.error(`[permissions] Warning: Could not parse ${projectPath}:`, e);
		}
	}

	const rawRules = Array.isArray(raw.rules) ? raw.rules : [];
	if (rawRules.length === 0 && !Array.isArray(raw.hidden_tools)) {
		return undefined; // No config found — extension is inactive
	}

	// Validate and flatten nested rules into a single ordered list
	const rules = flattenRules(rawRules);

	const hidden_tools = Array.isArray(raw.hidden_tools)
		? [...new Set(raw.hidden_tools.map(String))]
		: [];

	let default_action = (raw.default_action as Action) ?? "block";
	if (!["allow", "block", "confirm"].includes(default_action)) {
		console.error(`[permissions] Warning: Invalid default_action "${default_action}", using "block"`);
		default_action = "block";
	}

	return {
		version: Number(raw.version ?? 1),
		default_action,
		rules,
		hidden_tools,
	};
}



// ─── Rule evaluation ──────────────────────────────────────────────────────

function evaluateRule(rule: Rule, context: Record<string, unknown>): boolean {
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

// ─── Extension ──────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let config: Config | undefined;
	let enabled = true;
	let deniedThisTurn = false;

	const contextBuilders = createContextBuilderRegistry();
	const toolMetaCache = createToolMetadataCache();

	// Listen for context builder registrations from other extensions
	pi.events.on("hitl:register_context", (reg: unknown) => {
		const { name, builder } = reg as ContextBuilderRegistration;
		contextBuilders.register(name, builder);
	});

	function reloadConfig(cwd: string) {
		config = loadConfig(cwd);
	}

	// Restore persisted state on session start / reload / resume / fork
	pi.on("session_start", async (_event, ctx) => {
		deniedThisTurn = false;
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === "permissions-state") {
				const state = entry.data as PermissionsState | undefined;
				if (state) enabled = state.enabled;
			}
		}
		reloadConfig(ctx.cwd);
		try {
			toolMetaCache.refresh(pi.getAllTools());
		} catch {
			// pi.getAllTools() may not be available in all pi versions; skip silently
		}
		pi.events.emit("hitl:announce", {});
		if (config) {
			ctx.ui.notify(
				`Permissions: ${config.rules.length} rule(s), ${config.hidden_tools.length} hidden tool(s)`,
				"info",
			);
		}
	});

	// Reset per-turn denial tracking
	pi.on("turn_start", async () => {
		deniedThisTurn = false;
	});

	// Inject sandbox boundary note into system prompt so the LLM knows its constraints
	pi.on("before_agent_start", async (event, ctx) => {
		if (!config || !enabled) return;

		const lines = ["## Permission Sandbox"];

		if (config.rules.some((r) => r.condition.includes("path.startsWith(cwd)"))) {
			lines.push(`- File operations are restricted to: ${ctx.cwd}`);
		}
		if (config.rules.some((r) => r.condition.includes('tool == "bash"'))) {
			lines.push("- Shell commands require manual approval.");
		}
		if (config.rules.some((r) => r.condition.includes("tool_source"))) {
			lines.push("- Tool availability is restricted by origin.");
		}
		if (config.rules.some((r) => r.condition.includes("tool_scope"))) {
			lines.push("- Tool availability is restricted by scope.");
		}
		if (config.hidden_tools.length > 0) {
			lines.push(`- Hidden tools: ${config.hidden_tools.join(", ")}`);
		}

		if (lines.length === 1) return; // No relevant restrictions to note

		return {
			systemPrompt: event.systemPrompt + "\n\n" + lines.join("\n"),
		};
	});

	// Main gate: intercept every tool call
	pi.on("tool_call", async (event, ctx) => {
		if (!config || !enabled) return undefined;

		// Hidden tools are silently blocked
		if (config.hidden_tools.includes(event.toolName)) {
			return {
				block: true,
				reason: `Tool "${event.toolName}" is hidden by permissions configuration`,
			};
		}

		// Non-interactive modes: block confirm actions since no UI is available
		if (!ctx.hasUI && config.rules.some((r) => r.action === "confirm")) {
			// We'll still evaluate rules; if an allow rule matches, we permit it.
			// Only confirm rules become block in non-interactive mode.
		}

		const baseContext = buildBaseContext(event.toolName, event.input, ctx.cwd);
		const meta = toolMetaCache.get(event.toolName);
		if (meta) {
			baseContext.tool_source = meta.source;
			baseContext.tool_scope = meta.scope;
		}
		const context = await contextBuilders.build(
			event.toolName,
			event.input,
			ctx.cwd,
			ctx,
			baseContext,
		);

		// If user already denied a tool this turn, keep blocking subsequent tools
		// so they don't get spammed with approval dialogs after saying no once.
		if (deniedThisTurn) {
			return {
				block: true,
				reason: "Blocked by permissions extension — a previous tool in this turn was denied",
			};
		}

		// Evaluate rules in order; first match wins
		for (const rule of config.rules) {
			if (evaluateRule(rule, context)) {
				switch (rule.action) {
					case "allow":
						return undefined;

					case "block":
						return {
							block: true,
							reason: rule.message ?? `Blocked by rule: ${rule.name}`,
						};

					case "confirm": {
						if (!ctx.hasUI) {
							return {
								block: true,
								reason:
									rule.message ??
									`Confirmation required for rule "${rule.name}" (no UI available)`,
							};
						}
						const ok = await ctx.ui.confirm(
							`🔒 Permission Rule: ${rule.name}`,
							`${rule.message ?? "This operation requires approval."}\n\nTool: ${event.toolName}\n\nArgs:\n${JSON.stringify(event.input, null, 2)}\n\nAllow this tool call to execute?`,
						);
						if (!ok) {
							deniedThisTurn = true;
							let guidance = "";
							const input = await ctx.ui.editor(
								"Permission denied — how should I adjust to get approval?",
								"",
							);
							if (input?.trim()) {
								guidance = `\n\nUser guidance: ${input.trim()}`;
							}
							return { block: true, reason: `Blocked by user (rule: ${rule.name})${guidance}` };
						}
						return undefined;
					}
				}
			}
		}

		// No rule matched — apply default action
		if (config.default_action === "block") {
			return {
				block: true,
				reason: "Blocked by default — no matching permission rule",
			};
		}
		if (config.default_action === "confirm") {
			if (!ctx.hasUI) {
				return {
					block: true,
					reason: "Confirmation required by default (no UI available)",
				};
			}
			const ok = await ctx.ui.confirm(
				`🔒 Permission Check`,
				`No rule matched for tool "${event.toolName}".\n\nArgs:\n${JSON.stringify(event.input, null, 2)}\n\nAllow?`,
			);
			if (!ok) {
				deniedThisTurn = true;
				let guidance = "";
				const input = await ctx.ui.editor(
					"Permission denied — how should I adjust to get approval?",
					"",
				);
				if (input?.trim()) {
					guidance = `\n\nUser guidance: ${input.trim()}`;
				}
				return { block: true, reason: `Blocked by user (default action)${guidance}` };
			}
			return undefined;
		}

		return undefined; // default_action === "allow"
	});

	// ─── Commands ─────────────────────────────────────────────────────────────

	pi.registerCommand("permissions", {
		description: "Show, reload, or toggle permission rules",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();

			if (arg === "off" || arg === "disable" || arg === "false") {
				enabled = false;
				pi.appendEntry("permissions-state", { enabled: false });
				ctx.ui.notify("Permissions disabled — all tool calls allowed", "warning");
				return;
			}

			if (arg === "on" || arg === "enable" || arg === "true") {
				enabled = true;
				pi.appendEntry("permissions-state", { enabled: true });
				ctx.ui.notify("Permissions enabled — rules are active", "info");
				return;
			}

			if (arg === "reload") {
				reloadConfig(ctx.cwd);
				const msg = config
					? `Permissions reloaded: ${config.rules.length} rule(s), ${config.hidden_tools.length} hidden tool(s)`
					: "Permissions reloaded: no config found";
				ctx.ui.notify(msg, config ? "info" : "warning");
				return;
			}

			if (arg === "status" || arg === "") {
				if (!config) {
					ctx.ui.notify("No permissions config loaded", "warning");
					return;
				}

				const lines = [
					`Permissions Config (${config.rules.length} rules, ${config.hidden_tools.length} hidden tools):`,
					`Status: ${enabled ? "enabled" : "disabled"}`,
					`Default action: ${config.default_action}`,
					"",
					"Rules:",
					...config.rules.map((r, i) => `  ${i + 1}. [${r.action}] ${r.name}: ${r.condition}`),
				];
				if (config.hidden_tools.length > 0) {
					lines.push("", `Hidden tools: ${config.hidden_tools.join(", ")}`);
				}
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			ctx.ui.notify(`Unknown argument: "${args}". Use reload, on, off, or status.`, "warning");
		},
	});
}
