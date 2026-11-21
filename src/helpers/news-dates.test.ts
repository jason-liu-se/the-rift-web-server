import { describe, expect, it } from "vitest";
import { BadRequestError } from "../errors/bad-request-error.ts";
import {
	newsCreateFields,
	newsUpdateFields,
	resolveNewsDate
} from "./news-dates.ts";

const NOW = new Date("2026-06-01T00:00:00.000Z");
const PAST = new Date("2026-01-01T00:00:00.000Z");
const FUTURE = "2026-07-01T00:00:00.000Z";

describe("resolveNewsDate", () => {
	it("is now for a create without a date, unchanged for an update", () => {
		expect(resolveNewsDate(undefined, undefined, NOW)).toEqual(NOW);
		expect(resolveNewsDate(undefined, PAST, NOW)).toBeUndefined();
	});

	it("takes now and future dates", () => {
		expect(resolveNewsDate("now", PAST, NOW)).toEqual(NOW);
		expect(resolveNewsDate(FUTURE, PAST, NOW)).toEqual(new Date(FUTURE));
	});

	it("keeps a live post's own past date", () => {
		expect(
			resolveNewsDate("2026-01-01T02:00:00+02:00", PAST, NOW)
		).toBeUndefined();
	});

	it.each([
		["a create", undefined],
		["an update", PAST]
	])("refuses any other past date on %s", (_name, current) => {
		expect(() =>
			resolveNewsDate("2025-12-31T00:00:00.000Z", current, NOW)
		).toThrow(BadRequestError);
	});
});

describe("newsCreateFields", () => {
	it("is public at once when visible and dated now", () => {
		expect(newsCreateFields({}, NOW)).toEqual({
			date: NOW,
			wasPublic: true
		});
	});

	it("isn't public yet when hidden or scheduled", () => {
		expect(newsCreateFields({ visible: false }, NOW).wasPublic).toBe(false);
		expect(newsCreateFields({ date: FUTURE }, NOW)).toEqual({
			date: new Date(FUTURE),
			wasPublic: false
		});
	});
});

describe("newsUpdateFields", () => {
	const LIVE = { visible: true, date: PAST, title: "T", content: "C" };

	it("sets editedAt when a live post's title or content changes", () => {
		expect(newsUpdateFields(LIVE, { content: "New" }, NOW)).toEqual({
			wasPublic: true,
			editedAt: NOW
		});
	});

	it("doesn't set editedAt for other changes or unchanged text", () => {
		expect(
			newsUpdateFields(LIVE, { visible: false, title: "T" }, NOW)
		).toEqual({ wasPublic: true });
	});

	it("doesn't set editedAt while the post has never been public", () => {
		const scheduled = { ...LIVE, date: new Date(FUTURE) };

		expect(newsUpdateFields(scheduled, { title: "New" }, NOW)).toEqual({});
		expect(
			newsUpdateFields({ ...LIVE, visible: false }, { title: "New" }, NOW)
		).toEqual({});
	});

	it("remembers a post went live by date, even once hidden again", () => {
		const hidden = { ...LIVE, visible: false, wasPublic: true };

		expect(newsUpdateFields(hidden, { title: "New" }, NOW)).toEqual({
			wasPublic: true,
			editedAt: NOW
		});
	});

	it("marks a post public once a write makes it public", () => {
		expect(
			newsUpdateFields(
				{ ...LIVE, visible: false },
				{ visible: true },
				NOW
			)
		).toEqual({ wasPublic: true });
	});

	it("moves a live post into the future", () => {
		expect(newsUpdateFields(LIVE, { date: FUTURE }, NOW)).toEqual({
			date: new Date(FUTURE),
			wasPublic: true
		});
	});
});
