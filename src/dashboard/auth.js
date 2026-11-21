// "Log in with Discord" for the public dashboard.
//
// Discord only tells us who someone is (the "identify" scope). What they can manage is checked
// through the bot on every request, so losing Administrator in a server takes effect immediately.
// Discord's access token is revoked straight after login and never stored.
const crypto = require('node:crypto');
const { PermissionFlagsBits } = require('discord.js');

const DISCORD_API = 'https://discord.com/api/v10';
const SESSION_COOKIE = '__Host-silvered_session';
const STATE_COOKIE = '__Host-silvered_oauth';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const STATE_SECONDS = 10 * 60;

const sha256 = text => crypto.createHash('sha256').update(text).digest();
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && crypto.timingSafeEqual(sha256(a), sha256(b));
const cookie = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

function readCookies(req) {
	const cookies = {};
	for (const part of (req.headers.cookie ?? '').split(';')) {
		const i = part.indexOf('=');
		if (i > 0) cookies[part.slice(0, i).trim()] = part.slice(i + 1).trim();
	}
	return cookies;
}

function redirect(res, location, cookies = []) {
	res.writeHead(302, {
		Location: location,
		'Set-Cookie': cookies,
		'Cache-Control': 'no-store',
		'Referrer-Policy': 'no-referrer',
	});
	res.end();
}

// Server owners count too, because discord.js treats them as having every permission.
async function canManageGuild(guild, userId) {
	const member = await guild.members.fetch(userId).catch(() => null);
	return Boolean(member?.permissions.has(PermissionFlagsBits.Administrator));
}

async function manageableGuilds(client, userId) {
	const guilds = [...client.guilds.cache.values()];
	const allowed = await Promise.all(guilds.map(g => canManageGuild(g, userId)));
	return guilds.filter((_, i) => allowed[i]);
}

async function discordJson(url, options, step) {
	const res = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
	if (!res.ok) throw new Error(`${step} failed with status ${res.status}`);
	return res.json();
}

async function fetchDiscordUser({ clientId, clientSecret, redirectUri }, code) {
	const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
	const headers = { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' };
	const token = await discordJson(`${DISCORD_API}/oauth2/token`, {
		method: 'POST',
		headers,
		body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
	}, 'Token exchange');
	try {
		return await discordJson(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${token.access_token}` } }, 'User lookup');
	} finally {
		fetch(`${DISCORD_API}/oauth2/token/revoke`, {
			method: 'POST',
			headers,
			body: new URLSearchParams({ token: token.access_token, token_type_hint: 'access_token' }),
			signal: AbortSignal.timeout(10000),
		}).catch(() => {});
	}
}

function createDiscordAuth(client, { clientId, clientSecret, publicUrl }) {
	const redirectUri = `${publicUrl}/dashboard/auth/callback`;
	const sessions = new Map(); // sha256(session token) -> { user, expires }

	function sessionId(req) {
		const token = readCookies(req)[SESSION_COOKIE];
		return token ? sha256(token).toString('hex') : null;
	}

	function createSession(user) {
		const now = Date.now();
		for (const [id, s] of sessions) if (now > s.expires) sessions.delete(id);
		const token = crypto.randomBytes(32).toString('base64url');
		sessions.set(sha256(token).toString('hex'), { user, expires: now + SESSION_MS });
		return token;
	}

	return {
		redirectUri,

		viewer(req) {
			const id = sessionId(req);
			const session = id ? sessions.get(id) : null;
			if (!session) return null;
			if (Date.now() > session.expires) {
				sessions.delete(id);
				return null;
			}
			return session.user;
		},

		logout(req, res) {
			const id = sessionId(req);
			if (id) sessions.delete(id);
			res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, '', 0));
		},

		async handleRoute(req, res, url) {
			if (req.method !== 'GET') return false;

			if (url.pathname === '/dashboard/auth/login') {
				const state = crypto.randomBytes(24).toString('base64url');
				const params = new URLSearchParams({
					client_id: clientId,
					response_type: 'code',
					redirect_uri: redirectUri,
					scope: 'identify',
					state,
					prompt: 'none',
				});
				redirect(res, `https://discord.com/oauth2/authorize?${params}`, [cookie(STATE_COOKIE, state, STATE_SECONDS)]);
				return true;
			}

			if (url.pathname === '/dashboard/auth/callback') {
				const clearState = cookie(STATE_COOKIE, '', 0);
				const fail = reason => redirect(res, `/dashboard/?login=${reason}`, [clearState]);
				const code = url.searchParams.get('code');
				if (!safeEqual(url.searchParams.get('state'), readCookies(req)[STATE_COOKIE])) return fail('failed'), true;
				if (url.searchParams.get('error') || !code) return fail('denied'), true;
				if (!client.isReady()) return fail('starting'), true;

				let user;
				try {
					user = await fetchDiscordUser({ clientId, clientSecret, redirectUri }, code);
				} catch (e) {
					console.error('[dashboard] Discord login failed:', e.message);
					return fail('failed'), true;
				}
				if (!(await manageableGuilds(client, user.id)).length) return fail('no-access'), true;

				const token = createSession({ id: user.id, username: user.username, displayName: user.global_name || user.username });
				redirect(res, '/dashboard/', [clearState, cookie(SESSION_COOKIE, token, SESSION_MS / 1000)]);
				return true;
			}
			return false;
		},
	};
}

module.exports = { createDiscordAuth, canManageGuild, manageableGuilds };
