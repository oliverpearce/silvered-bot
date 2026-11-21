// Events: posts an event embed (the time shows in everyone's own timezone) and pings a role
// shortly before it starts. React 🔔 on the event to get the role, so you get pinged.
const { EmbedBuilder, PermissionFlagsBits: P } = require('discord.js');
const storage = require('./storage');
const scheduler = require('./scheduler');
const roleMenus = require('./roleMenus');
const { botCantManage } = require('./roleUtils');

const BELL = '🔔';
const COLOR = 0xfaa61a;
const DEFAULT_TZ = 'UTC';

const timezone = guildId => storage.get(guildId, 'timezone') ?? DEFAULT_TZ;

function validTimezone(tz) {
	try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}

function setTimezone(guildId, tz) {
	if (!validTimezone(tz)) return false;
	storage.set(guildId, 'timezone', tz);
	return true;
}

// How far `tz` is ahead of UTC at this moment, in ms.
function tzOffset(ms, tz) {
	const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
		timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
	}).formatToParts(ms).map(p => [p.type, p.value]));
	return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(ms / 1000) * 1000;
}

// A wall-clock time in `tz` → a real timestamp.
function zonedToMs(y, mo, d, h, mi, tz) {
	const guess = Date.UTC(y, mo - 1, d, h, mi);
	const first = guess - tzOffset(guess, tz);
	return guess - tzOffset(first, tz);
}

/**
 * Understands:
 *   2026-11-22 20:00   22/11/2026 20:00   22/11 8pm   20:00 (next time it's 20:00)
 *   in 2h   in 30m   in 1d 3h   a Discord timestamp like <t:1790000000:F>   a raw unix timestamp
 * Times without a date or timezone use the server's timezone.
 */
function parseWhen(text, tz, now = Date.now()) {
	const s = String(text ?? '').trim().toLowerCase();
	let m;
	if ((m = /^<t:(\d+)(?::\w)?>$/.exec(s)) || (m = /^(\d{10})$/.exec(s))) return Number(m[1]) * 1000;
	if ((m = /^in\s+(.+)$/.exec(s))) {
		let total = 0;
		const units = { d: 864e5, day: 864e5, days: 864e5, h: 36e5, hr: 36e5, hrs: 36e5, hour: 36e5, hours: 36e5, m: 6e4, min: 6e4, mins: 6e4, minute: 6e4, minutes: 6e4 };
		const rest = m[1].replace(/(\d+(?:\.\d+)?)\s*([a-z]+)/g, (_, n, u) => { if (units[u]) total += Number(n) * units[u]; return ''; });
		return total && !rest.trim() ? now + total : null;
	}
	const time = '(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?';
	const toHour = (h, ap) => { h = Number(h); if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; return h; };
	const today = () => {
		const local = new Date(now + tzOffset(now, tz));
		return [local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate()];
	};
	let y, mo, d, h, mi;
	if ((m = new RegExp(`^(\\d{4})-(\\d{1,2})-(\\d{1,2})[ t]+${time}$`).exec(s))) {
		[y, mo, d] = [m[1], m[2], m[3]].map(Number); h = toHour(m[4], m[6]); mi = Number(m[5] ?? 0);
	} else if ((m = new RegExp(`^(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?\\s+${time}$`).exec(s))) {
		d = Number(m[1]); mo = Number(m[2]); y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : today()[0];
		h = toHour(m[4], m[6]); mi = Number(m[5] ?? 0);
		if (!m[3] && zonedToMs(y, mo, d, h, mi, tz) < now) y++;
	} else if ((m = new RegExp(`^(?:(today|tomorrow)\\s+(?:at\\s+)?)?${time}$`).exec(s)) && (m[3] || m[4] || m[1])) {
		[y, mo, d] = today(); h = toHour(m[2], m[4]); mi = Number(m[3] ?? 0);
		let ms = zonedToMs(y, mo, d, h, mi, tz);
		if (m[1] === 'tomorrow' || (!m[1] && ms < now)) ms += 864e5;
		return h < 24 && mi < 60 ? ms : null;
	} else {
		return null;
	}
	if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
	return zonedToMs(y, mo, d, h, mi, tz);
}

const ts = (ms, style) => `<t:${Math.floor(ms / 1000)}:${style}>`;

