#!/usr/bin/env -S npx tsx

import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { loadConfigFromFiles, validateConfig } from "./config.ts";
import { loadScenariosFromFile, runScenarios } from "./scenario-runner.ts";

function printHelp() {
	console.log(
		`pi-hitl-validate — Validate pi.hitl permission configs and scenarios

Usage:
  pi-hitl-validate <config.yaml> [scenarios.yaml]

Arguments:
  config.yaml       Path to permissions.yaml to validate
  scenarios.yaml    Optional path to scenario test file to run

Exit codes:
  0  Config is valid and all scenarios pass
  1  Validation errors, scenario failures, or file not found
`,
	);
}

function main() {
	const args = process.argv.slice(2);

	if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
		printHelp();
		process.exit(args.length === 0 ? 1 : 0);
	}

	const configPath = args[0];
	const scenariosPath = args[1];

	if (!existsSync(configPath)) {
		console.error(`Error: Config file not found: ${configPath}`);
		process.exit(1);
	}

	// Pre-validate YAML is parseable so we can surface syntax errors
	try {
		const text = readFileSync(configPath, "utf-8");
		parseYaml(text);
	} catch (e) {
		console.error(`Error: Failed to parse ${configPath}: ${e}`);
		process.exit(1);
	}

	const loadLogs: string[] = [];
	const config = loadConfigFromFiles([configPath], (...args: unknown[]) => {
		loadLogs.push(args.map(String).join(" "));
	});
	if (!config) {
		console.error(
			`Error: No valid config found in ${configPath} (missing rules or hidden_tools)`,
		);
		process.exit(1);
	}

	const validation = validateConfig(config);
	// Treat all load-time logs as errors — they indicate dropped rules,
	// invalid defaults, parse failures, or other issues that affect behaviour.
	const allErrors = [...loadLogs, ...validation.errors];
	const hasErrors = allErrors.length > 0;
	const hasWarnings = validation.warnings.length > 0;

	// Config summary
	console.log(
		`Config loaded: ${config.rules.length} rules, ${config.hidden_tools.length} hidden tools`,
	);

	// Errors
	if (allErrors.length > 0) {
		console.log(`\nErrors (${allErrors.length}):`);
		for (const error of allErrors) {
			console.log(`  ✗ ${error}`);
		}
	}

	// Warnings
	if (validation.warnings.length > 0) {
		console.log(`\nWarnings (${validation.warnings.length}):`);
		for (const warning of validation.warnings) {
			console.log(`  ! ${warning}`);
		}
	}

	// Scenarios
	let scenarioFailures = 0;
	if (scenariosPath) {
		if (!existsSync(scenariosPath)) {
			console.error(`\nError: Scenarios file not found: ${scenariosPath}`);
			process.exit(1);
		}

		// Pre-validate YAML
		try {
			const text = readFileSync(scenariosPath, "utf-8");
			parseYaml(text);
		} catch (e) {
			console.error(`\nError: Failed to parse ${scenariosPath}: ${e}`);
			process.exit(1);
		}

		console.log(`\nRunning scenarios from ${scenariosPath}...`);
		const scenarios = loadScenariosFromFile(scenariosPath);
		const results = runScenarios(config, scenarios);

		console.log();
		for (const result of results) {
			const icon = result.passed ? "✓" : "✗";
			const suffix = result.passed
				? ""
				: ` (${result.message})`;
			console.log(
				`  ${icon} ${result.scenario.name} → ${result.actual.type}${suffix}`,
			);
			if (!result.passed) scenarioFailures++;
		}

		console.log(
			`\n${results.length - scenarioFailures} passed, ${scenarioFailures} failed`,
		);
	}

	// Exit code
	if (hasErrors || scenarioFailures > 0) {
		process.exit(1);
	}

	if (hasWarnings) {
		console.log(`\nValid with warnings.`);
	} else {
		console.log(`\nValid.`);
	}
	process.exit(0);
}

main();
