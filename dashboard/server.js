// Local web dashboard for managing your server: send embeds, build role menus, manage roles/members.
//
// Security: it only listens on 127.0.0.1 (your own computer) and every API call needs the access key
// that's printed in the console on startup (or DASHBOARD_KEY from .env). The key is sent in a custom
// header, which also stops other websites from making requests to it from your browser.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ChannelType, EmbedBuilder, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const { botCantManage } = require('../roleUtils');
const { buildRows, makeButton } = require('../commands/roles/rolemenu');
const roleMenus = require('../roleMenus');
const storage = require('../storage');

const PUBLIC_DIR = path.join(__dirname, 'public');
const STATIC = {
	'/': ['index.html', 'text/html; charset=utf-8'],
	'/app.js': ['app.js', 'text/javascript; charset=utf-8'],
	'/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const MAX_BODY = 1024 * 1024;

// Permissions the dashboard lets you toggle on roles, grouped like Discord's own role editor.
const PERMISSION_GROUPS = [
	['General', ['ViewChannel', 'ManageChannels', 'ManageRoles', 'ManageGuildExpressions', 'ViewAuditLog', 'ManageWebhooks', 'ManageGuild']],
	['Membership', ['CreateInstantInvite', 'ChangeNickname', 'ManageNicknames', 'KickMembers', 'BanMembers', 'ModerateMembers']],
	['Text', ['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads', 'EmbedLinks', 'AttachFiles', 'AddReactions', 'UseExternalEmojis', 'UseExternalStickers', 'MentionEveryone', 'ManageMessages', 'ManageThreads', 'ReadMessageHistory', 'UseApplicationCommands', 'SendPolls']],
	['Voice', ['Connect', 'Speak', 'Stream', 'UseVAD', 'PrioritySpeaker', 'MuteMembers', 'DeafenMembers', 'MoveMembers']],
	['Advanced', ['Administrator']],
].map(([group, names]) => [group, names.filter(n => n in PermissionFlagsBits)]);

class HttpError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

// ---------- helpers ----------

function send(res, status, body, type = 'application/json; charset=utf-8') {
	res.writeHead(status, {
		'Content-Type': type,
		'Cache-Control': 'no-store',
		'X-Content-Type-Options': 'nosniff',
		'X-Frame-Options': 'DENY',
		'Referrer-Policy': 'no-referrer',
	});
	res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function readJson(req) {
	return new Promise((resolve, reject) => {
		if (!/^application\/json\b/.test(req.headers['content-type'] ?? '')) {
			return reject(new HttpError(415, 'Expected JSON.'));
		}
		let size = 0;
		const chunks = [];
		req.on('data', c => {
			size += c.length;
			if (size > MAX_BODY) {
				reject(new HttpError(413, 'Request too large.'));
				req.destroy();
			} else {
				chunks.push(c);
			}
		});
		req.on('end', () => {
			try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new HttpError(400, 'Invalid JSON.')); }
		});
		req.on('error', reject);
	});
}

