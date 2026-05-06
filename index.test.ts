import { describe, it } from "node:test";
import assert from "node:assert";
import { resolveAction, combineSegmentResults } from "./evaluator.ts";
import { type Config } from "./rules.ts";
import { splitBashCommand } from "./splitter.ts";

describe("resolveAction", () => {
	it("returns allow when a matching allow rule exists", () => {
		const config: Config = {
			version: 1,
			default_action: "block",
			rules: [
				{ name: "Allow ls", condition: 'command.startsWith("ls")', action: "allow" },
			],
			hidden_tools: [],
		};
		const result = resolveAction(config, { command: "ls -la" }, true);
		assert.strictEqual(result.type, "allow");
	});

	it("returns block when a matching block rule exists", () => {
		const config: Config = {
			version: 1,
			default_action: "allow",
			rules: [
				{
					name: "Block rm",
					condition: 'command.contains("rm")',
					action: "block",
					message: "rm is blocked",
				},
			],
			hidden_tools: [],
		};
		const result = resolveAction(config, { command: "rm -rf /" }, true);
		assert.strictEqual(result.type, "block");
		if (result.type === "block") {
			assert.strictEqual(result.reason, "rm is blocked");
		}
	});

	it("returns confirm when a matching confirm rule exists and UI is available", () => {
		const config: Config = {
			version: 1,
			default_action: "allow",
			rules: [
				{
					name: "Confirm git",
					condition: 'command.startsWith("git")',
					action: "confirm",
					message: "Git operations require approval",
				},
			],
			hidden_tools: [],
		};
		const result = resolveAction(config, { command: "git push" }, true);
		assert.strictEqual(result.type, "confirm");
		if (result.type === "confirm") {
			assert.strictEqual(result.ruleName, "Confirm git");
			assert.strictEqual(result.message, "Git operations require approval");
		}
	});

	it("returns block when confirm rule matches but no UI is available", () => {
		const config: Config = {
			version: 1,
			default_action: "allow",
			rules: [
				{
					name: "Confirm git",
					condition: 'command.startsWith("git")',
					action: "confirm",
				},
			],
			hidden_tools: [],
		};
		const result = resolveAction(config, { command: "git push" }, false);
		assert.strictEqual(result.type, "block");
	});

	it("returns default action when no rule matches", () => {
		const config: Config = {
			version: 1,
			default_action: "block",
			rules: [],
			hidden_tools: [],
		};
		const result = resolveAction(config, { command: "anything" }, true);
		assert.strictEqual(result.type, "block");
		if (result.type === "block") {
			assert.strictEqual(result.reason, "Blocked by default — no matching permission rule");
		}
	});

	it("returns default confirm as confirm when UI is available", () => {
		const config: Config = {
			version: 1,
			default_action: "confirm",
			rules: [],
			hidden_tools: [],
		};
		const result = resolveAction(config, { command: "anything" }, true);
		assert.strictEqual(result.type, "confirm");
		if (result.type === "confirm") {
			assert.strictEqual(result.ruleName, "default");
		}
	});

	it("returns default confirm as block when UI is not available", () => {
		const config: Config = {
			version: 1,
			default_action: "confirm",
			rules: [],
			hidden_tools: [],
		};
		const result = resolveAction(config, { command: "anything" }, false);
		assert.strictEqual(result.type, "block");
	});
});

