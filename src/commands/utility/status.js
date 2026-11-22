const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, InteractionContextType } = require('discord.js');
const presence = require('../../lib/presence');

const STREAM_URL = /^https:\/\/(www\.)?(twitch\.tv|youtube\.com)\/\S+$/i;

// The status shows in every server, so only the bot's owner (or its Developer Portal team) can change it.
async function isBotOwner(interaction) {
	const { owner } = await interaction.client.application.fetch();
	if (!owner) return false;
	return owner.members ? owner.members.has(interaction.user.id) : owner.id === interaction.user.id;
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('status')
		.setDescription('Change the bot\'s Discord status')
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.setContexts(InteractionContextType.Guild)
		.addSubcommand(s => s.setName('set').setDescription('Set the bot\'s status')
			.addStringOption(o => o.setName('type').setDescription('What the bot is doing').setRequired(true)
				.addChoices(...Object.entries(presence.ACTIVITY_TYPES).map(([value, { label }]) => ({ name: label, value }))))
			.addStringOption(o => o.setName('text').setDescription('The status text').setRequired(true).setMaxLength(128))
			.addStringOption(o => o.setName('online').setDescription('The coloured status dot (keeps the current one if blank)')
				.addChoices(...Object.entries(presence.ONLINE_STATES).map(([value, name]) => ({ name, value }))))
			.addStringOption(o => o.setName('url').setDescription('Twitch or YouTube link (required for Streaming)')))
		.addSubcommand(s => s.setName('show').setDescription('Show the bot\'s current status'))
		.addSubcommand(s => s.setName('reset').setDescription('Go back to Listening to you <3')),
	async execute(interaction) {
		const reply = content => interaction.reply({ content, flags: MessageFlags.Ephemeral });
		const sub = interaction.options.getSubcommand();

		if (sub === 'show') return reply(`Current status: ${presence.describe(presence.getStatus())}`);
		if (!await isBotOwner(interaction)) return reply('❌ Only the bot\'s owner can change its status.');

		if (sub === 'reset') {
			presence.resetStatus(interaction.client);
			return reply(`✅ Status reset to ${presence.describe(presence.getStatus())}`);
		}

		const type = interaction.options.getString('type', true);
		const text = interaction.options.getString('text', true).trim();
		const url = interaction.options.getString('url')?.trim();
		if (!text) return reply('❌ The status text can\'t be blank.');
		if (type === 'streaming' && !STREAM_URL.test(url ?? '')) return reply('❌ Streaming needs an `https://` Twitch or YouTube link in `url`.');

		const status = {
			type,
			text,
			online: interaction.options.getString('online') ?? presence.getStatus().online,
			...(type === 'streaming' ? { url } : {}),
		};
		presence.setStatus(interaction.client, status);
		return reply(`✅ Status set to ${presence.describe(status)}`);
	},
};
