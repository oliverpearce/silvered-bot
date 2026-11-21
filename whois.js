// "Who's who": a posted list of every (human) member, grouped by their highest hoisted role
// (the roles shown separately in Discord's member list), with a short note you write about each person.
// Mentions are clickable, so tapping a name opens their profile. Mentions in embeds never ping.
//
// Saved in data/settings.json under "whois": { notes: { userId: text }, locked: { userId: true }, posted: { channelId, messageIds } }
// Members can write their own note with /aboutme unless it's locked.
// The posted message updates itself when a note changes or someone joins, leaves or changes roles/nickname.
const { EmbedBuilder } = require('discord.js');
const storage = require('./storage');

const KEY = 'whois';
const COLOR = 0xff69b4;
const MAX_NOTE = 100;
const CHUNK = 3900; // characters per embed (Discord's limit is 4096)
const NO_GROUP = 'Members';

const load = guildId => ({ notes: {}, locked: {}, posted: null, ...(storage.get(guildId, KEY) ?? {}) });
const save = (guildId, data) => storage.set(guildId, KEY, data);

function getNote(guildId, userId) {
	return load(guildId).notes[userId] ?? null;
}

/** Sets (or clears, with empty text) someone's note and refreshes the posted list. */
function setNote(guild, userId, text) {
	const data = load(guild.id);
	const note = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE);
	if (note) data.notes[userId] = note;
	else delete data.notes[userId];
	save(guild.id, data);
	scheduleRefresh(guild);
	return note || null;
}

const isLocked = (guildId, userId) => Boolean(load(guildId).locked?.[userId]);

/** Locked notes can only be changed by staff (/whois or the dashboard), not with /aboutme. */
function setLocked(guildId, userId, locked) {
	const data = load(guildId);
	data.locked ??= {};
	if (locked) data.locked[userId] = true;
	else delete data.locked[userId];
	save(guildId, data);
}

/** Every human member with their group and note, groups ordered like Discord's member list. */
async function list(guild) {
	await guild.members.fetch().catch(() => {});
	const { notes, locked } = load(guild.id);
	return [...guild.members.cache.values()]
		.filter(m => !m.user.bot)
		.map(m => {
			const group = m.roles.hoist;
			return {
				id: m.id,
				displayName: m.displayName,
				username: m.user.username,
				avatar: m.displayAvatarURL({ size: 64 }),
				group: group?.name ?? NO_GROUP,
				groupPosition: group?.position ?? 0,
				note: notes[m.id] ?? null,
				locked: Boolean(locked?.[m.id]),
			};
		})
		.sort((a, b) => b.groupPosition - a.groupPosition || a.displayName.localeCompare(b.displayName));
}

const escape = s => s.replace(/([\\*_~`|>#[\]-])/g, '\\$1');

/** Builds the embeds (one per message) for the posted list. */
async function buildEmbeds(guild) {
	const people = await list(guild);
	const blocks = [];
	let lastGroup = null;
	for (const p of people) {
		if (p.group !== lastGroup) {
			blocks.push(`${blocks.length ? '\n' : ''}__**${escape(p.group)}**__`);
			lastGroup = p.group;
		}
		blocks.push(p.note ? `<@${p.id}> — ${escape(p.note)}` : `<@${p.id}>`);
	}
	if (!blocks.length) blocks.push('Nobody here yet.');

	const chunks = [''];
	for (const line of blocks) {
		if (chunks.at(-1).length + line.length + 1 > CHUNK) chunks.push('');
		chunks[chunks.length - 1] += (chunks.at(-1) ? '\n' : '') + line;
	}
	return chunks.map((text, i) => {
		const embed = new EmbedBuilder().setColor(COLOR).setDescription(text);
		if (i === 0) embed.setTitle(`Who's who in ${guild.name}`.slice(0, 256));
		if (i === chunks.length - 1) embed.setFooter({ text: `${people.length} people · tap a name to see their profile` }).setTimestamp();
		return embed;
	});
}

const fetchMessages = async (channel, ids) => Promise.all(ids.map(id => channel.messages.fetch(id).catch(() => null)));

/** Posts the list in a channel (replacing any earlier post) and remembers it so it auto-updates. */
async function post(guild, channel) {
	const data = load(guild.id);
	if (data.posted) await unpost(guild).catch(() => {});
	const embeds = await buildEmbeds(guild);
	const messageIds = [];
	for (const embed of embeds) {
		const msg = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
		messageIds.push(msg.id);
	}
	save(guild.id, { ...load(guild.id), posted: { channelId: channel.id, messageIds } });
	return { channel, messageIds, url: `https://discord.com/channels/${guild.id}/${channel.id}/${messageIds[0]}` };
}

/** Deletes the posted list and stops updating it. */
async function unpost(guild) {
	const data = load(guild.id);
	if (!data.posted) return false;
	const channel = guild.channels.cache.get(data.posted.channelId);
	if (channel) for (const m of await fetchMessages(channel, data.posted.messageIds)) await m?.delete().catch(() => {});
	save(guild.id, { ...data, posted: null });
	return true;
}

/** Edits the posted list to match. Reposts it if the number of messages changed or one was deleted. */
async function refresh(guild) {
	const { posted } = load(guild.id);
	if (!posted) return;
	const channel = guild.channels.cache.get(posted.channelId);
	if (!channel) return save(guild.id, { ...load(guild.id), posted: null });
	const embeds = await buildEmbeds(guild);
	const messages = await fetchMessages(channel, posted.messageIds);
	if (messages.length !== embeds.length || messages.some(m => !m)) {
		await post(guild, channel);
		return;
	}
	for (let i = 0; i < embeds.length; i++) await messages[i].edit({ embeds: [embeds[i]], allowedMentions: { parse: [] } });
}

// Many changes at once (e.g. a role edit) only cause one update.
const timers = new Map();
function scheduleRefresh(guild, ms = 5000) {
	if (!load(guild.id).posted) return;
	clearTimeout(timers.get(guild.id));
	timers.set(guild.id, setTimeout(() => {
		timers.delete(guild.id);
		refresh(guild).catch(e => console.warn('[whois] couldn\'t update the list:', e.message));
	}, ms));
}

function postedInfo(guild) {
	const { posted } = load(guild.id);
	if (!posted) return null;
	return { channelId: posted.channelId, url: `https://discord.com/channels/${guild.id}/${posted.channelId}/${posted.messageIds[0]}` };
}

module.exports = { MAX_NOTE, getNote, setNote, isLocked, setLocked, list, post, unpost, refresh, scheduleRefresh, postedInfo };