function eventEmbed({ title, description, at, roleId, cancelled }) {
	const embed = new EmbedBuilder()
		.setColor(cancelled ? 0x99aab5 : COLOR)
		.setTitle(`${cancelled ? '❌ Cancelled: ' : '📅 '}${title}`.slice(0, 256))
		.addFields({ name: 'When', value: `${ts(at, 'F')} (${ts(at, 'R')})` });
	if (description) embed.setDescription(description.slice(0, 4000));
	if (roleId && !cancelled) embed.addFields({ name: 'Get pinged', value: `React ${BELL} to get <@&${roleId}> and a ping before it starts.` });
	return embed;
}

/**
 * Posts an event and schedules its reminder. Throws an Error with a readable message if something's wrong.
 * Returns { message, job, warnings }.
 */
async function create(guild, channel, { title, description = '', at, roleId = null, remindMinutes = 15 }) {
	title = String(title ?? '').trim().slice(0, 200);
	if (!title) throw new Error('Give the event a title.');
	if (!Number.isFinite(at) || at < Date.now()) throw new Error('The event time has to be in the future.');
	remindMinutes = Math.max(0, Math.min(10080, Math.round(Number(remindMinutes) || 0)));
	const warnings = [];
	const role = roleId ? guild.roles.cache.get(roleId) : null;
	if (roleId && !role) throw new Error('That role no longer exists.');
	if (role && !role.mentionable && !guild.members.me.permissionsIn(channel).has(P.MentionEveryone)) {
		warnings.push(`${role.name} isn't mentionable and I don't have Mention @everyone, so the reminder won't actually ping. Turn on "Allow anyone to @mention this role" for it.`);
	}

	const message = await channel.send({ embeds: [eventEmbed({ title, description, at, roleId: role?.id })], allowedMentions: { parse: [] } });
	// React 🔔 to get the role (works like a one-item reaction role menu).
	if (role && !botCantManage(guild, role) && channel.permissionsFor(guild.members.me)?.has([P.AddReactions, P.ReadMessageHistory])) {
		try {
			await message.react(BELL);
			roleMenus.save(guild.id, message.id, {
				channelId: channel.id, mode: 'reactions', unique: false, category: 'Events', title: `📅 ${title}`.slice(0, 80),
				items: [{ roleId: role.id, emoji: BELL, key: BELL, label: role.name.slice(0, 80) }], createdAt: new Date().toISOString(),
			});
		} catch (e) {
			warnings.push(`Couldn't add the ${BELL} reaction (${e.message}).`);
		}
	} else if (role) {
		warnings.push(`I can't give out ${role.name} (it's above my role, or I'm missing permissions), so the ${BELL} reaction was left off.`);
	}

	const remindAt = Math.max(Date.now() + 5000, at - remindMinutes * 60000);
	const job = scheduler.add(guild.id, {
		kind: 'event', at: remindAt, eventAt: at, title, description, roleId: role?.id ?? null,
		channelId: channel.id, messageId: message.id, remindMinutes,
	});
	return { message, job, warnings };
}

/** Cancels an event: drops its reminder and marks the posted message as cancelled. */
async function cancel(guild, id) {
	const job = scheduler.remove(guild.id, id);
	if (!job || job.kind !== 'event') return null;
	const channel = guild.channels.cache.get(job.channelId);
	const message = await channel?.messages.fetch(job.messageId).catch(() => null);
	if (message) await message.edit({ embeds: [eventEmbed({ ...job, at: job.eventAt, cancelled: true })] }).catch(() => {});
	roleMenus.remove(guild.id, job.messageId);
	await message?.reactions.cache.get(BELL)?.remove().catch(() => {});
	return job;
}

// The reminder ping.
scheduler.register('event', async (guild, job) => {
	const channel = guild.channels.cache.get(job.channelId);
	if (!channel) return;
	const link = `https://discord.com/channels/${guild.id}/${job.channelId}/${job.messageId}`;
	const when = job.eventAt - Date.now() > 60000 ? `starts ${ts(job.eventAt, 'R')}` : 'is starting now';
	await channel.send({
		content: `${job.roleId ? `<@&${job.roleId}> ` : ''}**${job.title}** ${when}! ${link}`,
		allowedMentions: { roles: job.roleId ? [job.roleId] : [] },
	});
});

module.exports = { BELL, timezone, setTimezone, validTimezone, parseWhen, create, cancel, list: guildId => scheduler.list(guildId, 'event') };
