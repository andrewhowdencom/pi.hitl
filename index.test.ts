import { describe, it } from "node:test";
import assert from "node:assert";
import { confirmWithTimeout, type ConfirmResult } from "./confirm.ts";
import { parseTimeout } from "./rules.ts";

describe("confirmWithTimeout", () => {
	it("returns allowed=true when user confirms before timeout", async () => {
		const mockUI = {
			confirm: () => Promise.resolve(true),
		};
		const result = await confirmWithTimeout(mockUI, "Title", "Message", 1000);
		assert.strictEqual(result.allowed, true);
		assert.strictEqual(result.timedOut, false);
	});

	it("returns allowed=false, timedOut=false when user denies before timeout", async () => {
		const mockUI = {
			confirm: () => Promise.resolve(false),
		};
		const result = await confirmWithTimeout(mockUI, "Title", "Message", 1000);
		assert.strictEqual(result.allowed, false);
		assert.strictEqual(result.timedOut, false);
	});

	it("returns allowed=false, timedOut=true when timeout expires before response", async () => {
		const mockUI = {
			confirm: () => new Promise<boolean>(() => {
				// Never resolves — simulates a user who never responds
			}),
		};
		const result = await confirmWithTimeout(mockUI, "Title", "Message", 10);
		assert.strictEqual(result.allowed, false);
		assert.strictEqual(result.timedOut, true);
	});

	it("resolves with allowed=true when confirm resolves before timeout", async () => {
		const mockUI = {
			confirm: () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 5)),
		};
		const result = await confirmWithTimeout(mockUI, "Title", "Message", 50);
		assert.strictEqual(result.allowed, true);
		assert.strictEqual(result.timedOut, false);
	});
});

describe("parseTimeout", () => {
	it("defaults to 10000 when input is undefined", () => {
		const result = parseTimeout(undefined);
		assert.strictEqual(result.value, 10000);
		assert.strictEqual(result.warning, undefined);
	});

	it("parses 5000 correctly", () => {
		const result = parseTimeout(5000);
		assert.strictEqual(result.value, 5000);
		assert.strictEqual(result.warning, undefined);
	});

	it("accepts 0 as valid", () => {
		const result = parseTimeout(0);
		assert.strictEqual(result.value, 0);
		assert.strictEqual(result.warning, undefined);
	});

	it("falls back to 10000 and warns for negative timeout", () => {
		const result = parseTimeout(-1);
		assert.strictEqual(result.value, 10000);
		assert.ok(result.warning?.includes("Invalid timeout"));
	});

	it("falls back to 10000 and warns for non-numeric timeout", () => {
		const result = parseTimeout("abc");
		assert.strictEqual(result.value, 10000);
		assert.ok(result.warning?.includes("Invalid timeout"));
	});

	it("falls back to 10000 and warns for infinite timeout", () => {
		const result = parseTimeout(Infinity);
		assert.strictEqual(result.value, 10000);
		assert.ok(result.warning?.includes("Invalid timeout"));
	});
});
