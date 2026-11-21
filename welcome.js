// Welcome and goodbye messages. Set up on the dashboard (Settings).
// Saved in data/settings.json under "welcome": { join: { channelId, text, color }, leave: { ... } }
// Placeholders: {user} (mention), {name}, {username}, {server}, {count} (member count)
const { EmbedBuilder } = require('discord.js');
const storage = require('./storage');

const KEY = 'welcome';
const DEFAULTS = {
	join: { channelId: null, text: 'Welcome to **{server}**, {user}! You\'re member #{count} 🎉', color: '#ff69b4' },
	leave: { channelId: null, text: '**{name}** left the server. 👋', color: '#99aab5' },
};

function get(guildId) {
	const saved = storage.get(guildId, KEY) ?? {};
	return { join: { ...DEFAULTS.join, ...saved.join }, leave: { ...DEFAULTS.leave, ...saved.leave } };
}

function set(guildId, which, value) {
	const current = storage.get(guildId, KEY) ?? {};
	current[which] = value;
	storage.set(guildId, KEY, current);
}

const fill = (text, member) => text
	.replace(/\{user\}/g, `<@${member.id}>`)
	.replace(/\{name\}/g, member.displayName ?? member.user.username)
	.replace(/\{username\}/g, member.user.username)
	.replace(/\{server\}/g, member.guild.name)
	.replace(/\{count\}/g, String(member.guild.memberCount));

function build(member, cfg) {
	const color = /^#[0-9a-f]{6}$/i.test(cfg.color ?? '') ? parseInt(cfg.color.slice(1), 16) : 0xff69b4;
	const embed = new EmbedBuilder().setColor(color).setDescription(fill(cfg.text, member).slice(0, 4096));
	const avatar = member.user.displayAvatarURL({ size: 256 });
	if (/^https?:\/\//.test(avatar)) embed.setThumbnail(avatar);
	return embed;
}

/** Sends the join or leave message for this member. Returns false when it's turned off. */
async function send(member, which, { test = false } = {}) {
	const cfg = get(member.guild.id)[which];
	if (!cfg.channelId || !cfg.text) return false;
	const channel = member.guild.channels.cache.get(cfg.channelId);
	if (!channel?.isTextBased()) return false;
	// Joins ping the new member (so they see it); leaves never ping.
	const ping = which === 'join' && !test;
	await channel.send({
		content: ping ? `<@${member.id}>` : undefined,
		embeds: [build(member, cfg)],
		allowedMentions: { users: ping ? [member.id] : [] },
	});
	return true;
}

module.exports = { DEFAULTS, get, set, send };
