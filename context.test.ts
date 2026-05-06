import { describe, it } from "node:test";
import assert from "node:assert";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	createContextBuilderRegistry,
	createToolMetadataCache,
	buildBaseContext,
} from "./context.ts";

/** Temporarily capture console.error output for an async function call. */
async function captureStderr<T>(
	fn: () => Promise<T>,
): Promise<{ result: T; logs: string[] }> {
	const original = console.error;
	const logs: string[] = [];
	console.error = (...args: unknown[]) => {
		logs.push(args.map(String).join(" "));
	};
	try {
		const result = await fn();
		return { result, logs };
	} finally {
		console.error = original;
	}
}

/** Minimal mock ExtensionContext for testing. */
const mockCtx = {} as unknown as ExtensionContext;

describe("createContextBuilderRegistry", () => {
	it("registers and lists builders", () => {
		const registry = createContextBuilderRegistry();
		assert.deepStrictEqual(registry.list(), []);

		registry.register("builder_a", () => ({ a: 1 }));
		assert.deepStrictEqual(registry.list(), ["builder_a"]);

		registry.register("builder_b", () => ({ b: 2 }));
		assert.deepStrictEqual(registry.list(), ["builder_a", "builder_b"]);
	});

	it("build() calls all registered builders and merges results", async () => {
		const registry = createContextBuilderRegistry();
		registry.register("one", () => ({ x: 1, y: 10 }));
		registry.register("two", () => ({ y: 20, z: 30 }));

		const base = { tool: "read" };
		const result = await registry.build("read", {}, "/tmp", mockCtx, base);

		assert.strictEqual(result.tool, "read");
		assert.strictEqual(result.x, 1);
		assert.strictEqual(result.y, 20); // later overrides earlier
		assert.strictEqual(result.z, 30);
	});

	it("build() awaits async builders", async () => {
		const registry = createContextBuilderRegistry();
		registry.register("async", async () => ({ async_val: 42 }));

		const base = {};
		const result = await registry.build("bash", {}, "/tmp", mockCtx, base);

		assert.strictEqual(result.async_val, 42);
	});

	it("a throwing builder logs an error and does not affect other builders", async () => {
		const registry = createContextBuilderRegistry();
		registry.register("good", () => ({ good: true }));
		registry.register("bad", () => {
			throw new Error("bad builder");
		});
		registry.register("also_good", () => ({ also_good: true }));

		const { result, logs } = await captureStderr(async () =>
			registry.build("read", {}, "/tmp", mockCtx, {}),
		);

		const ctx = await result;
		assert.strictEqual(ctx.good, true);
		assert.strictEqual(ctx.also_good, true);
		assert.strictEqual(ctx.bad, undefined);

		assert.strictEqual(logs.length, 1);
		assert.ok(logs[0].includes("bad"));
		assert.ok(logs[0].includes("bad builder"));
	});

	it("a rejected async builder logs an error and does not affect other builders", async () => {
		const registry = createContextBuilderRegistry();
		registry.register("good", () => ({ good: true }));
		registry.register("bad", async () => {
			throw new Error("rejected builder");
		});
		registry.register("also_good", () => ({ also_good: true }));

		const { result, logs } = await captureStderr(async () =>
			registry.build("read", {}, "/tmp", mockCtx, {}),
		);

		const ctx = await result;
		assert.strictEqual(ctx.good, true);
		assert.strictEqual(ctx.also_good, true);
		assert.strictEqual(ctx.bad, undefined);

		assert.strictEqual(logs.length, 1);
		assert.ok(logs[0].includes("bad"));
		assert.ok(logs[0].includes("rejected builder"));
	});

	it("re-registering the same name replaces the builder", async () => {
		const registry = createContextBuilderRegistry();
		registry.register("same", () => ({ v: 1 }));
		registry.register("same", () => ({ v: 2 }));

		const result = await registry.build("read", {}, "/tmp", mockCtx, {});
		assert.strictEqual(result.v, 2);
	});

	it("build() returns a copy of baseContext, not the original", async () => {
		const registry = createContextBuilderRegistry();
		const base = { key: "value" };
		const result = await registry.build("read", {}, "/tmp", mockCtx, base);

		// Mutating result should not affect base
		result.key = "mutated";
		assert.strictEqual(base.key, "value");
	});
});

describe("createToolMetadataCache", () => {
	it("refresh populates and get retrieves metadata", () => {
		const cache = createToolMetadataCache();
		cache.refresh([
			{ name: "read", sourceInfo: { source: "builtin", scope: "project" } },
			{ name: "custom_tool", sourceInfo: { source: "my-ext", scope: "user" } },
		]);

		const readMeta = cache.get("read");
		assert.ok(readMeta);
		assert.strictEqual(readMeta.source, "builtin");
		assert.strictEqual(readMeta.scope, "project");

		const customMeta = cache.get("custom_tool");
		assert.ok(customMeta);
		assert.strictEqual(customMeta.source, "my-ext");
		assert.strictEqual(customMeta.scope, "user");
	});

	it("get returns undefined for unknown tools", () => {
		const cache = createToolMetadataCache();
		cache.refresh([
			{ name: "read", sourceInfo: { source: "builtin", scope: "project" } },
		]);

		assert.strictEqual(cache.get("write"), undefined);
	});

	it("refresh replaces previous cache contents", () => {
		const cache = createToolMetadataCache();
		cache.refresh([
			{ name: "read", sourceInfo: { source: "builtin", scope: "project" } },
		]);

		assert.ok(cache.get("read"));

		cache.refresh([
			{ name: "write", sourceInfo: { source: "builtin", scope: "project" } },
		]);

		assert.strictEqual(cache.get("read"), undefined);
		assert.ok(cache.get("write"));
	});
});

describe("buildBaseContext", () => {
	it("sets tool, args, and cwd for a generic tool", () => {
		const result = buildBaseContext("read", { path: "./file.ts" }, "/home/user/project");

		assert.strictEqual(result.tool, "read");
		assert.deepStrictEqual(result.args, { path: "./file.ts" });
		assert.strictEqual(result.cwd, "/home/user/project");
	});

	it("sets command for bash tool", () => {
		const result = buildBaseContext("bash", { command: "ls -la" }, "/tmp");

		assert.strictEqual(result.tool, "bash");
		assert.strictEqual(result.command, "ls -la");
	});

	it("sets empty command for bash tool without command argument", () => {
		const result = buildBaseContext("bash", {}, "/tmp");
		assert.strictEqual(result.command, "");
	});

	it("stringifies non-string command values", () => {
		const result = buildBaseContext("bash", { command: 42 }, "/tmp");
		assert.strictEqual(result.command, "42");
	});

	it("resolves relative path to absolute for file-based tools", () => {
		const result = buildBaseContext("read", { path: "./src/index.ts" }, "/home/user/project");

		assert.strictEqual(result.path, "/home/user/project/src/index.ts");
	});

	it("resolves absolute path unchanged", () => {
		const result = buildBaseContext("write", { path: "/etc/hosts" }, "/home/user/project");

		assert.strictEqual(result.path, "/etc/hosts");
	});

	it("sets path to empty string for tools without path argument", () => {
		const result = buildBaseContext("bash", { command: "echo hi" }, "/tmp");

		assert.strictEqual(result.path, "");
	});

	it("resolves cwd to absolute path", () => {
		// Using a relative cwd should be resolved
		const result = buildBaseContext("read", { path: "file.ts" }, "relative/dir");

		// cwd should be resolved to absolute
		assert.ok((result.cwd as string).startsWith("/"));
		assert.strictEqual(result.path, (result.cwd as string) + "/file.ts");
	});
});
