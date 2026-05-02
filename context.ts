import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { resolve } from "node:path";

/**
 * A function that contributes additional key-value pairs to the CEL evaluation
 * context for a single tool call. Called once per tool_call event, after the
 * base context (tool, args, cwd, path, command) is assembled.
 *
 * Builders may be synchronous or asynchronous. Errors from individual builders
 * are caught and logged; they do not break other builders or the permission gate.
 */
export type ContextBuilder = (
	toolName: string,
	input: unknown,
	cwd: string,
	ctx: ExtensionContext,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

/**
 * Payload emitted by other extensions via
 * `pi.events.emit("hitl:register_context", registration)`.
 */
export interface ContextBuilderRegistration {
	/** Human-readable name for debugging and error messages. */
	name: string;
	/** Builder function that returns context key-value pairs. */
	builder: ContextBuilder;
}

/**
 * Cached metadata for a tool, derived from `pi.getAllTools()`.
 */
export interface ToolMetadata {
	/** Tool origin: "builtin", "sdk", extension path, etc. */
	source: string;
	/** Tool scope: "user", "project", "temporary", etc. */
	scope: string;
}

/**
 * Creates a registry for context builders contributed by other extensions.
 *
 * Builders are stored in a Map keyed by their registration name. When
 * `build()` is called, each builder is invoked in insertion order and its
 * output is merged into the base context via `Object.assign`. Later builders
 * override earlier ones for conflicting keys.
 */
export function createContextBuilderRegistry(): {
	register(name: string, builder: ContextBuilder): void;
	build(
		toolName: string,
		input: unknown,
		cwd: string,
		ctx: ExtensionContext,
		baseContext: Record<string, unknown>,
	): Promise<Record<string, unknown>>;
	list(): string[];
} {
	const builders = new Map<string, ContextBuilder>();

	return {
		register(name: string, builder: ContextBuilder): void {
			builders.set(name, builder);
		},

		async build(
			toolName: string,
			input: unknown,
			cwd: string,
			ctx: ExtensionContext,
			baseContext: Record<string, unknown>,
		): Promise<Record<string, unknown>> {
			const context = { ...baseContext };

			for (const [name, builder] of builders) {
				try {
					const result = await builder(toolName, input, cwd, ctx);
					Object.assign(context, result);
				} catch (e) {
					console.error(
						`[permissions] Context builder "${name}" failed:`,
						e,
					);
				}
			}

			return context;
		},

		list(): string[] {
			return Array.from(builders.keys());
		},
	};
}

/**
 * Creates a cache for tool metadata derived from `pi.getAllTools()`.
 *
 * Call `refresh()` when the tool list changes (e.g. at `session_start` or after
 * an extension dynamically registers a tool). Call `get()` during `tool_call`
 * to look up metadata for the specific tool being evaluated.
 */
export function createToolMetadataCache(): {
	refresh(
		tools: Array<{ name: string; sourceInfo: { source: string; scope: string } }>,
	): void;
	get(toolName: string): ToolMetadata | undefined;
} {
	const cache = new Map<string, ToolMetadata>();

	return {
		refresh(
			tools: Array<{ name: string; sourceInfo: { source: string; scope: string } }>,
		): void {
			cache.clear();
			for (const tool of tools) {
				cache.set(tool.name, {
					source: tool.sourceInfo.source,
					scope: tool.sourceInfo.scope,
				});
			}
		},

		get(toolName: string): ToolMetadata | undefined {
			return cache.get(toolName);
		},
	};
}

/**
 * Assemble the base CEL context variables that pi.hitl provides for every
 * tool call. This is the fixed, built-in context before any extension builders
 * run.
 */
export function buildBaseContext(
	toolName: string,
	input: unknown,
	cwd: string,
): Record<string, unknown> {
	const args = input as Record<string, unknown>;
	const absCwd = resolve(cwd);
	const ctx: Record<string, unknown> = {
		tool: toolName,
		args,
		cwd: absCwd,
	};

	// command: available for bash tool
	if (toolName === "bash") {
		ctx.command = String(args.command ?? "");
	}

	// path: resolved absolute path for file-based tools; empty for bash / custom tools
	if (typeof args.path === "string") {
		ctx.path = resolve(absCwd, args.path);
	} else {
		ctx.path = "";
	}

	return ctx;
}
