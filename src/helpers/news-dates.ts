// The rules for a news post's date, and for `editedAt`, as pure functions of
// the stored post, what the editor sent, and the time. A post is public when
// visible and its date has come; going live by date writes nothing, so
// `wasPublic` (whether it had been public by its last write) is updated on
// every write instead.
import { BadRequestError } from "../errors/bad-request-error.ts";

interface NewsState {
	readonly visible?: boolean;
	readonly date?: Date;
	readonly wasPublic?: boolean;
	readonly title?: unknown;
	readonly content?: unknown;
}

export interface NewsChanges {
	readonly visible?: boolean;
	/** `"now"`, an ISO date-time, or undefined (unchanged). */
	readonly date?: string;
	readonly title?: string;
	readonly content?: string;
}

function isPublic({ visible, date }: NewsState, now: Date): boolean {
	return visible !== false && date !== undefined && date <= now;
}

// When a news post goes live, from the date requested: absent keeps the
// stored date (now for a create), "now" is the server's time, a future date
// schedules it, and the stored date itself is allowed so a live post keeps its
// original date. Any other past date is a 400: nobody can backdate a post, and
// the client's clock never matters. Undefined means "unchanged".
export function resolveNewsDate(
	requestedDate: string | undefined,
	storedDate: Date | undefined,
	serverTime: Date
): Date | undefined {
	if (requestedDate === undefined) {
		return storedDate ? undefined : serverTime;
	}
	if (requestedDate === "now") {
		return serverTime;
	}
	const date = new Date(requestedDate);
	if (storedDate && date.getTime() === storedDate.getTime()) {
		return undefined;
	}
	if (date <= serverTime) {
		throw new BadRequestError(
			"date: must be now, in the future, or the post's current date"
		);
	}
	return date;
}

// The date fields a new post is stored with.
export function newsCreateFields(
	{ visible = true, date }: NewsChanges,
	now: Date
): { date: Date; wasPublic: boolean } {
	const resolved = resolveNewsDate(date, undefined, now) ?? now;
	return {
		date: resolved,
		wasPublic: isPublic({ visible, date: resolved }, now)
	};
}

// The date fields an update changes: the date (if it moves), `wasPublic`
// (once the post has been public), and `editedAt` (when the title or content
// changes after the post had been public, whether by a write or its date).
export function newsUpdateFields(
	current: NewsState,
	changes: NewsChanges,
	now: Date
): { date?: Date; wasPublic?: true; editedAt?: Date } {
	const date = resolveNewsDate(changes.date, current.date, now);
	const hadBeenPublic = current.wasPublic === true || isPublic(current, now);
	const next = {
		visible: changes.visible ?? current.visible,
		date: date ?? current.date
	};
	const edited =
		(changes.title !== undefined && changes.title !== current.title) ||
		(changes.content !== undefined && changes.content !== current.content);

	return {
		...(date && { date }),
		...((hadBeenPublic || isPublic(next, now)) && { wasPublic: true }),
		...(hadBeenPublic && edited && { editedAt: now })
	};
}
