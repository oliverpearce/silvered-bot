const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const sts2 = require('../../lib/sts2');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('relic')
		.setDescription('Look up a Slay the Spire 2 relic (or type {{relic name}} in chat)')
		.addStringOption(option =>
			option.setName('name')
				.setDescription('The relic to look up')
				.setRequired(true)
				.setAutocomplete(true)
				.setMaxLength(60)),

	async execute(interaction) {
		const query = interaction.options.getString('name', true);
		const relic = sts2.findRelic(query);
		if (!relic) {
			const close = sts2.searchRelics(query, 3).map(r => `**${r.name}**`);
			return interaction.reply({
				content: `Couldn't find a relic called "${query}".${close.length ? ` Did you mean ${close.join(', ')}?` : ''}`,
				flags: MessageFlags.Ephemeral,
			});
		}
		await interaction.reply(sts2.buildRelicMessage(relic));
	},

	async autocomplete(interaction) {
		const focused = interaction.options.getFocused();
		await interaction.respond(sts2.searchRelics(focused, 25).map(r => ({
			name: (r.color ? `${r.name} (${r.color})` : r.name).slice(0, 100),
			value: r.name.slice(0, 100),
		})));
	},

	/** Buttons under a relic: customId is "sts2r:<variant>:<relic name>". */
	async handleButton(interaction) {
		const [, variant, ...rest] = interaction.customId.split(':');
		const relic = sts2.getRelic(rest.join(':'));
		if (!relic) return interaction.reply({ content: 'That relic isn\'t in the relic list any more.', flags: MessageFlags.Ephemeral });
		await interaction.update(sts2.buildRelicMessage(relic, variant));
	},

	/** Replies to {{relic name}} in a normal message. Up to 3 relics per message; unknown names are ignored. */
	async onMessage(message) {
		if (message.author.bot || !message.content.includes('{{')) return;
		const names = [...message.content.matchAll(/\{\{([^{}\n]{1,60})\}\}/g)].map(m => m[1]);
		const seen = new Set();
		for (const name of names) {
			const relic = sts2.findRelic(name);
			if (!relic || seen.has(relic.name)) continue;
			seen.add(relic.name);
			if (seen.size > 3) break;
			await message.reply({ ...sts2.buildRelicMessage(relic), allowedMentions: { repliedUser: false } });
		}
	},
};