function keyMatches(given, key) {
	if (typeof given !== 'string') return false;
	const a = Buffer.from(given);
	const b = Buffer.from(key);
	return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const isSnowflake = s => typeof s === 'string' && /^\d{17,20}$/.test(s);
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function parseColor(v) {
	if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xFFFFFF) return v;
	if (typeof v === 'string' && /^#?[0-9a-f]{6}$/i.test(v.trim())) return parseInt(v.trim().replace('#', ''), 16);
	return null;
}

const hex = n => `#${(n ?? 0).toString(16).padStart(6, '0')}`;

function serializeRole(guild, role) {
	return {
		id: role.id,
		name: role.name,
		color: hex(role.colors.primaryColor),
		position: role.position,
		hoist: role.hoist,
		mentionable: role.mentionable,
		managed: role.managed,
		everyone: role.id === guild.id,
		members: role.members.size,
		permissions: role.permissions.toArray(),
		// null = the bot can change/assign it, otherwise the reason it can't
		locked: role.id === guild.id ? "That's the @everyone role." : (botCantManage(guild, role) ? plain(guild, botCantManage(guild, role)) : null),
	};
}

function serializeMember(m) {
	return {
		id: m.id,
		username: m.user.username,
		displayName: m.displayName,
		avatar: m.displayAvatarURL({ size: 64 }),
		bot: m.user.bot,
		roles: m.roles.cache.filter(r => r.id !== m.guild.id).map(r => r.id),
	};
}

// Builds and validates the embed from the dashboard's form. Returns null if the embed is empty.
const URL_FIELDS = [
	['Title link', e => e.url], ['Author icon', e => e.author?.iconURL], ['Author link', e => e.author?.url],
	['Thumbnail', e => e.thumbnail], ['Image', e => e.image], ['Footer icon', e => e.footer?.iconURL],
];

function buildEmbed(e) {
	if (!e || typeof e !== 'object') return null;
	for (const [label, pick] of URL_FIELDS) {
		const v = str(pick(e), 2000);
		if (v && !/^https?:\/\/[^\s]+$/i.test(v)) throw new HttpError(400, `${label} isn't a valid link. It has to start with https:// (for images, right-click the image → Copy Image Link).`);
	}
	const embed = new EmbedBuilder();
	let used = false;
	const set = (value, fn) => { if (value) { fn(value); used = true; } };

	set(str(e.title, 256), v => embed.setTitle(v));
	set(str(e.url, 2000), v => embed.setURL(v));
	set(str(e.description, 4096), v => embed.setDescription(v));
	const color = parseColor(e.color);
	if (color !== null) embed.setColor(color);
	set(str(e.author?.name, 256), v => embed.setAuthor({ name: v, iconURL: str(e.author?.iconURL, 2000) || undefined, url: str(e.author?.url, 2000) || undefined }));
	set(str(e.thumbnail, 2000), v => embed.setThumbnail(v));
	set(str(e.image, 2000), v => embed.setImage(v));
	set(str(e.footer?.text, 2048), v => embed.setFooter({ text: v, iconURL: str(e.footer?.iconURL, 2000) || undefined }));
	if (e.timestamp) embed.setTimestamp();
	const fields = (Array.isArray(e.fields) ? e.fields : [])
		.map(f => ({ name: str(f?.name, 256), value: str(f?.value, 1024), inline: Boolean(f?.inline) }))
		.filter(f => f.name || f.value)
		.slice(0, 25)
		.map(f => ({ name: f.name || '​', value: f.value || '​', inline: f.inline }));
	if (fields.length) { embed.addFields(fields); used = true; }

	if (!used) return null;
	if (embed.length > 6000) throw new HttpError(400, 'The embed is over Discord\'s 6000 character limit.');
	return embed;
}

function textChannel(guild, channelId) {
	const channel = guild.channels.cache.get(channelId);
	if (!channel || !channel.isTextBased() || channel.isVoiceBased()) throw new HttpError(400, 'Pick a text channel.');
	const perms = channel.permissionsFor(guild.members.me);
	if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
		throw new HttpError(400, `I can't see or send messages in #${channel.name}.`);
	}
	return channel;
}

// roleUtils messages are written for Discord (role mentions, **bold**); make them readable on a web page.
function plain(guild, text) {
	return text
		.replace(/\*\*/g, '')
		.replace(/<@&(\d+)>/g, (_, id) => `"${guild.roles.cache.get(id)?.name ?? 'that role'}"`);
}

function manageableRole(guild, roleId) {
	const role = guild.roles.cache.get(roleId);
	if (!role) throw new HttpError(404, 'That role no longer exists.');
	const problem = role.id === guild.id ? "That's the @everyone role." : botCantManage(guild, role);
	if (problem) throw new HttpError(400, plain(guild, problem));
	return role;
}

// Turns a list of permission names into a bitfield, dropping ones the bot doesn't have
// (Discord refuses to let a bot grant permissions it lacks).
function allowedPermissions(guild, names) {
	const me = guild.members.me;
	const valid = (Array.isArray(names) ? names : []).filter(n => typeof n === 'string' && n in PermissionFlagsBits);
	const allowed = valid.filter(n => me.permissions.has(PermissionFlagsBits[n]));
	return { bits: new PermissionsBitField(allowed.map(n => PermissionFlagsBits[n])), skipped: valid.filter(n => !allowed.includes(n)) };
}

// ---------- API ----------

