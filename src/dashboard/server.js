// Web dashboard for managing your server: send/edit embeds, build role menus, manage roles/members.
//
// Two ways to run it (DASHBOARD in .env):
//   local  (default) its own server on 127.0.0.1:DASHBOARD_PORT, only reachable from this computer.
//   public shares the bot's main port at /dashboard/, with login links from /dashboard in Discord (see auth.js).
//
// Security: local mode needs the access key (DASHBOARD_KEY). Public mode needs a Discord session, and
// each server is limited to people with Administrator there. Both use a custom request header,
// which stops other websites from making requests from your browser.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ChannelType, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const { botCantManage } = require('../lib/roleUtils');
const { buildRows, makeButton } = require('../commands/roles/rolemenu');
const { syncList } = require('../commands/roles/reactionrole');
const roleMenus = require('../lib/roleMenus');
const storage = require('../lib/storage');
const whois = require('../lib/whois');
const welcome = require('../lib/welcome');
const modlog = require('../lib/modlog');
const events = require('../lib/events');
const scheduler = require('../lib/scheduler');
const { EmbedError, str, parseColor, hex, buildEmbed, embedToDraft } = require('../lib/embeds');
const { canManageGuild, manageableGuilds } = require('./auth');

const PUBLIC_DIR = path.join(__dirname, 'public');
// Paths are relative to /dashboard (public mode) or / (local mode).
const STATIC = {
	'/': ['index.html', 'text/html; charset=utf-8'],
	'/app.js': ['app.js', 'text/javascript; charset=utf-8'],
	'/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const MAX_BODY = 1024 * 1024;
const LOCKOUT_FAILS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;

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
		'Content-Security-Policy': "default-src 'self'; img-src * data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
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

// Counts wrong keys per IP and locks an IP out after too many.
function makeLockout() {
	const fails = new Map();
	const entry = ip => {
		const now = Date.now();
		let e = fails.get(ip);
		if (!e || now > e.reset) {
			e = { count: 0, reset: now + LOCKOUT_MS };
			fails.set(ip, e);
		}
		return e;
	};
	return {
		blocked: ip => { const e = fails.get(ip); return Boolean(e && Date.now() <= e.reset && e.count >= LOCKOUT_FAILS); },
		fail: ip => {
			entry(ip).count++;
			if (fails.size > 5000) for (const [k, v] of fails) if (Date.now() > v.reset) fails.delete(k);
		},
	};
}

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

// Reads the message text + embed from the dashboard form.
function readContent(body) {
	const content = str(body.content, 2000);
	let embed;
	try { embed = buildEmbed(body.embed); } catch (e) { throw new HttpError(400, e instanceof EmbedError ? e.message : `Embed problem: ${e.message}`); }
	if (!content && !embed) throw new HttpError(400, 'Write some message text or fill in the embed.');
	return { content, embed };
}

// Checks a role menu from the dashboard form. Returns null when there's no menu.
function readMenu(guild, channel, raw) {
	if (!raw || !Array.isArray(raw.items) || !raw.items.length) return null;
	if (!['reactions', 'buttons'].includes(raw.mode)) throw new HttpError(400, 'Unknown menu type.');
	const limit = raw.mode === 'reactions' ? 20 : 25;
	if (raw.items.length > limit) throw new HttpError(400, `A ${raw.mode} menu can have at most ${limit} roles.`);
	const items = [];
	for (const it of raw.items) {
		const role = manageableRole(guild, it.roleId);
		if (items.some(x => x.roleId === role.id)) throw new HttpError(400, `${role.name} is on the menu twice.`);
		const emoji = str(it.emoji, 100);
		if (raw.mode === 'reactions' && !emoji) throw new HttpError(400, `Pick an emoji for ${role.name}.`);
		items.push({ roleId: role.id, role, emoji, label: str(it.label, 80) || role.name.slice(0, 80) });
	}
	if (raw.mode === 'reactions') {
		const perms = channel.permissionsFor(guild.members.me);
		if (!perms?.has([PermissionFlagsBits.AddReactions, PermissionFlagsBits.ReadMessageHistory])) {
			throw new HttpError(400, `I need Add Reactions and Read Message History in #${channel.name}.`);
		}
	}
	return { mode: raw.mode, unique: Boolean(raw.unique), category: str(raw.category, 50), autoList: raw.mode === 'reactions' && raw.autoList === true, items };
}

function buttonRows(menu) {
	try {
		return buildRows(menu.items.map(i => makeButton(i.role, menu.unique, i.emoji || undefined, i.label)));
	} catch (e) {
		throw new HttpError(400, `Button problem (usually a bad emoji): ${e.message}`);
	}
}

// Adds the reactions for a menu and saves it. `previous` is the old version when editing.
// Returns a warning string if some emoji didn't work.
async function attachMenu(guild, message, menu, previous) {
	const saved = [];
	const failed = [];
	for (const i of menu.items) {
		let key = null;
		if (menu.mode === 'reactions') {
			try {
				const reaction = await message.react(i.emoji);
				key = roleMenus.emojiKey(reaction.emoji);
			} catch (e) {
				failed.push(`${i.emoji} (${i.role.name}): ${e.message}`);
				continue;
			}
			const clash = saved.find(x => x.key === key);
			if (clash) {
				failed.push(`${i.emoji} (${i.role.name}): that emoji is already used for ${guild.roles.cache.get(clash.roleId)?.name ?? 'another role'}`);
				continue;
			}
		}
		saved.push({ roleId: i.roleId, emoji: i.emoji, key, label: i.label });
	}

	// Take the bot's own reactions off emoji that aren't on the menu any more.
	if (previous?.mode === 'reactions') {
		const keep = new Set(saved.map(x => x.key).filter(Boolean));
		for (const old of previous.items) {
			if (old.key && !keep.has(old.key)) await roleMenus.removeBotReaction(message, old.key);
		}
	}

	if (saved.length) {
		roleMenus.save(guild.id, message.id, {
			channelId: message.channelId,
			mode: menu.mode,
			unique: menu.unique,
			category: menu.category || undefined,
			title: roleMenus.titleOf(message),
			items: saved,
			autoList: previous?.autoList || menu.autoList || undefined,
			createdAt: previous?.createdAt ?? new Date().toISOString(),
			updatedAt: previous ? new Date().toISOString() : undefined,
		});
		// New self-updating menus: tidy the list and add the pick-one footer.
		// Not on edits: the dashboard form already holds the final text, and this message object is the pre-edit copy.
		if (!previous && message.author) await syncList(message, roleMenus.get(guild.id, message.id));
	} else if (previous) {
		roleMenus.remove(guild.id, message.id);
	}
	return failed.length ? `These emoji didn't work, so they're not on the menu: ${failed.join('; ')}` : null;
}

// Turns a list of permission names into a bitfield, dropping ones the bot doesn't have
// (Discord refuses to let a bot grant permissions it lacks).
function allowedPermissions(guild, names) {
	const me = guild.members.me;
	const valid = (Array.isArray(names) ? names : []).filter(n => typeof n === 'string' && n in PermissionFlagsBits);
	const allowed = valid.filter(n => me.permissions.has(PermissionFlagsBits[n]));
	return { bits: new PermissionsBitField(allowed.map(n => PermissionFlagsBits[n])), skipped: valid.filter(n => !allowed.includes(n)) };
}

// Sends a message from the dashboard form's shape. Used for "send now" and for scheduled messages.
async function sendFromBody(guild, body) {
	const channel = textChannel(guild, body.channelId);
	const { content, embed } = readContent(body);
	const menu = readMenu(guild, channel, body.menu);
	const payload = { content: content || undefined, embeds: embed ? [embed] : [], allowedMentions: { parse: body.allowMentions ? ['users', 'roles'] : [] } };
	if (menu?.mode === 'buttons') payload.components = buttonRows(menu);
	let message;
	try {
		message = await channel.send(payload);
	} catch (e) {
		throw new HttpError(400, `Discord refused the message: ${e.message}`);
	}
	const warning = menu ? await attachMenu(guild, message, menu, null) : null;
	return { message, warning };
}

scheduler.register('message', async (guild, job) => {
	const { warning } = await sendFromBody(guild, job.body);
	if (warning) console.warn(`[scheduler] scheduled message in ${guild.name}: ${warning}`);
});

// ---------- API ----------

async function api(client, req, res, url, viewer = null) {
	const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
	const method = req.method;

	if (parts[0] === 'status' && method === 'GET') {
		const guilds = viewer ? await manageableGuilds(client, viewer.id) : [...client.guilds.cache.values()];
		return {
			ready: client.isReady(),
			bot: client.isReady() ? { tag: client.user.tag, avatar: client.user.displayAvatarURL({ size: 64 }) } : null,
			user: viewer,
			guilds: guilds.map(g => ({ id: g.id, name: g.name, icon: g.iconURL({ size: 64 }), memberCount: g.memberCount })),
			defaultGuild: guilds.some(g => g.id === client.dashboardDefaultGuild) ? client.dashboardDefaultGuild : null,
			permissionGroups: PERMISSION_GROUPS,
		};
	}

	if (parts[0] !== 'guilds' || !isSnowflake(parts[1])) throw new HttpError(404, 'Not found.');
	const guild = client.guilds.cache.get(parts[1]);
	if (viewer && !(guild && await canManageGuild(guild, viewer.id))) throw new HttpError(403, 'You need Administrator in that server to manage it.');
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
			emojis: guild.emojis.cache.map(e => ({ id: e.id, name: e.name, animated: e.animated, url: e.imageURL({ size: 64 }), text: e.toString() })),
			me: { highestRole: me.roles.highest.name, permissions: me.permissions.toArray(), manageRoles: me.permissions.has(PermissionFlagsBits.ManageRoles) },
			autorole: storage.get(guild.id, 'autorole') ?? null,
			menuCategories: roleMenus.categories(guild.id),
			welcome: welcome.get(guild.id),
			modlog: modlog.channelId(guild.id),
			timezone: events.timezone(guild.id),
			templates: storage.get(guild.id, 'templates') ?? {},
		};
	}

	// POST /api/guilds/:gid/messages: send a message/embed, optionally as a role menu.
	// With sendAt (a timestamp in ms), it's checked now and sent later instead.
	if (section === 'messages' && !id && method === 'POST') {
		const body = await readJson(req);
		if (body.sendAt !== undefined && body.sendAt !== null) {
			const at = Number(body.sendAt);
			if (!Number.isFinite(at) || at < Date.now() + 30000) throw new HttpError(400, 'Pick a time at least a minute from now.');
			if (at > Date.now() + 366 * 864e5) throw new HttpError(400, 'Pick a time within the next year.');
			const channel = textChannel(guild, body.channelId);
			readContent(body);
			readMenu(guild, channel, body.menu);
			const { sendAt, editing, ...rest } = body;
			const job = scheduler.add(guild.id, { kind: 'message', at, channelId: channel.id, body: rest });
			return { ok: true, scheduled: { id: job.id, at } };
		}
		const { message, warning } = await sendFromBody(guild, body);
		return { ok: true, messageId: message.id, url: message.url, warning: warning ?? undefined };
	}

	// Scheduled messages and event reminders
	if (section === 'scheduled') {
		if (!id && method === 'GET') {
			return scheduler.list(guild.id).map(j => ({
				id: j.id, kind: j.kind, at: j.at, channelId: j.channelId,
				title: j.kind === 'event' ? j.title : (j.body?.embed?.title || j.body?.content || '(embed)').slice(0, 100),
				eventAt: j.eventAt, roleId: j.roleId, messageId: j.messageId,
			}));
		}
		if (/^[0-9a-f]{8}$/.test(id ?? '') && method === 'DELETE') {
			const job = scheduler.list(guild.id).find(j => j.id === id);
			if (!job) throw new HttpError(404, 'That\'s already gone (it may have just run).');
			if (job.kind === 'event') await events.cancel(guild, id);
			else scheduler.remove(guild.id, id);
			return { ok: true };
		}
	}

	// POST /api/guilds/:gid/events: post an event and schedule its reminder ping
	if (section === 'events' && !id && method === 'POST') {
		const body = await readJson(req);
		const channel = textChannel(guild, body.channelId);
		try {
			const { message, job, warnings } = await events.create(guild, channel, {
				title: str(body.title, 200), description: str(body.description, 4000), at: Number(body.at),
				roleId: isSnowflake(body.roleId) ? body.roleId : null, remindMinutes: body.remindMinutes,
			});
			return { ok: true, url: message.url, id: job.id, warning: warnings.join(' ') || undefined };
		} catch (e) {
			throw new HttpError(400, e.message);
		}
	}

	// Welcome / goodbye messages
	if (section === 'welcome' && (id === 'join' || id === 'leave')) {
		if (!sub && method === 'PUT') {
			const body = await readJson(req);
			const channelId = body.channelId ? textChannel(guild, body.channelId).id : null;
			const color = /^#[0-9a-f]{6}$/i.test(body.color ?? '') ? body.color : welcome.DEFAULTS[id].color;
			welcome.set(guild.id, id, { channelId, text: str(body.text, 2000) || welcome.DEFAULTS[id].text, color });
			return { ok: true, welcome: welcome.get(guild.id) };
		}
		if (sub === 'test' && method === 'POST') {
			const sent = await welcome.send(me, id, { test: true }).catch(e => { throw new HttpError(400, e.message); });
			if (!sent) throw new HttpError(400, 'Pick a channel and save first.');
			return { ok: true };
		}
	}

	// Mod log channel
	if (section === 'modlog' && !id && method === 'PUT') {
		const body = await readJson(req);
		const channelId = body.channelId ? textChannel(guild, body.channelId).id : null;
		modlog.setChannel(guild.id, channelId);
		return { ok: true, modlog: channelId };
	}

	// Timezone for times typed in /event
	if (section === 'timezone' && !id && method === 'PUT') {
		const body = await readJson(req);
		if (!events.setTimezone(guild.id, str(body.timezone, 60))) throw new HttpError(400, 'That isn\'t a timezone I know.');
		return { ok: true, timezone: events.timezone(guild.id) };
	}

	// Saved embed templates
	if (section === 'templates') {
		const all = storage.get(guild.id, 'templates') ?? {};
		const name = str(url.searchParams.get('name') ?? '', 50);
		if (!id && method === 'POST') {
			const body = await readJson(req);
			const tname = str(body.name, 50);
			if (!tname) throw new HttpError(400, 'Give the template a name.');
			if (!all[tname] && Object.keys(all).length >= 50) throw new HttpError(400, 'You can save up to 50 templates. Delete some first.');
			const d = body.draft ?? {};
			all[tname] = {
				content: str(d.content, 2000),
				embed: d.embed && typeof d.embed === 'object' ? d.embed : null,
				menu: d.menu && typeof d.menu === 'object' ? { mode: d.menu.mode === 'buttons' ? 'buttons' : 'reactions', unique: Boolean(d.menu.unique), category: str(d.menu.category, 50), items: Array.isArray(d.menu.items) ? d.menu.items.slice(0, 25) : [] } : null,
			};
			if (JSON.stringify(all[tname]).length > 20000) throw new HttpError(400, 'That template is too big to save.');
			storage.set(guild.id, 'templates', all);
			return { ok: true, templates: all };
		}
		if (!id && method === 'DELETE' && name) {
			delete all[name];
			storage.set(guild.id, 'templates', Object.keys(all).length ? all : null);
			return { ok: true, templates: all };
		}
	}

	// GET /api/guilds/:gid/messages/:mid?channelId=: load a message (and its role menu) into the editor
	if (section === 'messages' && isSnowflake(id) && !sub && method === 'GET') {
		const saved = roleMenus.get(guild.id, id);
		const channelId = url.searchParams.get('channelId');
		const cid = isSnowflake(channelId) ? channelId : saved?.channelId;
		const channel = cid ? await client.channels.fetch(cid).catch(() => null) : null;
		if (!channel?.isTextBased() || channel.guildId !== guild.id) throw new HttpError(404, "Couldn't find that message's channel.");
		const message = await channel.messages.fetch(id).catch(() => null);
		if (!message) throw new HttpError(404, "Couldn't find that message. It may have been deleted, or I can't read that channel.");
		return {
			channelId: channel.id,
			messageId: message.id,
			url: message.url,
			own: message.author.id === client.user.id,
			content: message.content,
			embed: message.embeds[0] ? embedToDraft(message.embeds[0]) : null,
			menu: saved ? {
				mode: saved.mode,
				unique: Boolean(saved.unique),
				category: saved.category ?? '',
				autoList: Boolean(saved.autoList),
				items: saved.items.map(i => ({ roleId: i.roleId, emoji: i.emoji ?? '', label: i.label ?? '' })),
			} : null,
		};
	}

	// PATCH /api/guilds/:gid/messages/:mid: edit a message the bot sent and/or its role menu
	if (section === 'messages' && isSnowflake(id) && !sub && method === 'PATCH') {
		const body = await readJson(req);
		const channel = textChannel(guild, body.channelId);
		const message = await channel.messages.fetch(id).catch(() => null);
		if (!message) throw new HttpError(404, `Couldn't find that message in #${channel.name}. It may have been deleted.`);
		const previous = roleMenus.get(guild.id, id);
		const menu = readMenu(guild, channel, body.menu);
		const notes = [];

		if (message.author.id === client.user.id) {
			const { content, embed } = readContent(body);
			try {
				await message.edit({
					content,
					embeds: embed ? [embed] : [],
					components: menu?.mode === 'buttons' ? buttonRows(menu) : [],
					allowedMentions: { parse: body.allowMentions ? ['users', 'roles'] : [] },
				});
			} catch (e) {
				throw e instanceof HttpError ? e : new HttpError(400, `Discord refused the edit: ${e.message}`);
			}
		} else {
			if (menu?.mode === 'buttons') throw new HttpError(400, 'Buttons can only go on messages the bot sent. Use reactions for this one.');
			notes.push("That message wasn't sent by the bot, so only its reaction roles were changed.");
		}

		if (menu) {
			const warning = await attachMenu(guild, message, menu, previous);
			if (warning) notes.push(warning);
		} else if (previous) {
			if (previous.mode === 'reactions') for (const old of previous.items) if (old.key) await roleMenus.removeBotReaction(message, old.key);
			roleMenus.remove(guild.id, id);
		}
		return { ok: true, messageId: message.id, url: message.url, warning: notes.join(' ') || undefined };
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
			const channel = guild.channels.cache.get(menu.channelId);
			const msg = channel?.isTextBased() ? await channel.messages.fetch(id).catch(() => null) : null;
			if (msg && url.searchParams.get('deleteMessage') === '1') {
				await msg.delete().catch(e => { note = ` (couldn't delete the message: ${e.message})`; });
			} else if (msg && menu.mode === 'reactions') {
				// Keeping the message: take the bot's reactions off so it doesn't look like a live menu.
				for (const i of menu.items) if (i.key) await roleMenus.removeBotReaction(msg, i.key);
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

	// Who's who: list members with notes, edit notes, post/unpost the list
	if (section === 'whois') {
		if (!id && method === 'GET') {
			return { posted: whois.postedInfo(guild), members: await whois.list(guild), maxNote: whois.MAX_NOTE };
		}
		if (id === 'post' && method === 'POST') {
			const body = await readJson(req);
			const channel = textChannel(guild, body.channelId);
			try {
				const { url } = await whois.post(guild, channel);
				return { ok: true, posted: whois.postedInfo(guild), url };
			} catch (e) {
				throw new HttpError(400, `Couldn't post it: ${e.message}`);
			}
		}
		if (id === 'post' && method === 'DELETE') {
			await whois.unpost(guild);
			return { ok: true, posted: null };
		}
		if (isSnowflake(id) && !sub && method === 'PUT') {
			const body = await readJson(req);
			const member = await guild.members.fetch(id).catch(() => null);
			if (!member || member.user.bot) throw new HttpError(404, "That person isn't in the server.");
			if ('locked' in body) whois.setLocked(guild.id, id, Boolean(body.locked));
			const note = 'note' in body ? whois.setNote(guild, id, str(body.note, 500)) : whois.getNote(guild.id, id);
			return { ok: true, note, locked: whois.isLocked(guild.id, id) };
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

/**
 * Returns an async (req, res) => handled handler.
 * In public mode it only claims /dashboard* and /api/* and returns false for anything else,
 * so the bot's status page can share the same port.
 */
function createDashboardHandler(client, { key, defaultGuild, publicMode = false, allowedHosts = null, auth = null }) {
	client.dashboardDefaultGuild = defaultGuild;
	const lockout = makeLockout();

	return async function handle(req, res) {
		// Parse against a fixed base so a weird Host header can't break things.
		const url = new URL(req.url, 'http://dashboard.local');
		const p = url.pathname;
		const isApi = p.startsWith('/api/');
		const isDash = p === '/dashboard' || p.startsWith('/dashboard/');
		if (publicMode && !isApi && !isDash) return false;
		const done = (...args) => { send(res, ...args); return true; };

		try {
			// Local mode: blocks "DNS rebinding" tricks where another website pretends to be localhost.
			if (allowedHosts && !allowedHosts.has(req.headers.host)) return done(403, 'Forbidden', 'text/plain');

			if (p === '/api/auth/mode' && req.method === 'GET') return done(200, { mode: auth ? 'discord' : 'key' });

			if (!isApi) {
				if (p === '/dashboard') {
					res.writeHead(301, { Location: `/dashboard/${url.search}` });
					res.end();
					return true;
				}
				const file = STATIC[isDash ? p.slice('/dashboard'.length) : p];
				if (!file || req.method !== 'GET') return done(404, 'Not found', 'text/plain');
				return done(200, fs.readFileSync(path.join(PUBLIC_DIR, file[0])), file[1]);
			}

			let viewer = null;
			if (auth) {
				if (req.headers['x-silvered-dashboard'] !== '1') return done(403, { error: 'Forbidden.' });
				if (p === '/api/auth/link' && req.method === 'POST') {
					const body = await readJson(req);
					if (!auth.redeem(res, body.token)) return done(400, { error: 'That login link expired or was already used. Run /dashboard in Discord for a new one.' });
					return done(200, { ok: true });
				}
				viewer = auth.viewer(req);
				if (!viewer) return done(401, { error: 'Run /dashboard in Discord to log in.' });
				if (p === '/api/auth/logout' && req.method === 'POST') {
					auth.logout(req, res);
					return done(200, { ok: true });
				}
			} else {
				const ip = req.socket.remoteAddress ?? 'unknown';
				if (lockout.blocked(ip)) return done(429, { error: 'Too many wrong keys. Wait 15 minutes and try again.' });
				if (!keyMatches(req.headers['x-dashboard-key'], key)) {
					lockout.fail(ip);
					return done(401, { error: 'Wrong or missing access key.' });
				}
			}
			if (!client.isReady()) return done(503, { error: 'The bot is still connecting to Discord, try again in a few seconds.' });
			const result = await api(client, req, res, url, viewer);
			send(res, 200, result);
		} catch (e) {
			if (e instanceof HttpError) send(res, e.status, { error: e.message });
			else {
				console.error('[dashboard]', e);
				send(res, 500, { error: e.message || 'Something went wrong.' });
			}
		}
		return true;
	};
}

// Local mode: a separate server that only listens on this computer.
function startDashboard(client, { port, key, defaultGuild }) {
	const handle = createDashboardHandler(client, {
		key,
		defaultGuild,
		allowedHosts: new Set([`localhost:${port}`, `127.0.0.1:${port}`]),
	});
	const server = http.createServer(handle);
	server.on('error', e => console.error(`[dashboard] couldn't start on port ${port}: ${e.message}`));
	server.listen(port, '127.0.0.1', () => {
		console.log(`Dashboard: http://localhost:${port}/#key=${key}`);
	});
	return server;
}

module.exports = { createDashboardHandler, startDashboard };
