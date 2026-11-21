// Dashboard login through Discord, with no OAuth client secret.
//
// /dashboard sends an Administrator a private, single-use link. Opening it starts a browser session
// for that Discord account. What they can manage is checked through the bot on every request,
// so losing Administrator in a server takes effect immediately.
const crypto = require('node:crypto');
const { PermissionFlagsBits } = require('discord.js');

const SESSION_COOKIE = '__Host-silvered_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const LINK_MS = 5 * 60 * 1000;

const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const cookie = (value, maxAge) => `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

function readSessionToken(req) {
	for (const part of (req.headers.cookie ?? '').split(';')) {
		const i = part.indexOf('=');
		if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) return part.slice(i + 1).trim();
	}
	return null;
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

function sweep(map) {
	const now = Date.now();
	for (const [id, entry] of map) if (now > entry.expires) map.delete(id);
}

function createDiscordAuth(client, { publicUrl }) {
	const links = new Map(); // sha256(link token) -> { user, expires }
	const sessions = new Map(); // sha256(session token) -> { user, expires }

	return {
		createLoginLink(user) {
			sweep(links);
			for (const [id, link] of links) if (link.user.id === user.id) links.delete(id);
			const token = crypto.randomBytes(32).toString('base64url');
			links.set(sha256(token), {
				user: { id: user.id, username: user.username, displayName: user.globalName || user.username },
				expires: Date.now() + LINK_MS,
			});
			// The token stays in the URL fragment, so it never reaches server logs or link previews.
			return `${publicUrl}/dashboard/#login=${token}`;
		},

		redeem(res, token) {
			if (typeof token !== 'string' || token.length > 100) return false;
			const id = sha256(token);
			const link = links.get(id);
			links.delete(id);
			if (!link || Date.now() > link.expires) return false;
			sweep(sessions);
			const sessionToken = crypto.randomBytes(32).toString('base64url');
			sessions.set(sha256(sessionToken), { user: link.user, expires: Date.now() + SESSION_MS });
			res.setHeader('Set-Cookie', cookie(sessionToken, SESSION_MS / 1000));
			return true;
		},

		viewer(req) {
			const token = readSessionToken(req);
			if (!token) return null;
			const id = sha256(token);
			const session = sessions.get(id);
			if (!session) return null;
			if (Date.now() > session.expires) {
				sessions.delete(id);
				return null;
			}
			return session.user;
		},

		logout(req, res) {
			const token = readSessionToken(req);
			if (token) sessions.delete(sha256(token));
			res.setHeader('Set-Cookie', cookie('', 0));
		},
	};
}

module.exports = { createDiscordAuth, canManageGuild, manageableGuilds };
