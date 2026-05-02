import { describe, it } from "node:test";
import assert from "node:assert";
import { flattenRules, type Rule } from "./rules.ts";

/** Temporarily capture console.error output for a function call. */
function captureStderr<T>(fn: () => T): { result: T; logs: string[] } {
	const original = console.error;
	const logs: string[] = [];
	console.error = (...args: unknown[]) => {
		logs.push(args.map(String).join(" "));
	};
	try {
		const result = fn();
		return { result, logs };
	} finally {
		console.error = original;
	}
}

describe("flattenRules", () => {
	it("returns an empty array for empty input", () => {
		const result = flattenRules([]);
		assert.deepStrictEqual(result, []);
	});

	it("passes through a top-level leaf rule unchanged", () => {
		const raw = [
			{
				name: "Allow reads",
				condition: 'tool == "read"',
				action: "allow",
				message: "Reads are fine",
			},
		];
		const result = flattenRules(raw);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].name, "Allow reads");
		assert.strictEqual(result[0].condition, 'tool == "read"');
		assert.strictEqual(result[0].action, "allow");
		assert.strictEqual(result[0].message, "Reads are fine");
	});

	it("flattens a parent with a single child", () => {
		const raw = [
			{
				name: "Bash",
				condition: 'tool == "bash"',
				rules: [
					{
						name: "rm",
						condition: 'command.contains("rm")',
						action: "block",
					},
				],
			},
		];
		const result = flattenRules(raw);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].name, "Bash > rm");
		assert.strictEqual(result[0].condition, '(tool == "bash") && (command.contains("rm"))');
		assert.strictEqual(result[0].action, "block");
	});

	it("flattens a parent with multiple children in order", () => {
		const raw = [
			{
				name: "Bash",
				condition: 'tool == "bash"',
				rules: [
					{ name: "rm", condition: 'command.contains("rm")', action: "block" },
					{ name: "find", condition: 'command.startsWith("find .")', action: "allow" },
					{ name: "default", condition: "true", action: "confirm" },
				],
			},
		];
		const result = flattenRules(raw);
		assert.strictEqual(result.length, 3);

		assert.strictEqual(result[0].name, "Bash > rm");
		assert.strictEqual(result[0].condition, '(tool == "bash") && (command.contains("rm"))');
		assert.strictEqual(result[0].action, "block");

		assert.strictEqual(result[1].name, "Bash > find");
		assert.strictEqual(result[1].condition, '(tool == "bash") && (command.startsWith("find ."))');
		assert.strictEqual(result[1].action, "allow");

		assert.strictEqual(result[2].name, "Bash > default");
		assert.strictEqual(result[2].condition, '(tool == "bash") && (true)');
		assert.strictEqual(result[2].action, "confirm");
	});

	it("handles three-level deep nesting", () => {
		const raw = [
			{
				name: "Outer",
				condition: "x == 1",
				rules: [
					{
						name: "Middle",
						condition: "y == 2",
						rules: [
							{
								name: "Inner",
								condition: "z == 3",
								action: "allow",
							},
						],
					},
				],
			},
		];
		const result = flattenRules(raw);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].name, "Outer > Middle > Inner");
		assert.strictEqual(result[0].condition, "((x == 1) && (y == 2)) && (z == 3)");
	});

	it("interleaves nested and top-level leaf rules", () => {
		const raw = [
			{ name: "Global allow", condition: 'path.startsWith(cwd)', action: "allow" },
			{
				name: "Bash",
				condition: 'tool == "bash"',
				rules: [
					{ name: "ls", condition: 'command.startsWith("ls")', action: "allow" },
				],
			},
			{ name: "Global block", condition: "true", action: "block" },
		];
		const result = flattenRules(raw);
		assert.strictEqual(result.length, 3);

		assert.strictEqual(result[0].name, "Global allow");
		assert.strictEqual(result[0].condition, "path.startsWith(cwd)");

		assert.strictEqual(result[1].name, "Bash > ls");
		assert.strictEqual(result[1].condition, '(tool == "bash") && (command.startsWith("ls"))');

		assert.strictEqual(result[2].name, "Global block");
		assert.strictEqual(result[2].condition, "true");
	});

	it("produces an empty array for a parent with no children", () => {
		const raw = [
			{
				name: "Bash",
				condition: 'tool == "bash"',
				rules: [],
			},
		];
		const result = flattenRules(raw);
		assert.deepStrictEqual(result, []);
	});

	it("skips a child with an invalid action and logs a warning", () => {
		const { result, logs } = captureStderr(() =>
			flattenRules([
				{
					name: "Bash",
					condition: 'tool == "bash"',
					rules: [
						{ name: "bad", condition: "true", action: "explode" },
						{ name: "good", condition: "true", action: "allow" },
					],
				},
			]),
		);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].name, "Bash > good");
		assert.ok(logs.some((l) => l.includes('Invalid action "explode"')));
	});

	it("skips a child with neither action nor nested rules and logs a warning", () => {
		const { result, logs } = captureStderr(() =>
			flattenRules([
				{
					name: "Bash",
					condition: 'tool == "bash"',
					rules: [
						{ name: "orphan", condition: "true" },
						{ name: "good", condition: "true", action: "allow" },
					],
				},
			]),
		);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].name, "Bash > good");
		assert.ok(logs.some((l) => l.includes("neither action nor nested rules")));
	});

	it("skips a rule with invalid CEL in the flattened condition and logs a warning", () => {
		const { result, logs } = captureStderr(() =>
			flattenRules([
				{
					name: "Bash",
					condition: 'tool == "bash"',
					rules: [
						{ name: "broken", condition: "this is not valid cel!!!", action: "allow" },
						{ name: "good", condition: "true", action: "allow" },
					],
				},
			]),
		);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].name, "Bash > good");
		assert.ok(logs.some((l) => l.includes("Invalid CEL expression")));
	});

	it("warns when a parent has both action and nested rules", () => {
		const { result, logs } = captureStderr(() =>
			flattenRules([
				{
					name: "Bash",
					condition: 'tool == "bash"',
					action: "block",
					rules: [{ name: "ls", condition: 'command.startsWith("ls")', action: "allow" }],
				},
			]),
		);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].name, "Bash > ls");
		assert.ok(logs.some((l) => l.includes("both action and nested rules")));
	});

	it("skips invalid top-level entries without crashing", () => {
		const { result, logs } = captureStderr(() =>
			flattenRules([
				null,
				{ name: "", condition: "true", action: "allow" }, // missing name
				{ name: "Valid", condition: "true", action: "allow" },
			]),
		);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].name, "Valid");
		assert.ok(logs.some((l) => l.includes("Invalid rule")));
	});

	it("expands default: allow to a full rule", () => {
		const { result, logs } = captureStderr(() =>
			flattenRules([{ default: "allow" }]),
		);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].name, "Default");
		assert.strictEqual(result[0].condition, "true");
		assert.strictEqual(result[0].action, "allow");
		assert.strictEqual(logs.length, 0);
	});

	it("uses explicit name over auto-generated Default", () => {
		const { result, logs } = captureStderr(() =>
			flattenRules([{ name: "Catch-all", default: "confirm" }]),
		);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].name, "Catch-all");
		assert.strictEqual(result[0].condition, "true");
		assert.strictEqual(result[0].action, "confirm");
		assert.strictEqual(logs.length, 0);
	});

	it("warns and uses explicit condition when default and condition conflict", () => {
		const { result, logs } = captureStderr(() =>
			flattenRules([
				{ default: "confirm", condition: 'tool == "bash"' },
			]),
		);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].name, "Default");
		assert.strictEqual(result[0].condition, 'tool == "bash"');
		assert.strictEqual(result[0].action, "confirm");
		assert.ok(logs.some((l) => l.includes('both "default" and explicit "condition"')));
	});

	it("warns and uses explicit action when default and action conflict", () => {
		const { result, logs } = captureStderr(() =>
			flattenRules([
				{ default: "confirm", action: "block" },
			]),
		);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].name, "Default");
		assert.strictEqual(result[0].condition, "true");
		assert.strictEqual(result[0].action, "block");
		assert.ok(logs.some((l) => l.includes('both "default" and explicit "action"')));
	});

	it("warns and ignores default on parent rules", () => {
		const { result, logs } = captureStderr(() =>
			flattenRules([
				{
					name: "Bash",
					condition: 'tool == "bash"',
					default: "confirm",
					rules: [{ name: "ls", condition: 'command.startsWith("ls")', action: "allow" }],
				},
			]),
		);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].name, "Bash > ls");
		assert.ok(logs.some((l) => l.includes('both "default" and nested rules')));
	});

	it("skips invalid default value and logs a warning", () => {
		const { result, logs } = captureStderr(() =>
			flattenRules([{ default: "explode" }]),
		);
		assert.strictEqual(result.length, 0);
		assert.ok(logs.some((l) => l.includes('Invalid default action "explode"')));
	});

	it("expands nested default inside a parent", () => {
		const { result, logs } = captureStderr(() =>
			flattenRules([
				{
					name: "Bash",
					condition: 'tool == "bash"',
					rules: [{ default: "confirm" }],
				},
			]),
		);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].name, "Bash > Default");
		assert.strictEqual(result[0].condition, '(tool == "bash") && (true)');
		assert.strictEqual(result[0].action, "confirm");
		assert.strictEqual(logs.length, 0);
	});
});
