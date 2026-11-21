// Finds a message from a link or ID typed into a slash command.
const { PermissionFlagsBits } = require('discord.js');

const LINK = /discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})/;

/** Splits a message link into IDs. Returns null if it isn't one. */
function parseMessageLink(text) {
	const m = LINK.exec(text ?? '');
	return m ? { guildId: m[1], channelId: m[2], messageId: m[3] } : null;
}

/**
 * Returns { message } or { error }.
 * `input` can be a message link, or a plain message ID (looked up in `fallbackChannelId`, default: this channel).
 */
async function fetchMessage(interaction, input, fallbackChannelId) {
	const text = (input ?? '').trim();
	let channelId;
	let messageId;
	const link = parseMessageLink(text);
	if (link) {
		if (link.guildId !== interaction.guildId) return { error: 'That message link is from a different server.' };
		({ channelId, messageId } = link);
	} else if (/^\d{17,20}$/.test(text)) {
		messageId = text;
		channelId = fallbackChannelId ?? interaction.channelId;
	} else {
		return { error: 'That isn\'t a message link or ID. Right-click the message → **Copy Message Link** and paste that.' };
	}

	const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
	if (!channel || channel.guildId !== interaction.guildId || !channel.isTextBased()) {
		return { error: 'I can\'t find or see that channel.' };
	}
	// Don't let people poke at channels they can't see themselves.
	if (!channel.permissionsFor(interaction.member)?.has(PermissionFlagsBits.ViewChannel)) {
		return { error: 'You can\'t see that channel.' };
	}
	const message = await channel.messages.fetch(messageId).catch(() => null);
	if (!message) {
		return { error: link ? 'I couldn\'t find that message. It may have been deleted, or I can\'t read that channel.' : 'I couldn\'t find that message in this channel. Paste the message **link** instead of the ID.' };
	}
	return { message };
}

module.exports = { parseMessageLink, fetchMessage };
