/**
 * pi.hitl — Human-in-the-Loop Tool Approval
 *
 * Ensures every tool call requires explicit user approval before execution.
 * In non-interactive modes (print, JSON, RPC), all tool calls are blocked
 * by default since no UI is available for confirmation.
 *
 * Commands:
 *   /hitl              — Toggle tool approval on/off
 *   /hitl on           — Enable approval gate
 *   /hitl off          — Disable approval gate
 *   /hitl status       — Show current state
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

interface HitlState {
	enabled: boolean;
}

export default function (pi: ExtensionAPI) {
	let enabled = true;
	let deniedThisTurn = false;

	// Restore state from session on startup / resume / reload / fork
	pi.on("session_start", async (_event, ctx) => {
		deniedThisTurn = false;
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === "hitl-state") {
				enabled = (entry.data as HitlState | undefined)?.enabled ?? true;
			}
		}
	});

	// Reset per-turn state
	pi.on("turn_start", async () => {
		deniedThisTurn = false;
	});

	// Toggle command
	pi.registerCommand("hitl", {
		description: "Toggle Human-in-the-Loop tool approval (on/off/status)",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();

			if (arg === "off" || arg === "disable" || arg === "false") {
				enabled = false;
			} else if (arg === "on" || arg === "enable" || arg === "true") {
				enabled = true;
			} else if (arg === "status") {
				// nothing to flip
			} else if (arg.length > 0) {
				ctx.ui.notify(`Unknown argument: "${args}". Use on, off, or status.`, "warning");
				return;
			} else {
				enabled = !enabled;
			}

			// Persist state in session
			pi.appendEntry("hitl-state", { enabled });

			const status = enabled
				? "🔒 enabled — all tool calls require approval"
				: "🔓 disabled — tool calls execute without approval";
			ctx.ui.notify(`HITL ${status}`, enabled ? "info" : "warning");
		},
	});

	// Main gate: intercept every tool call
	pi.on("tool_call", async (event, ctx) => {
		if (!enabled) return undefined;

		// Non-interactive modes: block by default (no UI to confirm)
		if (!ctx.hasUI) {
			return {
				block: true,
				reason:
					"HITL: Tool calls require manual approval. Run pi in interactive mode or disable HITL with /hitl off",
			};
		}

		const toolName = event.toolName;
		const description = formatToolCall(toolName, event.input);

		// If user already denied a tool this turn, keep blocking subsequent tools
		// so they don't get spammed with approval dialogs after saying no once.
		if (deniedThisTurn) {
			return {
				block: true,
				reason: "Blocked by HITL extension — a previous tool in this turn was denied",
			};
		}

		const ok = await ctx.ui.confirm(
			`🔒 Approve Tool: ${toolName}`,
			`${description}\n\nAllow this tool call to execute?`,
		);

		if (!ok) {
			deniedThisTurn = true;
			return { block: true, reason: "Blocked by user via HITL extension" };
		}

		return undefined;
	});
}

function formatToolCall(toolName: string, input: unknown): string {
	const args = input as Record<string, unknown>;

	switch (toolName) {
		case "read": {
			let desc = `Path: ${String(args.path ?? "unknown")}`;
			if (args.offset) desc += `\nOffset: ${args.offset}`;
			if (args.limit) desc += `\nLimit: ${args.limit} lines`;
			return desc;
		}

		case "bash": {
			let desc = `Command:\n  ${String(args.command ?? "unknown")}`;
			if (args.timeout) desc += `\nTimeout: ${args.timeout}s`;
			return desc;
		}

		case "edit": {
			const edits = (args.edits as Array<Record<string, unknown>> | undefined) ?? [];
			return `Path: ${String(args.path ?? "unknown")}\nEdit blocks: ${edits.length}`;
		}

		case "write": {
			const content = args.content as string | undefined;
			const lines = content?.split("\n").length ?? 0;
			return `Path: ${String(args.path ?? "unknown")}\nContent: ${lines} line(s)`;
		}

		case "grep": {
			return `Pattern: ${String(args.pattern ?? "unknown")}\nPath: ${String(args.path ?? "unknown")}`;
		}

		case "find": {
			let desc = `Path: ${String(args.path ?? "unknown")}`;
			if (args.name) desc += `\nName pattern: ${args.name}`;
			if (args.type) desc += `\nType: ${args.type}`;
			return desc;
		}

		case "ls": {
			return `Path: ${String(args.path ?? "unknown")}`;
		}

		default: {
			// Custom tool or unknown — show compact JSON preview
			const json = JSON.stringify(input, null, 2);
			if (json.length > 500) {
				return `Arguments:\n${json.slice(0, 500)}\n... (${json.length - 500} more characters)`;
			}
			return `Arguments:\n${json}`;
		}
	}
}
