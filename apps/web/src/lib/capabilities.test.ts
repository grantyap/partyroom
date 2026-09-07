import { describe, expect, test } from "bun:test";
import { capabilities, hasCapability } from "./capabilities";

describe("hasCapability", () => {
	test("recognizes capabilities supplied by the current user", () => {
		const user = {
			capabilities: [capabilities.rooms.list, capabilities.rooms.create],
		};

		expect(hasCapability(user, capabilities.rooms.list)).toBe(true);
		expect(hasCapability(user, capabilities.rooms.create)).toBe(true);
	});

	test("does not grant capabilities to guests or unauthenticated users", () => {
		expect(hasCapability({ capabilities: [] }, capabilities.rooms.list)).toBe(false);
		expect(hasCapability(null, capabilities.rooms.list)).toBe(false);
	});
});
