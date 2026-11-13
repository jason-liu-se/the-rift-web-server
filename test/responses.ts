import { expect, vi } from "vitest";
import request from "supertest";
import type { Types } from "mongoose";
import { app } from "./app.ts";

// Stored data that breaks the response contract is a server fault: expects a
// 500 with the generic error body, and the details logged rather than sent.
export async function expectContractError(path: string): Promise<void> {
	const consoleError = vi
		.spyOn(console, "error")
		.mockImplementation(() => undefined);

	const res = await request(app).get(path).expect(500);

	expect(res.body).toEqual({
		error: "ERROR: an unexpected server error occurred"
	});
	expect(String(consoleError.mock.calls[0])).toMatch(
		/response breaks the API contract/
	);
	consoleError.mockRestore();
}

// The body a route sends for a seeded document: its `_id` as the hex string `id`.
export function withId<T extends object>({
	_id,
	...fields
}: T & { _id: Types.ObjectId }) {
	return { id: _id.toHexString(), ...fields };
}
