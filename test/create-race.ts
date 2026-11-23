// A create racing a delete: an item with the same createId (a first attempt
// of the same create) is stored just before the next insert, and deleted
// just after it, so the insert meets the createId but no item is left to
// return as a repeat.
import mongoose from "mongoose";
import { vi } from "vitest";
import { collection } from "./database.ts";

export function raceCreateWithDelete(
	database: string,
	name: string,
	stored: { readonly createId: string } & Record<string, unknown>
): void {
	const insertMany = mongoose.Model.insertMany;
	vi.spyOn(mongoose.Model, "insertMany").mockImplementationOnce(
		async function (this: unknown, ...args: unknown[]) {
			const documents = collection(database, name);
			await documents.insertOne({ ...stored });
			try {
				return await (insertMany as (...a: unknown[]) => unknown).apply(
					this,
					args
				);
			} finally {
				await documents.deleteOne({ createId: stored.createId });
			}
		} as never
	);
}