async function api(client, req, res, url) {
	const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
	const method = req.method;

	if (parts[0] === 'status' && method === 'GET') {
		return {
			ready: client.isReady(),
			bot: client.isReady() ? { tag: client.user.tag, avatar: client.user.displayAvatarURL({ size: 64 }) } : null,
			guilds: client.guilds.cache.map(g => ({ id: g.id, name: g.name, icon: g.iconURL({ size: 64 }), memberCount: g.memberCount })),
			defaultGuild: client.dashboardDefaultGuild || null,
			permissionGroups: PERMISSION_GROUPS,
		};
	}

	if (parts[0] !== 'guilds' || !isSnowflake(parts[1])) throw new HttpError(404, 'Not found.');
	const guild = client.guilds.cache.get(parts[1]);
	if (!guild) throw new HttpError(404, "I'm not in that server.");
	const me = guild.members.me;
	const [, , section, id, sub, subId] = parts;

	// GET /api/guilds/:gid: everything the dashboard needs about a server
	if (!section && method === 'GET') {
		await guild.members.fetch().catch(() => {});
		await guild.roles.fetch();
		const channels = guild.channels.cache
			.filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
			.sort((a, b) => (a.parent?.rawPosition ?? -1) - (b.parent?.rawPosition ?? -1) || a.rawPosition - b.rawPosition)
			.map(c => {
				const perms = c.permissionsFor(me);
				return {
					id: c.id,
					name: c.name,
					category: c.parent?.name ?? null,
					canSend: Boolean(perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])),
					canReact: Boolean(perms?.has([PermissionFlagsBits.AddReactions, PermissionFlagsBits.ReadMessageHistory])),
				};
			});
		const roles = [...guild.roles.cache.values()].sort((a, b) => b.position - a.position).map(r => serializeRole(guild, r));
		return {
			id: guild.id,
			name: guild.name,
			icon: guild.iconURL({ size: 128 }),
			memberCount: guild.memberCount,
			channels,
			roles,
			emojis: guild.emojis.cache.map(e => ({ id: e.id, name: e.name, animated: e.animated, url: e.imageURL({ size: 48 }), text: e.toString() })),
			me: { highestRole: me.roles.highest.name, permissions: me.permissions.toArray(), manageRoles: me.permissions.has(PermissionFlagsBits.ManageRoles) },
			autorole: storage.get(guild.id, 'autorole') ?? null,
		};
	}

	// POST /api/guilds/:gid/messages: send a message/embed, optionally as a role menu
	if (section === 'messages' && !id && method === 'POST') {
		const body = await readJson(req);
		const channel = textChannel(guild, body.channelId);
		const content = str(body.content, 2000);
		let embed;
		try { embed = buildEmbed(body.embed); } catch (e) { throw e instanceof HttpError ? e : new HttpError(400, `Embed problem: ${e.message}`); }
		if (!content && !embed) throw new HttpError(400, 'Write some message text or fill in the embed.');

		const menu = body.menu && Array.isArray(body.menu.items) && body.menu.items.length ? body.menu : null;
		const items = [];
		if (menu) {
			if (!['reactions', 'buttons'].includes(menu.mode)) throw new HttpError(400, 'Unknown menu type.');
			const limit = menu.mode === 'reactions' ? 20 : 25;
			if (menu.items.length > limit) throw new HttpError(400, `A ${menu.mode} menu can have at most ${limit} roles.`);
			for (const it of menu.items) {
				const role = manageableRole(guild, it.roleId);
				if (items.some(x => x.roleId === role.id)) throw new HttpError(400, `${role.name} is on the menu twice.`);
				const emoji = str(it.emoji, 100);
				if (menu.mode === 'reactions' && !emoji) throw new HttpError(400, `Pick an emoji for ${role.name}.`);
				items.push({ roleId: role.id, role, emoji, label: str(it.label, 80) || role.name.slice(0, 80) });
			}
			if (menu.mode === 'reactions') {
				const perms = channel.permissionsFor(me);
				if (!perms?.has([PermissionFlagsBits.AddReactions, PermissionFlagsBits.ReadMessageHistory])) {
					throw new HttpError(400, `I need Add Reactions and Read Message History in #${channel.name}.`);
				}
			}
		}

		const payload = { content: content || undefined, embeds: embed ? [embed] : [], allowedMentions: { parse: [] } };
		if (body.allowMentions) payload.allowedMentions = { parse: ['users', 'roles'] };
		if (menu?.mode === 'buttons') {
			try {
				payload.components = buildRows(items.map(i => makeButton(i.role, Boolean(menu.unique), i.emoji || undefined, i.label)));
			} catch (e) {
				throw new HttpError(400, `Button problem (usually a bad emoji): ${e.message}`);
			}
		}

		let message;
		try {
			message = await channel.send(payload);
		} catch (e) {
			throw new HttpError(400, `Discord refused the message: ${e.message}`);
		}

		if (menu) {
			const saved = [];
			const failed = [];
			for (const i of items) {
				let key = null;
				if (menu.mode === 'reactions') {
					try {
						const reaction = await message.react(i.emoji);
						key = roleMenus.emojiKey(reaction.emoji);
					} catch (e) {
						failed.push(`${i.emoji} (${i.role.name}): ${e.message}`);
						continue;
					}
				}
				saved.push({ roleId: i.roleId, emoji: i.emoji, key, label: i.label });
			}
			if (saved.length) {
				roleMenus.save(guild.id, message.id, {
					channelId: channel.id,
					mode: menu.mode,
					unique: Boolean(menu.unique),
					title: embed?.data.title || embed?.data.author?.name || content.slice(0, 80) || 'Role menu',
					items: saved,
					createdAt: new Date().toISOString(),
				});
			}
			if (failed.length) {
				return { ok: true, messageId: message.id, url: message.url, warning: `These emoji didn't work, so they're not on the menu: ${failed.join('; ')}` };
			}
		}
		return { ok: true, messageId: message.id, url: message.url };
	}

	// Role menus list/delete
	if (section === 'menus') {
		if (!id && method === 'GET') {
			return Object.entries(roleMenus.all(guild.id)).map(([messageId, m]) => ({
				messageId,
				...m,
				channelName: guild.channels.cache.get(m.channelId)?.name ?? null,
				url: `https://discord.com/channels/${guild.id}/${m.channelId}/${messageId}`,
			})).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
		}
		if (isSnowflake(id) && !sub && method === 'DELETE') {
			const menu = roleMenus.get(guild.id, id);
			if (!menu) throw new HttpError(404, 'That menu is already gone.');
			let note = '';
			if (url.searchParams.get('deleteMessage') === '1') {
				const channel = guild.channels.cache.get(menu.channelId);
				const msg = channel?.isTextBased() ? await channel.messages.fetch(id).catch(() => null) : null;
				if (msg) await msg.delete().catch(e => { note = ` (couldn't delete the message: ${e.message})`; });
			}
			roleMenus.remove(guild.id, id);
			return { ok: true, note };
		}
	}

	// Roles: create / edit / delete
	if (section === 'roles') {
		if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) throw new HttpError(400, 'I need the Manage Roles permission.');
		if (!id && method === 'POST') {
			const body = await readJson(req);
			const name = str(body.name, 100);
			if (!name) throw new HttpError(400, 'Give the role a name.');
			const { bits, skipped } = allowedPermissions(guild, body.permissions);
			const color = parseColor(body.color);
			const role = await guild.roles.create({
				name,
				permissions: bits,
				colors: { primaryColor: color ?? 0 },
				hoist: Boolean(body.hoist),
				mentionable: Boolean(body.mentionable),
				reason: 'Dashboard',
			}).catch(e => { throw new HttpError(400, e.message); });
			return { ok: true, role: serializeRole(guild, role), skipped };
		}
		if (isSnowflake(id) && !sub && method === 'PATCH') {
			const role = manageableRole(guild, id);
			const body = await readJson(req);
			const edit = { reason: 'Dashboard' };
			let skipped = [];
			if ('name' in body) {
				edit.name = str(body.name, 100);
				if (!edit.name) throw new HttpError(400, 'The role needs a name.');
			}
			if ('color' in body) edit.colors = { primaryColor: parseColor(body.color) ?? 0 };
			if ('hoist' in body) edit.hoist = Boolean(body.hoist);
			if ('mentionable' in body) edit.mentionable = Boolean(body.mentionable);
			if ('permissions' in body) {
				const p = allowedPermissions(guild, body.permissions);
				// Keep any permissions the role already has that the bot can't grant, instead of failing.
				const keep = role.permissions.toArray().filter(n => !me.permissions.has(PermissionFlagsBits[n]));
				edit.permissions = p.bits.add(keep.map(n => PermissionFlagsBits[n]));
				skipped = p.skipped.filter(n => !keep.includes(n));
			}
			const updated = await role.edit(edit).catch(e => { throw new HttpError(400, e.message); });
			return { ok: true, role: serializeRole(guild, updated), skipped };
		}
		if (isSnowflake(id) && !sub && method === 'DELETE') {
			const role = manageableRole(guild, id);
			await role.delete('Dashboard').catch(e => { throw new HttpError(400, e.message); });
			if (storage.get(guild.id, 'autorole') === id) storage.set(guild.id, 'autorole', null);
			return { ok: true };
		}
	}

	// Members: search, give/take roles
	if (section === 'members') {
		if (!id && method === 'GET') {
			const q = str(url.searchParams.get('q'), 100);
			const found = q
				? await guild.members.search({ query: q, limit: 25 }).catch(() => guild.members.cache.filter(m => m.displayName.toLowerCase().includes(q.toLowerCase())))
				: guild.members.cache;
			return [...found.values()]
				.sort((a, b) => a.displayName.localeCompare(b.displayName))
				.slice(0, 50)
				.map(serializeMember);
		}
		if (isSnowflake(id) && sub === 'roles' && isSnowflake(subId) && (method === 'PUT' || method === 'DELETE')) {
			const member = await guild.members.fetch(id).catch(() => null);
			if (!member) throw new HttpError(404, "That person isn't in the server.");
			const role = manageableRole(guild, subId);
			if (method === 'PUT') await member.roles.add(role, 'Dashboard').catch(e => { throw new HttpError(400, e.message); });
			else await member.roles.remove(role, 'Dashboard').catch(e => { throw new HttpError(400, e.message); });
			return { ok: true, member: serializeMember(member) };
		}
	}

	// Autorole
	if (section === 'autorole' && !id && method === 'PUT') {
		const body = await readJson(req);
		if (body.roleId === null || body.roleId === '') {
			storage.set(guild.id, 'autorole', null);
			return { ok: true, autorole: null };
		}
		const role = manageableRole(guild, body.roleId);
		storage.set(guild.id, 'autorole', role.id);
		return { ok: true, autorole: role.id };
	}

	throw new HttpError(404, 'Not found.');
}

