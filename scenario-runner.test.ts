import { describe, it } from "node:test";
import assert from "node:assert";
import { writeFileSync, unlinkSync } from "node:fs";
import { loadScenariosFromFile, runScenarios } from "./scenario-runner.ts";
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

describe("loadScenariosFromFile", () => {
	const tmpPath = "/tmp/pi.hitl-test-scenarios.yaml";

	it("parses a valid scenario YAML file", () => {
		const yaml = `
version: 1
tests:
  - name: "Allow read"
    tool: "read"
    args:
      path: "./file.ts"
    cwd: "/tmp"
    expected: allow
  - name: "Block write"
    tool: "write"
    args:
      path: "/etc/passwd"
    cwd: "/tmp"
    expected: block
`;
		writeFileSync(tmpPath, yaml, "utf-8");
		try {
			const scenarios = loadScenariosFromFile(tmpPath);
			assert.strictEqual(scenarios.length, 2);
			assert.strictEqual(scenarios[0].name, "Allow read");
			assert.strictEqual(scenarios[0].tool, "read");
			assert.deepStrictEqual(scenarios[0].args, { path: "./file.ts" });
			assert.strictEqual(scenarios[0].expected, "allow");
			assert.strictEqual(scenarios[1].name, "Block write");
			assert.strictEqual(scenarios[1].expected, "block");
		} finally {
			unlinkSync(tmpPath);
		}
	});

	it("throws when tests array is missing", () => {
		const yaml = `
version: 1
other_key: value
`;
		writeFileSync(tmpPath, yaml, "utf-8");
		try {
			assert.throws(
				() => loadScenariosFromFile(tmpPath),
				/must have a "tests" array/,
			);
		} finally {
			unlinkSync(tmpPath);
		}
	});

	it("throws for invalid YAML", () => {
		writeFileSync(tmpPath, "{ invalid yaml", "utf-8");
		try {
			assert.throws(() => loadScenariosFromFile(tmpPath));
		} finally {
			unlinkSync(tmpPath);
		}
	});
});

describe("runScenarios", () => {
	it("returns results for all scenarios including failures", () => {
		const config = makeConfig({
			rules: [
				{
					name: "Allow read",
					condition: 'tool == "read"',
					action: "allow",
				},
			],
		});

		const results = runScenarios(config, [
			{
				name: "Pass",
				tool: "read",
				args: { path: "./file.ts" },
				cwd: "/tmp",
				expected: "allow",
			},
			{
				name: "Fail",
				tool: "write",
				args: { path: "./file.ts" },
				cwd: "/tmp",
				expected: "allow",
			},
		]);

		assert.strictEqual(results.length, 2);
		assert.strictEqual(results[0].passed, true);
		assert.strictEqual(results[0].scenario.name, "Pass");
		assert.strictEqual(results[1].passed, false);
		assert.strictEqual(results[1].scenario.name, "Fail");
		assert.ok(results[1].message?.includes("Expected allow but got block"));
	});

	it("handles empty scenario list", () => {
		const config = makeConfig();
		const results = runScenarios(config, []);
		assert.strictEqual(results.length, 0);
	});
});
