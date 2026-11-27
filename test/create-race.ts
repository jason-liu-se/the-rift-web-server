// A create racing a delete: an item with the same createId (a first attempt
// of the same create) is stored just before the next insert, and deleted
// just after it, so the insert meets the createId but no item is left to
// return as a repeat. `method` is the model's insert: items' `insertMany`, or
// collections' `create`.
import mongoose from "mongoose";
import { vi } from "vitest";
import { collection } from "./database.ts";

export function raceCreateWithDelete(
	database: string,
	name: string,
	stored: { readonly createId: string } & Record<string, unknown>,
	method: "insertMany" | "create" = "insertMany"
): void {
	const insert = mongoose.Model[method];
	vi.spyOn(mongoose.Model, method).mockImplementationOnce(async function (
		this: unknown,
		...args: unknown[]
	) {
		const documents = collection(database, name);
		await documents.insertOne({ ...stored });
		try {
			return await (insert as (...a: unknown[]) => unknown).apply(
				this,
				args
			);
		} finally {
			await documents.deleteOne({ createId: stored.createId });
		}
	} as never);
}
