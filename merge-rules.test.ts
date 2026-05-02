import { describe, it } from "node:test";
import assert from "node:assert";
import { mergeRules } from "./rules.ts";

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

describe("mergeRules", () => {
	it("returns an empty array for empty inputs", () => {
		assert.deepStrictEqual(mergeRules([], []), []);
	});

	it("returns base unchanged when override is empty", () => {
		const base = [{ name: "Allow reads", condition: 'tool == "read"', action: "allow" }];
		const result = mergeRules(base, []);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].name, "Allow reads");
	});

	it("concatenates leaf rules when names differ", () => {
		const base = [{ name: "Allow reads", condition: 'tool == "read"', action: "allow" }];
		const override = [{ name: "Allow writes", condition: 'tool == "write"', action: "allow" }];
		const result = mergeRules(base, override);
		assert.strictEqual(result.length, 2);
		assert.strictEqual(result[0].name, "Allow reads");
		assert.strictEqual(result[1].name, "Allow writes");
	});

	it("merges parent rules with matching name and condition", () => {
		const base = [
			{
				name: "Bash",
				condition: 'tool == "bash"',
				rules: [
					{ name: "ls", condition: 'command.startsWith("ls")', action: "allow" },
					{ default: "confirm" },
				],
			},
		];
		const override = [
			{
				name: "Bash",
				condition: 'tool == "bash"',
				rules: [{ name: "find", condition: 'command.startsWith("find")', action: "allow" }],
			},
		];
		const result = mergeRules(base, override);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].name, "Bash");
		assert.strictEqual(result[0].condition, 'tool == "bash"');

		const children = result[0].rules;
		assert.strictEqual(children.length, 3);
		assert.strictEqual(children[0].name, "ls");
		assert.strictEqual(children[1].name, "find");
		assert.strictEqual(children[2].default, "confirm");
	});

	it("reorders legacy condition: true catch-alls to the end", () => {
		const base = [
			{
				name: "Bash",
				condition: 'tool == "bash"',
				rules: [
					{ name: "ls", condition: 'command.startsWith("ls")', action: "allow" },
					{ name: "legacy-default", condition: "true", action: "confirm" },
				],
			},
		];
		const override = [
			{
				name: "Bash",
				condition: 'tool == "bash"',
				rules: [{ name: "find", condition: 'command.startsWith("find")', action: "allow" }],
			},
		];
		const result = mergeRules(base, override);
		const children = result[0].rules;
		assert.strictEqual(children.length, 3);
		assert.strictEqual(children[0].name, "ls");
		assert.strictEqual(children[1].name, "find");
		assert.strictEqual(children[2].name, "legacy-default");
	});

	it("does not merge parent rules with different conditions", () => {
		const base = [
			{
				name: "Bash",
				condition: 'tool == "bash"',
				rules: [{ name: "ls", condition: 'command.startsWith("ls")', action: "allow" }],
			},
		];
		const override = [
			{
				name: "Bash",
				condition: 'tool == "bash" && cwd.contains("/project")',
				rules: [{ name: "find", condition: 'command.startsWith("find")', action: "allow" }],
			},
		];
		const result = mergeRules(base, override);
		assert.strictEqual(result.length, 2);
		assert.strictEqual(result[0].condition, 'tool == "bash"');
		assert.strictEqual(result[1].condition, 'tool == "bash" && cwd.contains("/project")');
	});

	it("recursively merges deeply nested parent rules", () => {
		const base = [
			{
				name: "Outer",
				condition: "x == 1",
				rules: [
					{
						name: "Middle",
						condition: "y == 2",
						rules: [
							{ name: "base-child", condition: "z == 3", action: "allow" },
							{ default: "confirm" },
						],
					},
				],
			},
		];
		const override = [
			{
				name: "Outer",
				condition: "x == 1",
				rules: [
					{
						name: "Middle",
						condition: "y == 2",
						rules: [{ name: "override-child", condition: "w == 4", action: "allow" }],
					},
				],
			},
		];
		const result = mergeRules(base, override);
		assert.strictEqual(result.length, 1);

		const middle = result[0].rules[0];
		assert.strictEqual(middle.name, "Middle");
		assert.strictEqual(middle.rules.length, 3);
		assert.strictEqual(middle.rules[0].name, "base-child");
		assert.strictEqual(middle.rules[1].name, "override-child");
		assert.strictEqual(middle.rules[2].default, "confirm");
	});

	it("skips invalid entries and logs warnings", () => {
		const { result, logs } = captureStderr(() =>
			mergeRules(
				[{ name: "Valid", condition: "true", action: "allow" }],
				[null, { condition: "true", action: "allow" }, { name: "Also valid", condition: "true", action: "allow" }],
			),
		);
		assert.strictEqual(result.length, 2);
		assert.strictEqual(result[0].name, "Valid");
		assert.strictEqual(result[1].name, "Also valid");
		assert.ok(logs.some((l) => l.includes("Invalid rule")));
	});

	it("preserves specific rules before default rules when defaults appear in override", () => {
		const base = [
			{
				name: "Bash",
				condition: 'tool == "bash"',
				rules: [
					{ name: "ls", condition: 'command.startsWith("ls")', action: "allow" },
				],
			},
		];
		const override = [
			{
				name: "Bash",
				condition: 'tool == "bash"',
				rules: [
					{ name: "catch-all", condition: "true", default: "confirm" },
					{ name: "find", condition: 'command.startsWith("find")', action: "allow" },
				],
			},
		];
		const result = mergeRules(base, override);
		const children = result[0].rules;
		assert.strictEqual(children.length, 3);
		assert.strictEqual(children[0].name, "ls");
		assert.strictEqual(children[1].name, "find");
		assert.strictEqual(children[2].default, "confirm");
	});
});
