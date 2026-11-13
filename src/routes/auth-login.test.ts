import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi
} from "vitest";
import request from "supertest";
import { SESSION_MAX_AGE_MS } from "../auth/session.ts";
import { REFRESH_COOKIE, SESSION_COOKIE } from "../auth/session-cookie.ts";
import { app, testConfig } from "../../test/app.ts";
import {
	clearDatabase,
	collection,
	startDatabase,
	stopDatabase
} from "../../test/database.ts";
import { clearRedis, storedSessions } from "../../test/redis.ts";

vi.mock(
	import("../helpers/redis-manager.ts"),
	() => import("../../test/redis.ts")
);

beforeAll(startDatabase);
afterEach(clearDatabase);
afterEach(clearRedis);
afterAll(stopDatabase);

const USER_ID = "3000000000000000003";
const ROLE_ID = "4000000000000000004";
const OTHER_SERVER_ID = "5000000000000000005";
const STATE = "expected-state";
const ADMIN_URL = `${testConfig.FRONTEND_URL}/admin`;
const LOGIN_PAGE_URL = `${testConfig.FRONTEND_URL}/admin/login`;

// An Error is thrown by fetch, as a network failure or timeout would be.
type DiscordReply = Response | Error;

interface DiscordReplies {
	token: DiscordReply;
	user: DiscordReply;
	member: DiscordReply;
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" }
	});
}

function healthyDiscord(): DiscordReplies {
	return {
		token: json({ access_token: "discord-token", token_type: "Bearer" }),
		user: json({ id: USER_ID, username: "editor", avatar: "abc" }),
		member: json({ roles: [ROLE_ID] })
	};
}

// Stubs fetch with Discord's answers, picked by URL.
function stubDiscord(overrides: Partial<DiscordReplies> = {}) {
	const replies = { ...healthyDiscord(), ...overrides };

	return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
		const url = String(input);
		const reply = url.endsWith("/oauth2/token")
			? replies.token
			: url.endsWith("/users/@me")
				? replies.user
				: url.endsWith(`/guilds/${testConfig.DISCORD_GUILD_ID}/member`)
					? replies.member
					: json({ message: "unexpected URL" }, 500);
		if (reply instanceof Error) {
			throw reply;
		}
		return reply;
	});
}

function grant(subjectType: string, subjectId: string) {
	return collection("auth", "access-grants").insertOne({
		subjectType,
		subjectId,
		createdBy: "6000000000000000006",
		createdAt: new Date()
	});
}

// Discord's redirect back, with the state cookie set by /auth/discord.
// `null`: no state cookie.
function callback(query: string, stateCookie: string | null = STATE) {
	const req = request(app).get(`/auth/discord/callback?${query}`);
	return stateCookie ? req.set("Cookie", `login_state=${stateCookie}`) : req;
}

function successfulCallback() {
	return callback(`code=abc&state=${STATE}`);
}

function findCookie(res: request.Response, name: string) {
	return (res.get("Set-Cookie") ?? []).find((cookie) =>
		cookie.startsWith(`${name}=`)
	);
}

async function expectLoginError(
	res: request.Response,
	code: string
): Promise<void> {
	expect(res.status).toBe(302);
	expect(res.headers["location"]).toBe(`${LOGIN_PAGE_URL}?error=${code}`);
	expect(findCookie(res, SESSION_COOKIE)).toBeUndefined();
	expect(findCookie(res, REFRESH_COOKIE)).toBeUndefined();
	expect(storedSessions().size).toBe(0);
}

