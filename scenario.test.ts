import { describe, it } from "node:test";
import assert from "node:assert";
import { runScenario } from "./scenario-runner.ts";
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

describe("runScenario", () => {
	it("passes when tool call is allowed", () => {
		const config = makeConfig({
			rules: [
				{
					name: "Allow reads",
					condition: 'tool == "read"',
					action: "allow",
				},
			],
		});
		const result = runScenario(config, {
			name: "Read file",
			tool: "read",
			args: { path: "./file.ts" },
			cwd: "/home/user/project",
			expected: "allow",
		});
		assert.strictEqual(result.passed, true);
		assert.strictEqual(result.actual.type, "allow");
	});

	it("fails when expected action does not match", () => {
		const config = makeConfig({
			rules: [
				{
					name: "Block rm",
					condition: 'command.contains("rm")',
					action: "block",
				},
			],
		});
		const result = runScenario(config, {
			name: "Run rm",
			tool: "bash",
			args: { command: "rm -rf /" },
			cwd: "/home/user/project",
			expected: "allow",
		});
		assert.strictEqual(result.passed, false);
		assert.ok(result.message?.includes("Expected allow but got block"));
	});

	it("uses explicit context when provided", () => {
		const config = makeConfig({
			rules: [
				{
					name: "Custom var",
					condition: "custom_var == 42",
					action: "allow",
				},
			],
		});
		const result = runScenario(config, {
			name: "Direct context",
			context: { custom_var: 42 },
			expected: "allow",
		});
		assert.strictEqual(result.passed, true);
	});

	it("fails when neither tool nor context is provided", () => {
		const config = makeConfig();
		const result = runScenario(config, {
			name: "Missing inputs",
			expected: "allow",
		});
		assert.strictEqual(result.passed, false);
		assert.ok(
			result.message?.includes("must specify either 'tool' or 'context'"),
		);
	});

	it("turns confirm into block when has_ui is false", () => {
		const config = makeConfig({
			rules: [
				{
					name: "Confirm rm",
					condition: 'command.contains("rm")',
					action: "confirm",
				},
			],
		});
		const result = runScenario(config, {
			name: "No UI confirm",
			tool: "bash",
			args: { command: "rm -rf /tmp" },
			cwd: "/home/user/project",
			has_ui: false,
			expected: "block",
		});
		assert.strictEqual(result.passed, true);
		assert.strictEqual(result.actual.type, "block");
	});

	it("passes confirm when has_ui is true", () => {
		const config = makeConfig({
			rules: [
				{
					name: "Confirm rm",
					condition: 'command.contains("rm")',
					action: "confirm",
				},
			],
		});
		const result = runScenario(config, {
			name: "UI confirm",
			tool: "bash",
			args: { command: "rm -rf /tmp" },
			cwd: "/home/user/project",
			has_ui: true,
			expected: "confirm",
		});
		assert.strictEqual(result.passed, true);
		assert.strictEqual(result.actual.type, "confirm");
	});

	it("splits and evaluates compound bash commands", () => {
		const config = makeConfig({
			default_action: "allow",
			rules: [
				{
					name: "Block rm",
					condition: 'command.contains("rm")',
					action: "block",
				},
			],
		});
		const result = runScenario(config, {
			name: "Compound blocks",
			tool: "bash",
			args: { command: "ls && rm -rf /" },
			cwd: "/home/user/project",
			expected: "block",
		});
		assert.strictEqual(result.passed, true);
		assert.strictEqual(result.actual.type, "block");
	});

	it("allows compound bash when all segments are allowed", () => {
		const config = makeConfig({
			default_action: "allow",
			rules: [
				{
					name: "Block rm",
					condition: 'command.contains("rm")',
					action: "block",
				},
			],
		});
		const result = runScenario(config, {
			name: "Compound allows",
			tool: "bash",
			args: { command: "ls && echo hi" },
			cwd: "/home/user/project",
			expected: "allow",
		});
		assert.strictEqual(result.passed, true);
		assert.strictEqual(result.actual.type, "allow");
	});

	it("checks expected_message_contains for block reasons", () => {
		const config = makeConfig({
			rules: [
				{
					name: "Block rm",
					condition: 'command.contains("rm")',
					action: "block",
					message: "rm is not allowed",
				},
			],
		});
		const result = runScenario(config, {
			name: "Message check",
			tool: "bash",
			args: { command: "rm -rf /" },
			cwd: "/home/user/project",
			expected: "block",
			expected_message_contains: "not allowed",
		});
		assert.strictEqual(result.passed, true);
	});

	it("fails when expected_message_contains is not found", () => {
		const config = makeConfig({
			rules: [
				{
					name: "Block rm",
					condition: 'command.contains("rm")',
					action: "block",
					message: "rm is not allowed",
				},
			],
		});
		const result = runScenario(config, {
			name: "Message check fail",
			tool: "bash",
			args: { command: "rm -rf /" },
			cwd: "/home/user/project",
			expected: "block",
			expected_message_contains: "sudo",
		});
		assert.strictEqual(result.passed, false);
		assert.ok(
			result.message?.includes('Expected message to contain "sudo"'),
		);
	});

	it("checks expected_rule for confirm actions", () => {
		const config = makeConfig({
			rules: [
				{
					name: "Confirm rm",
					condition: 'command.contains("rm")',
					action: "confirm",
				},
			],
		});
		const result = runScenario(config, {
			name: "Rule name check",
			tool: "bash",
			args: { command: "rm -rf /tmp" },
			cwd: "/home/user/project",
			expected: "confirm",
			expected_rule: "Confirm rm",
		});
		assert.strictEqual(result.passed, true);
	});

	it("checks expected_rule for block actions", () => {
		const config = makeConfig({
			rules: [
				{
					name: "Block rm",
					condition: 'command.contains("rm")',
					action: "block",
					message: "rm is blocked",
				},
			],
		});
		const result = runScenario(config, {
			name: "Block rule name check",
			tool: "bash",
			args: { command: "rm -rf /" },
			cwd: "/home/user/project",
			expected: "block",
			expected_rule: "Block rm",
		});
		assert.strictEqual(result.passed, true);
	});

	it("fails when expected_rule does not match", () => {
		const config = makeConfig({
			rules: [
				{
					name: "Block rm",
					condition: 'command.contains("rm")',
					action: "block",
					message: "rm is blocked",
				},
			],
		});
		const result = runScenario(config, {
			name: "Wrong rule name",
			tool: "bash",
			args: { command: "rm -rf /" },
			cwd: "/home/user/project",
			expected: "block",
			expected_rule: "Block sudo",
		});
		assert.strictEqual(result.passed, false);
		assert.ok(
			result.message?.includes('Expected rule "Block sudo"'),
		);
	});
});
