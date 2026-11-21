// Mod log: posts joins, leaves, bans, deleted/edited messages, nickname and role changes in a channel.
// Set the channel on the dashboard (Settings). Saved under "modlog": { channelId }.
const { EmbedBuilder, Events, AuditLogEvent } = require('discord.js');
const storage = require('./storage');

const KEY = 'modlog';
const COLORS = { join: 0x2ecc71, leave: 0xe67e22, ban: 0xe74c3c, unban: 0x3498db, delete: 0xe74c3c, edit: 0xf1c40f, member: 0x9b59b6 };

const channelId = guildId => storage.get(guildId, KEY)?.channelId ?? null;
const setChannel = (guildId, id) => storage.set(guildId, KEY, id ? { channelId: id } : null);

const cut = (s, n = 1000) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s) || '*(no text)*';

async function log(guild, kind, { title, description, fields = [], user }) {
	const id = channelId(guild.id);
	const channel = id && guild.channels.cache.get(id);
	if (!channel?.isTextBased()) return;
	const embed = new EmbedBuilder().setColor(COLORS[kind]).setTitle(title).setTimestamp();
	if (description) embed.setDescription(description.slice(0, 4096));
	if (fields.length) embed.addFields(fields.slice(0, 25));
	if (user) embed.setAuthor({ name: user.tag ?? user.username, iconURL: user.displayAvatarURL() }).setFooter({ text: `User ID: ${user.id}` });
	await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(e => console.warn('[modlog]', e.message));
}

const fromLogChannel = message => message.channelId === channelId(message.guildId);

/** Hooks the mod log up to the bot's events. */
function attach(client) {
	client.on(Events.GuildMemberAdd, m => {
		const days = Math.floor((Date.now() - m.user.createdTimestamp) / 864e5);
		log(m.guild, 'join', {
			title: 'Member joined', user: m.user,
			description: `<@${m.id}> joined. Account made <t:${Math.floor(m.user.createdTimestamp / 1000)}:R>${days < 7 ? ' ⚠️ **new account**' : ''}.`,
		});
	});
	client.on(Events.GuildMemberRemove, m => {
		const roles = m.roles?.cache?.filter(r => r.id !== m.guild.id).map(r => `<@&${r.id}>`).join(' ');
		log(m.guild, 'leave', { title: 'Member left', user: m.user, description: `<@${m.id}> left.${roles ? `\nRoles: ${roles}` : ''}` });
	});
	client.on(Events.GuildBanAdd, ban => log(ban.guild, 'ban', { title: 'Member banned', user: ban.user, description: `<@${ban.user.id}>${ban.reason ? `\nReason: ${ban.reason}` : ''}` }));
	client.on(Events.GuildBanRemove, ban => log(ban.guild, 'unban', { title: 'Member unbanned', user: ban.user, description: `<@${ban.user.id}>` }));

	client.on(Events.MessageDelete, message => {
		if (!message.guild || message.author?.bot || fromLogChannel(message)) return;
		log(message.guild, 'delete', {
			title: 'Message deleted', user: message.author ?? undefined,
			description: message.partial
				? `A message in <#${message.channelId}> was deleted (sent before the bot last restarted, so its text isn't known).`
				: `By <@${message.author.id}> in <#${message.channelId}>\n\n${cut(message.content, 3500)}`,
			fields: message.attachments?.size ? [{ name: 'Attachments', value: cut(message.attachments.map(a => a.name).join(', ')) }] : [],
		});
	});
	client.on(Events.MessageUpdate, (before, after) => {
		if (!after.guild || after.author?.bot || before.partial || before.content === after.content || fromLogChannel(after)) return;
		log(after.guild, 'edit', {
			title: 'Message edited', user: after.author,
			description: `By <@${after.author.id}> in <#${after.channelId}> · [jump](${after.url})`,
			fields: [{ name: 'Before', value: cut(before.content) }, { name: 'After', value: cut(after.content) }],
		});
	});

	client.on(Events.GuildMemberUpdate, async (before, after) => {
		if (before.partial) return;
		const fields = [];
		if (before.nickname !== after.nickname) fields.push({ name: 'Nickname', value: `${before.nickname ?? '*(none)*'} → ${after.nickname ?? '*(none)*'}` });
		const added = after.roles.cache.filter(r => !before.roles.cache.has(r.id));
		const removed = before.roles.cache.filter(r => !after.roles.cache.has(r.id));
		if (added.size) fields.push({ name: 'Roles added', value: added.map(r => `<@&${r.id}>`).join(' ').slice(0, 1024) });
		if (removed.size) fields.push({ name: 'Roles removed', value: removed.map(r => `<@&${r.id}>`).join(' ').slice(0, 1024) });
		if (!fields.length) return;
		// Who did it (needs View Audit Log). Reaction roles show up as the bot.
		let by = '';
		const entry = await after.guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 1 }).then(l => l.entries.first()).catch(() => null);
		if (entry && entry.target?.id === after.id && Date.now() - entry.createdTimestamp < 10000 && (added.size || removed.size)) {
			by = ` by <@${entry.executor.id}>${entry.reason ? ` (${entry.reason})` : ''}`;
		}
		log(after.guild, 'member', { title: 'Member updated', user: after.user, description: `<@${after.id}>${by}`, fields });
	});
}

module.exports = { channelId, setChannel, attach };