describe("combineSegmentResults", () => {
	it("returns allow when all segments are allowed", () => {
		const result = combineSegmentResults([
			{ type: "allow" },
			{ type: "allow" },
		]);
		assert.strictEqual(result.type, "allow");
	});

	it("returns block when any segment is blocked", () => {
		const result = combineSegmentResults([
			{ type: "allow" },
			{ type: "block", reason: "Blocked by rule: rm" },
		]);
		assert.strictEqual(result.type, "block");
		if (result.type === "block") {
			assert.strictEqual(result.reason, "Blocked by rule: rm");
		}
	});

	it("joins multiple block reasons", () => {
		const result = combineSegmentResults([
			{ type: "block", reason: "Blocked by rule: rm" },
			{ type: "block", reason: "Blocked by rule: sudo" },
		]);
		assert.strictEqual(result.type, "block");
		if (result.type === "block") {
			assert.strictEqual(result.reason, "Blocked by rule: rm; Blocked by rule: sudo");
		}
	});

	it("returns confirm when no block but some confirm", () => {
		const result = combineSegmentResults([
			{ type: "allow" },
			{
				type: "confirm",
				ruleName: "Confirm git",
				message: "Git requires approval",
			},
		]);
		assert.strictEqual(result.type, "confirm");
		if (result.type === "confirm") {
			assert.deepStrictEqual(result.ruleNames, ["Confirm git"]);
			assert.deepStrictEqual(result.messages, ["Git requires approval"]);
		}
	});

	it("block wins over confirm", () => {
		const result = combineSegmentResults([
			{ type: "block", reason: "Blocked" },
			{ type: "confirm", ruleName: "Confirm", message: undefined },
		]);
		assert.strictEqual(result.type, "block");
	});

	it("gathers multiple confirm messages", () => {
		const result = combineSegmentResults([
			{ type: "confirm", ruleName: "Rule A", message: "Message A" },
			{ type: "confirm", ruleName: "Rule B", message: undefined },
		]);
		assert.strictEqual(result.type, "confirm");
		if (result.type === "confirm") {
			assert.deepStrictEqual(result.ruleNames, ["Rule A", "Rule B"]);
			assert.deepStrictEqual(result.messages, [
				"Message A",
				"This operation requires approval.",
			]);
		}
	});
});

describe("per-segment bash evaluation", () => {
	it("blocks ls && rm when rm rule blocks", () => {
		const config: Config = {
			version: 1,
			default_action: "allow",
			rules: [
				{
					name: "Block rm",
					condition: 'command.contains("rm")',
					action: "block",
					message: "rm is blocked",
				},
			],
			hidden_tools: [],
		};
		const segments = splitBashCommand("ls && rm -rf /");
		const results = segments.map((seg) =>
			resolveAction(config, { command: seg }, true),
		);
		const combined = combineSegmentResults(results);
		assert.strictEqual(combined.type, "block");
	});

	it("allows tail | head when both rules allow", () => {
		const config: Config = {
			version: 1,
			default_action: "block",
			rules: [
				{
					name: "Allow tail",
					condition: 'command.startsWith("tail")',
					action: "allow",
				},
				{
					name: "Allow head",
					condition: 'command.startsWith("head")',
					action: "allow",
				},
			],
			hidden_tools: [],
		};
		const segments = splitBashCommand("tail -n1000 | head -20");
		const results = segments.map((seg) =>
			resolveAction(config, { command: seg }, true),
		);
		const combined = combineSegmentResults(results);
		assert.strictEqual(combined.type, "allow");
	});

	it("falls to default when only one segment matches allow", () => {
		const config: Config = {
			version: 1,
			default_action: "block",
			rules: [
				{
					name: "Allow ls",
					condition: 'command.startsWith("ls")',
					action: "allow",
				},
			],
			hidden_tools: [],
		};
		const segments = splitBashCommand("ls && echo hi");
		const results = segments.map((seg) =>
			resolveAction(config, { command: seg }, true),
		);
		const combined = combineSegmentResults(results);
		assert.strictEqual(combined.type, "block");
		if (combined.type === "block") {
			assert.strictEqual(
				combined.reason,
				"Blocked by default — no matching permission rule",
			);
		}
	});

	it("does not split on quoted operators", () => {
		const config: Config = {
			version: 1,
			default_action: "block",
			rules: [
				{
					name: "Allow echo",
					condition: 'command.startsWith("echo")',
					action: "allow",
				},
			],
			hidden_tools: [],
		};
		const segments = splitBashCommand('echo "a && b"');
		assert.strictEqual(segments.length, 1);
		const results = segments.map((seg) =>
			resolveAction(config, { command: seg }, true),
		);
		const combined = combineSegmentResults(results);
		assert.strictEqual(combined.type, "allow");
	});

	it("behaves identically for single-segment commands", () => {
		const config: Config = {
			version: 1,
			default_action: "block",
			rules: [
				{
					name: "Allow ls",
					condition: 'command.startsWith("ls")',
					action: "allow",
				},
			],
			hidden_tools: [],
		};
		const segments = splitBashCommand("ls -la");
		assert.strictEqual(segments.length, 1);
		const results = segments.map((seg) =>
			resolveAction(config, { command: seg }, true),
		);
		const combined = combineSegmentResults(results);
		assert.strictEqual(combined.type, "allow");
	});
});
