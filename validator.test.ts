import { describe, it } from "node:test";
import assert from "node:assert";
import { validateConfig } from "./config.ts";
import type { Config } from "./rules.ts";

function makeConfig(overrides: Partial<Config> = {}): Config {
	return {
		version: 1,
		default_action: "block",
		rules: [],
		hidden_tools: [],
		...overrides,
	};
}

describe("validateConfig", () => {
	it("returns no errors for a minimal valid config", () => {
		const config = makeConfig();
		const result = validateConfig(config);
		assert.strictEqual(result.errors.length, 0);
		assert.strictEqual(result.warnings.length, 0);
	});

	it("returns no errors for a config with valid rules", () => {
		const config = makeConfig({
			rules: [
				{
					name: "Allow reads",
					condition: 'tool == "read"',
					action: "allow",
				},
			],
		});
		const result = validateConfig(config);
		assert.strictEqual(result.errors.length, 0);
		assert.strictEqual(result.warnings.length, 0);
	});

	it("reports invalid version as error", () => {
		const config = makeConfig({ version: 99 });
		const result = validateConfig(config);
		assert.ok(
			result.errors.some((e) => e.includes("Unsupported version: 99")),
		);
	});

	it("reports invalid default_action as error", () => {
		const config = makeConfig({ default_action: "explode" as any });
		const result = validateConfig(config);
		assert.ok(
			result.errors.some((e) =>
				e.includes('Invalid default_action: "explode"'),
			),
		);
	});

	it("reports invalid CEL expression as error", () => {
		const config = makeConfig({
			rules: [
				{
					name: "Broken",
					condition: "tool ==",
					action: "allow",
				},
			],
		});
		const result = validateConfig(config);
		assert.ok(
			result.errors.some((e) =>
				e.includes("Broken") && e.includes("Invalid CEL expression"),
			),
		);
	});

	it("reports invalid action as error", () => {
		const config = makeConfig({
			rules: [
				{
					name: "Bad action",
					condition: "true",
					action: "explode" as any,
				},
			],
		});
		const result = validateConfig(config);
		assert.ok(
			result.errors.some((e) =>
				e.includes("Bad action") && e.includes('Invalid action: "explode"'),
			),
		);
	});

	it("warns when a catch-all is not the last rule", () => {
		const config = makeConfig({
			rules: [
				{ name: "Catch-all", condition: "true", action: "block" },
				{
					name: "Specific",
					condition: 'tool == "read"',
					action: "allow",
				},
			],
		});
		const result = validateConfig(config);
		assert.strictEqual(result.errors.length, 0);
		assert.ok(
			result.warnings.some((w) =>
				w.includes("Catch-all") && w.includes("not the last rule"),
			),
		);
	});

	it("does not warn when catch-all is the last rule", () => {
		const config = makeConfig({
			rules: [
				{
					name: "Specific",
					condition: 'tool == "read"',
					action: "allow",
				},
				{ name: "Catch-all", condition: "true", action: "block" },
			],
		});
		const result = validateConfig(config);
		assert.strictEqual(result.errors.length, 0);
		assert.strictEqual(result.warnings.length, 0);
	});

	it("warns about duplicate rule names", () => {
		const config = makeConfig({
			rules: [
				{
					name: "Same",
					condition: 'tool == "read"',
					action: "allow",
				},
				{
					name: "Same",
					condition: 'tool == "write"',
					action: "allow",
				},
			],
		});
		const result = validateConfig(config);
		assert.strictEqual(result.errors.length, 0);
		assert.ok(
			result.warnings.some((w) =>
				w.includes("Duplicate rule name: \"Same\""),
			),
		);
	});

	it("warns when a hidden tool shadows a rule", () => {
		const config = makeConfig({
			rules: [
				{
					name: "Allow read",
					condition: 'tool == "read"',
					action: "allow",
				},
			],
			hidden_tools: ["read"],
		});
		const result = validateConfig(config);
		assert.strictEqual(result.errors.length, 0);
		assert.ok(
			result.warnings.some((w) =>
				w.includes('Hidden tool "read"') &&
				w.includes("Allow read"),
			),
		);
	});

	it("does not warn about hidden tools that do not shadow rules", () => {
		const config = makeConfig({
			rules: [
				{
					name: "Allow read",
					condition: 'tool == "read"',
					action: "allow",
				},
			],
			hidden_tools: ["write"],
		});
		const result = validateConfig(config);
		assert.strictEqual(result.errors.length, 0);
		assert.strictEqual(result.warnings.length, 0);
	});
});
