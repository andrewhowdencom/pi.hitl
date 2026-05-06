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
import { resolveAction, combineSegmentResults } from "./evaluator.ts";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { type Config } from "./rules.ts";
import { loadConfigFromFiles } from "./config.ts";
import {
	createContextBuilderRegistry,
	createToolMetadataCache,
	buildBaseContext,
	type ContextBuilderRegistration,
} from "./context.ts";
import { splitBashCommand } from "./splitter.ts";

interface PermissionsState {
	enabled: boolean;
}

// ─── Config loading ─────────────────────────────────────────────────────────



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
		const agentsPath = resolve(homedir(), ".agents", "permissions.yaml");
		const globalPath = resolve(getAgentDir(), "permissions.yaml");
		const projectPath = resolve(cwd, ".pi", "permissions.yaml");
		config = loadConfigFromFiles([agentsPath, globalPath, projectPath]);
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
		// For bash commands, evaluate each segment independently
		if (event.toolName === "bash") {
			const command = String(context.command ?? "");
			const segments = splitBashCommand(command);

			if (segments.length > 1) {
				const results = segments.map((segment) => {
					const segContext = { ...context, command: segment };
					return resolveAction(config, segContext, ctx.hasUI);
				});

				// Combine: block > confirm > allow
				const combined = combineSegmentResults(results);
				switch (combined.type) {
					case "block":
						return {
							block: true,
							reason: combined.reason,
						};

					case "confirm": {
						const ruleNames = combined.ruleNames.join(", ");
						const ok = await ctx.ui.confirm(
							`🔒 Permission Rule: ${ruleNames}`,
							`${combined.messages.join("\n")}\n\nTool: ${event.toolName}\n\nArgs:\n${JSON.stringify(event.input, null, 2)}\n\nAllow this tool call to execute?`,
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
							return { block: true, reason: `Blocked by user (rule: ${ruleNames})${guidance}` };
						}
						return undefined;
					}

					case "allow":
						return undefined;
				}
			}
		}

		const result = resolveAction(config, context, ctx.hasUI);
		switch (result.type) {
			case "allow":
				return undefined;

			case "block":
				return {
					block: true,
					reason: result.reason,
				};

			case "confirm": {
				const ok = await ctx.ui.confirm(
					`🔒 Permission Rule: ${result.ruleName}`,
					`${result.message ?? "This operation requires approval."}\n\nTool: ${event.toolName}\n\nArgs:\n${JSON.stringify(event.input, null, 2)}\n\nAllow this tool call to execute?`,
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
					return { block: true, reason: `Blocked by user (rule: ${result.ruleName})${guidance}` };
				}
				return undefined;
			}
		}

		return undefined;
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
