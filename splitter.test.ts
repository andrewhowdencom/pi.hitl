import { describe, it } from "node:test";
import assert from "node:assert";
import { splitBashCommand } from "./splitter.ts";

describe("splitBashCommand", () => {
	it("returns a single segment for a simple command", () => {
		assert.deepStrictEqual(splitBashCommand("ls -la"), ["ls -la"]);
	});

	it("splits on pipe", () => {
		assert.deepStrictEqual(splitBashCommand("tail -n1000 | head -20"), [
			"tail -n1000",
			"head -20",
		]);
	});

	it("splits on logical AND", () => {
		assert.deepStrictEqual(splitBashCommand("ls && rm"), ["ls", "rm"]);
	});

	it("splits on logical OR", () => {
		assert.deepStrictEqual(splitBashCommand("foo || bar"), ["foo", "bar"]);
	});

	it("splits on semicolon", () => {
		assert.deepStrictEqual(splitBashCommand("echo a; echo b"), [
			"echo a",
			"echo b",
		]);
	});

	it("splits on background ampersand", () => {
		assert.deepStrictEqual(splitBashCommand("foo & bar"), ["foo", "bar"]);
	});

	it("does not split inside double quotes", () => {
		assert.deepStrictEqual(splitBashCommand('echo "a && b"'), [
			'echo "a && b"',
		]);
	});

	it("does not split inside single quotes", () => {
		assert.deepStrictEqual(splitBashCommand("echo 'a && b'"), [
			"echo 'a && b'",
		]);
	});

	it("does not split on escaped semicolon", () => {
		assert.deepStrictEqual(splitBashCommand("echo a\\;b"), ["echo a\\;b"]);
	});

	it("does not split on fully escaped &&", () => {
		assert.deepStrictEqual(splitBashCommand("echo a \\&\\& b"), [
			"echo a \\&\\& b",
		]);
	});

	it("splits when only first & is escaped", () => {
		assert.deepStrictEqual(splitBashCommand("echo a \\&& b"), [
			"echo a \\&",
			"b",
		]);
	});

	it("splits on newline", () => {
		assert.deepStrictEqual(splitBashCommand("echo a\necho b"), [
			"echo a",
			"echo b",
		]);
	});

	it("splits on carriage return newline", () => {
		assert.deepStrictEqual(splitBashCommand("echo a\r\necho b"), [
			"echo a",
			"echo b",
		]);
	});

	it("splits on pipe with stderr", () => {
		assert.deepStrictEqual(splitBashCommand("foo |& bar"), ["foo", "bar"]);
	});

	it("does not split on redirect operators", () => {
		assert.deepStrictEqual(splitBashCommand("ls > file"), ["ls > file"]);
		assert.deepStrictEqual(splitBashCommand("ls >> file"), ["ls >> file"]);
		assert.deepStrictEqual(splitBashCommand("ls < file"), ["ls < file"]);
	});

	it("does not split on descriptor redirect", () => {
		assert.deepStrictEqual(splitBashCommand("ls 2>&1"), ["ls 2>&1"]);
	});

	it("does not split on &> redirect", () => {
		assert.deepStrictEqual(splitBashCommand("ls &> file"), ["ls &> file"]);
	});

	it("filters empty segments from consecutive separators", () => {
		assert.deepStrictEqual(splitBashCommand("foo && && bar"), ["foo", "bar"]);
	});

	it("handles operators without surrounding spaces", () => {
		assert.deepStrictEqual(splitBashCommand("foo&&bar"), ["foo", "bar"]);
		assert.deepStrictEqual(splitBashCommand("foo||bar"), ["foo", "bar"]);
		assert.deepStrictEqual(splitBashCommand("foo;bar"), ["foo", "bar"]);
		assert.deepStrictEqual(splitBashCommand("foo|bar"), ["foo", "bar"]);
	});

	it("handles mixed quotes and operators", () => {
		assert.deepStrictEqual(
			splitBashCommand('echo "hello | world" && ls'),
			['echo "hello | world"', "ls"],
		);
	});

	it("handles double-escaped backslash before operator", () => {
		assert.deepStrictEqual(splitBashCommand("echo a \\\\\\&& b"), [
			"echo a \\\\\\&",
			"b",
		]);
	});

	it("handles trailing separator", () => {
		assert.deepStrictEqual(splitBashCommand("foo &&"), ["foo"]);
	});

	it("handles leading separator", () => {
		assert.deepStrictEqual(splitBashCommand("&& foo"), ["foo"]);
	});

	it("returns empty array for empty string", () => {
		assert.deepStrictEqual(splitBashCommand(""), []);
	});

	it("returns empty array for whitespace-only string", () => {
		assert.deepStrictEqual(splitBashCommand("   "), []);
	});

	it("handles case terminator ;;", () => {
		assert.deepStrictEqual(splitBashCommand("foo ;; bar"), ["foo", "bar"]);
	});

	it("does not split on redirect inside quoted string", () => {
		assert.deepStrictEqual(splitBashCommand('echo "> file" && ls'), [
			'echo "> file"',
			"ls",
		]);
	});

	it("does not split inside back-ticks", () => {
		assert.deepStrictEqual(splitBashCommand("echo `foo && bar` && ls"), [
			"echo `foo && bar`",
			"ls",
		]);
	});

	it("does not split inside command substitution $()", () => {
		assert.deepStrictEqual(splitBashCommand("echo $(foo && bar) && ls"), [
			"echo $(foo && bar)",
			"ls",
		]);
	});

	it("does not split inside arithmetic expansion $((...))", () => {
		assert.deepStrictEqual(splitBashCommand("echo $((1 && 2)) && ls"), [
			"echo $((1 && 2))",
			"ls",
		]);
	});

	it("handles nested command substitution", () => {
		assert.deepStrictEqual(
			splitBashCommand("echo $(foo $(bar && baz)) && ls"),
			["echo $(foo $(bar && baz))", "ls"],
		);
	});

	it("does not split inside heredoc body", () => {
		assert.deepStrictEqual(
			splitBashCommand("cat <<EOF\nfoo && bar\nEOF && ls"),
			["cat <<EOF\nfoo && bar\nEOF", "ls"],
		);
	});

	it("does not split inside heredoc with dash", () => {
		assert.deepStrictEqual(
			splitBashCommand("cat <<-EOF\nfoo && bar\nEOF && ls"),
			["cat <<-EOF\nfoo && bar\nEOF", "ls"],
		);
	});

	it("handles consecutive separators producing empty segments", () => {
		assert.deepStrictEqual(splitBashCommand("foo && && bar"), ["foo", "bar"]);
	});
});