// ---------- server ----------

function startDashboard(client, { port, key, defaultGuild }) {
	client.dashboardDefaultGuild = defaultGuild;
	const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);

	const server = http.createServer(async (req, res) => {
		try {
			// Blocks "DNS rebinding" tricks where another website pretends to be localhost.
			if (!allowedHosts.has(req.headers.host)) return send(res, 403, 'Forbidden', 'text/plain');
			const url = new URL(req.url, `http://${req.headers.host}`);

			if (!url.pathname.startsWith('/api/')) {
				const file = STATIC[url.pathname];
				if (!file || req.method !== 'GET') return send(res, 404, 'Not found', 'text/plain');
				return send(res, 200, fs.readFileSync(path.join(PUBLIC_DIR, file[0])), file[1]);
			}

			if (!keyMatches(req.headers['x-dashboard-key'], key)) return send(res, 401, { error: 'Wrong or missing access key.' });
			if (!client.isReady()) return send(res, 503, { error: 'The bot is still connecting to Discord, try again in a few seconds.' });
			const result = await api(client, req, res, url);
			return send(res, 200, result);
		} catch (e) {
			if (e instanceof HttpError) return send(res, e.status, { error: e.message });
			console.error('[dashboard]', e);
			return send(res, 500, { error: e.message || 'Something went wrong.' });
		}
	});

	server.on('error', e => console.error(`[dashboard] couldn't start on port ${port}: ${e.message}`));
	server.listen(port, '127.0.0.1', () => {
		console.log(`Dashboard: http://localhost:${port}/#key=${key}`);
	});
	return server;
}

module.exports = { startDashboard };
