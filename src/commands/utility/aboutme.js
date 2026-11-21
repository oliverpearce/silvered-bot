// /aboutme: anyone can write their own line on the server's "who's who" list.
const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const whois = require('../../lib/whois');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('aboutme')
		.setDescription('Write your line on the who\'s who list (leave note empty to see or clear it)')
		.setContexts(InteractionContextType.Guild)
		.addStringOption(o => o.setName('note').setDescription('A short line about you, e.g. "art + minecraft, ask me for skins"').setMaxLength(whois.MAX_NOTE))
		.addBooleanOption(o => o.setName('clear').setDescription('Remove your note')),
	async execute(interaction) {
		const reply = content => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
		const guild = interaction.guild;
		const note = interaction.options.getString('note');
		const clear = interaction.options.getBoolean('clear');
		const current = whois.getNote(guild.id, interaction.user.id);

		if (!note && !clear) {
			return reply(current ? `Your note: **${current}**${whois.isLocked(guild.id, interaction.user.id) ? ' (locked by staff)' : ''}` : 'You don\'t have a note yet. Add one with `/aboutme note:...`');
		}
		if (whois.isLocked(guild.id, interaction.user.id)) return reply('🔒 Staff locked your note, so ask them to change it.');
		const saved = whois.setNote(guild, interaction.user.id, clear ? '' : note);
		return reply(saved ? `✅ Your note is now: **${saved}**` : '✅ Removed your note.');
	},
};
