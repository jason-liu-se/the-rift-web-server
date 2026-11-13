// Discord's OAuth2 and user API: every network call the login makes. Responses
// are validated with Zod. Any failure on Discord's side (network, non-2xx, or
// an unexpected body) throws DiscordApiError, so the login can tell Discord's
// faults apart from its own decisions.
import * as z from "zod";
import type { SessionUser } from "../contract/api-responses.ts";

const DISCORD_API_URL = "https://discord.com/api/v10";
const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const DISCORD_AVATAR_URL = "https://cdn.discordapp.com/avatars";
const HTTP_NOT_FOUND = 404;

// identify: the user; guilds: their servers; guilds.members.read: their roles
// in The Rift's server.
const SCOPES = "identify guilds guilds.members.read";

export interface DiscordOAuthConfig {
	readonly DISCORD_CLIENT_ID: string;
	readonly DISCORD_CLIENT_SECRET: string;
	readonly DISCORD_REDIRECT_URI: string;
}

// Who the user is and what an access grant can match them by.
export interface DiscordIdentity {
	readonly user: SessionUser;
	readonly serverIds: string[];
	/** Roles in the server passed to getIdentity; empty if not a member. */
	readonly roleIds: string[];
}

export class DiscordApiError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "DiscordApiError";
	}
}

const tokenResponse = z.object({ access_token: z.string().min(1) });

const userResponse = z.object({
	id: z.string(),
	username: z.string(),
	avatar: z.string().nullish()
});

const guildsResponse = z.array(z.object({ id: z.string() }));

const memberResponse = z.object({ roles: z.array(z.string()) });

export function discordAuthorizeUrl(
	config: DiscordOAuthConfig,
	state: string
): string {
	const params = new URLSearchParams({
		response_type: "code",
		client_id: config.DISCORD_CLIENT_ID,
		scope: SCOPES,
		redirect_uri: config.DISCORD_REDIRECT_URI,
		state
	});
	return `${DISCORD_AUTHORIZE_URL}?${params}`;
}

// Exchanges the code from Discord's redirect for an access token.
export async function exchangeCode(
	code: string,
	config: DiscordOAuthConfig
): Promise<string> {
	const response = await request(`${DISCORD_API_URL}/oauth2/token`, {
		method: "POST",
		headers: {
			Authorization: `Basic ${Buffer.from(
				`${config.DISCORD_CLIENT_ID}:${config.DISCORD_CLIENT_SECRET}`
			).toString("base64")}`
		},
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: config.DISCORD_REDIRECT_URI
		})
	});
	const { access_token } = await parseBody(response, tokenResponse);
	return access_token;
}

// The token's user, their servers, and their roles in `guildId`, in parallel.
export async function getIdentity(
	accessToken: string,
	guildId: string
): Promise<DiscordIdentity> {
	const [user, guilds, roleIds] = await Promise.all([
		getAsUser("/users/@me", accessToken, userResponse),
		getAsUser("/users/@me/guilds", accessToken, guildsResponse),
		getRoleIds(accessToken, guildId)
	]);

	return {
		user: {
			id: user.id,
			username: user.username,
			...(user.avatar && {
				avatarUrl: `${DISCORD_AVATAR_URL}/${user.id}/${user.avatar}.png`
			})
		},
		serverIds: guilds.map(({ id }) => id),
		roleIds
	};
}

// Discord answers 404 when the user isn't a member of the server: no roles.
async function getRoleIds(
	accessToken: string,
	guildId: string
): Promise<string[]> {
	const response = await request(
		`${DISCORD_API_URL}/users/@me/guilds/${guildId}/member`,
		{ headers: bearer(accessToken) },
		[HTTP_NOT_FOUND]
	);
	if (response.status === HTTP_NOT_FOUND) {
		return [];
	}
	const { roles } = await parseBody(response, memberResponse);
	return roles;
}

async function getAsUser<T>(
	path: string,
	accessToken: string,
	schema: z.ZodType<T>
): Promise<T> {
	const response = await request(`${DISCORD_API_URL}${path}`, {
		headers: bearer(accessToken)
	});
	return parseBody(response, schema);
}

function bearer(accessToken: string): Record<string, string> {
	return { Authorization: `Bearer ${accessToken}` };
}

// Throws DiscordApiError on a network failure or a non-2xx status that isn't
// in `allowedStatuses`.
async function request(
	url: string,
	init: RequestInit,
	allowedStatuses: number[] = []
): Promise<Response> {
	let response: Response;
	try {
		response = await fetch(url, init);
	} catch (error) {
		throw new DiscordApiError(`request to ${url} failed`, { cause: error });
	}

	if (!response.ok && !allowedStatuses.includes(response.status)) {
		throw new DiscordApiError(
			`${url} answered ${response.status}: ${await response.text()}`
		);
	}
	return response;
}

async function parseBody<T>(
	response: Response,
	schema: z.ZodType<T>
): Promise<T> {
	let body: unknown;
	try {
		body = await response.json();
	} catch (error) {
		throw new DiscordApiError(`${response.url} sent invalid JSON`, {
			cause: error
		});
	}

	const result = schema.safeParse(body);
	if (!result.success) {
		throw new DiscordApiError(
			`${response.url} sent an unexpected body:\n${z.prettifyError(result.error)}`
		);
	}
	return result.data;
}