beforeEach(() => {
	// Failed logins are logged; keep the test output clean.
	vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("GET /auth/discord", () => {
	it("redirects to Discord with a state that it also sets as a cookie", async () => {
		const res = await request(app).get("/auth/discord").expect(302);

		const location = new URL(res.headers["location"] ?? "");
		expect(location.origin + location.pathname).toBe(
			"https://discord.com/oauth2/authorize"
		);
		expect(Object.fromEntries(location.searchParams)).toMatchObject({
			response_type: "code",
			client_id: testConfig.DISCORD_CLIENT_ID,
			scope: "identify guilds.members.read",
			redirect_uri: testConfig.DISCORD_REDIRECT_URI
		});

		const state = location.searchParams.get("state");
		expect(state).toMatch(/^[\w-]{43}$/);
		const stateCookie = findCookie(res, "login_state");
		expect(stateCookie).toContain(`login_state=${state};`);
		expect(stateCookie).toMatch(/Max-Age=600;.*HttpOnly.*SameSite=Lax/);
	});

	it("uses a new state every time", async () => {
		const [first, second] = await Promise.all([
			request(app).get("/auth/discord"),
			request(app).get("/auth/discord")
		]);

		expect(first.headers["location"]).not.toBe(second.headers["location"]);
	});
});

describe("GET /auth/discord/callback", () => {
	it.each([
		["user", USER_ID],
		["role", ROLE_ID]
	])(
		"logs in a user matched by a %s grant",
		async (subjectType, subjectId) => {
			stubDiscord();
			await grant(subjectType, subjectId);
			const loginAt = Date.parse("2026-01-01T00:00:00Z");
			vi.useFakeTimers({ toFake: ["Date"], now: loginAt });

			const res = await successfulCallback().expect(302);

			expect(res.headers["location"]).toBe(ADMIN_URL);
			expect(findCookie(res, "login_state")).toMatch(
				/^login_state=;.*Expires=Thu, 01 Jan 1970/
			);
			const session = findCookie(res, SESSION_COOKIE);
			expect(session).toMatch(/HttpOnly/);

			// The new session works, and Discord's token went nowhere.
			const token = /^session=([^;]+)/.exec(session ?? "")?.[1] ?? "";
			const me = await request(app)
				.get("/auth/me")
				.set("Cookie", `${SESSION_COOKIE}=${token}`)
				.expect(200);
			expect(me.body).toEqual({
				id: USER_ID,
				username: "editor",
				avatarUrl: `https://cdn.discordapp.com/avatars/${USER_ID}/abc.png`
			});

			// A session is stored under the refresh token's session ID.
			const refreshCookie = findCookie(res, REFRESH_COOKIE);
			expect(refreshCookie).toMatch(/Path=\/auth;.*HttpOnly/);
			const sessionId = /^refresh_token=([\w-]+)\./.exec(
				refreshCookie ?? ""
			)?.[1];
			expect([...storedSessions()]).toEqual([
				[
					sessionId,
					{
						fields: {
							discordUserId: USER_ID,
							username: "editor",
							avatarUrl: `https://cdn.discordapp.com/avatars/${USER_ID}/abc.png`,
							refreshTokenHash: expect.any(String),
							createdAt: new Date(loginAt).toISOString(),
							loginAt: new Date(loginAt).toISOString()
						},
						expiresAt: loginAt + SESSION_MAX_AGE_MS
					}
				]
			]);
		}
	);

	it("sends the code and app credentials to Discord", async () => {
		const fetch = stubDiscord();
		await grant("user", USER_ID);

		await successfulCallback().expect(302);

		const [url, init] = fetch.mock.calls[0] ?? [];
		expect(url).toBe("https://discord.com/api/v10/oauth2/token");
		expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({
			grant_type: "authorization_code",
			code: "abc",
			redirect_uri: testConfig.DISCORD_REDIRECT_URI
		});
		const credentials = Buffer.from(
			`${testConfig.DISCORD_CLIENT_ID}:${testConfig.DISCORD_CLIENT_SECRET}`
		).toString("base64");
		// Bounded by a timeout.
		expect(init?.signal).toBeInstanceOf(AbortSignal);
		expect(init?.headers).toEqual({
			Authorization: `Basic ${credentials}`
		});
	});

	describe("rejected by the user", () => {
		it("access-denied when the user cancels on Discord", async () => {
			const fetch = stubDiscord();

			const res = await callback(`error=access_denied&state=${STATE}`);

			await expectLoginError(res, "access-denied");
			expect(fetch).not.toHaveBeenCalled();
		});
	});

	describe("rejected by the server", () => {
		it.each([
			["no state cookie", `code=abc&state=${STATE}`, null],
			["a mismatched state", "code=abc&state=other-state", STATE],
			["no state", "code=abc", STATE],
			["no code", `state=${STATE}`, STATE],
			["a repeated parameter", `code=a&code=b&state=${STATE}`, STATE],
			// Not trusted (or logged as Discord's) without a login we started.
			["an OAuth error without a state", "error=invalid_scope", STATE],
			["access_denied without a state", "error=access_denied", STATE]
		])("invalid-request for %s", async (_, query, stateCookie) => {
			const fetch = stubDiscord();

			const res = await callback(query, stateCookie);

			await expectLoginError(res, "invalid-request");
			expect(fetch).not.toHaveBeenCalled();
		});

		it("not-authorized when no grant matches", async () => {
			stubDiscord();
			await grant("user", "7000000000000000007");
			await grant("role", "7000000000000000008");

			await expectLoginError(
				await successfulCallback(),
				"not-authorized"
			);
		});

		// Server grants aren't supported: being in a server is never enough,
		// even if such an entry is added to the database by hand.
		it.each([
			["The Rift", testConfig.DISCORD_GUILD_ID],
			["another server", OTHER_SERVER_ID]
		])(
			"not-authorized for a server grant naming %s",
			async (_, serverId) => {
				stubDiscord();
				await grant("server", serverId);

				await expectLoginError(
					await successfulCallback(),
					"not-authorized"
				);
			}
		);

		it("not-authorized for a role grant naming @everyone (the server's ID)", async () => {
			stubDiscord({
				member: json({ roles: [testConfig.DISCORD_GUILD_ID] })
			});
			await grant("role", testConfig.DISCORD_GUILD_ID);

			await expectLoginError(
				await successfulCallback(),
				"not-authorized"
			);
		});

		it("not-authorized when there are no grants at all", async () => {
			stubDiscord();

			await expectLoginError(
				await successfulCallback(),
				"not-authorized"
			);
		});

		it("not-authorized for a role grant when not in The Rift's server", async () => {
			stubDiscord({ member: json({ message: "Unknown Guild" }, 404) });
			await grant("role", ROLE_ID);

			await expectLoginError(
				await successfulCallback(),
				"not-authorized"
			);
		});

		it("still logs in a user grant when not in The Rift's server", async () => {
			stubDiscord({ member: json({ message: "Unknown Guild" }, 404) });
			await grant("user", USER_ID);

			const res = await successfulCallback().expect(302);

			expect(res.headers["location"]).toBe(ADMIN_URL);
		});
	});

	describe("Discord's API failing", () => {
		it.each<[string, Partial<DiscordReplies>]>([
			["the token exchange fails", { token: json({}, 500) }],
			[
				"an invalid code",
				{ token: json({ error: "invalid_grant" }, 400) }
			],
			["a network error", { user: new TypeError("fetch failed") }],
			[
				"a timeout",
				{ user: new DOMException("timed out", "TimeoutError") }
			],
			["rate limited", { member: json({ retry_after: 1 }, 429) }],
			["an unexpected body", { member: json({ roles: "not a list" }) }],
			["invalid JSON", { user: new Response("<html>", { status: 200 }) }]
		])("discord-unavailable when %s", async (_, overrides) => {
			stubDiscord(overrides);
			await grant("user", USER_ID);

			await expectLoginError(
				await successfulCallback(),
				"discord-unavailable"
			);
		});
	});

	describe("this server failing", () => {
		it("server-error when Discord rejects the authorize request", async () => {
			stubDiscord();

			const res = await callback(`error=invalid_scope&state=${STATE}`);

			await expectLoginError(res, "server-error");
		});
	});
});
