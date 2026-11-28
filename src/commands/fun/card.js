const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const sts2 = require('../../lib/sts2');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('card')
		.setDescription('Look up a Slay the Spire 2 card (or type [[card name]] in chat)')
		.addStringOption(option =>
			option.setName('name')
				.setDescription('The card to look up')
				.setRequired(true)
				.setAutocomplete(true)
				.setMaxLength(60)),

	async execute(interaction) {
		const query = interaction.options.getString('name', true);
		const card = sts2.findCard(query);
		if (!card) {
			const close = sts2.searchCards(query, 3).map(c => `**${c.name}**`);
			return interaction.reply({
				content: `Couldn't find a card called "${query}".${close.length ? ` Did you mean ${close.join(', ')}?` : ''}`,
				flags: MessageFlags.Ephemeral,
			});
		}
		await interaction.deferReply();
		await interaction.editReply(await sts2.buildCardMessage(card, 'base'));
	},

	async autocomplete(interaction) {
		const focused = interaction.options.getFocused();
		await interaction.respond(sts2.searchCards(focused, 25).map(c => ({ name: `${c.name} (${c.color})`.slice(0, 100), value: c.name.slice(0, 100) })));
	},

	/** Buttons under a card: customId is "sts2:<variant>:<card name>". */
	async handleButton(interaction) {
		const [, variant, ...rest] = interaction.customId.split(':');
		const card = sts2.getCard(rest.join(':'));
		if (!card) return interaction.reply({ content: 'That card isn\'t in the card list any more.', flags: MessageFlags.Ephemeral });
		await interaction.deferUpdate();
		// embeds: [] clears the old embed layout on cards posted before the new layout.
		await interaction.editReply({ ...await sts2.buildCardMessage(card, variant), embeds: [] });
	},

	/** Replies to [[card name]] in a normal message. Up to 3 cards per message; unknown names are ignored. */
	async onMessage(message) {
		if (message.author.bot || !message.content.includes('[[')) return;
		const names = [...message.content.matchAll(/\[\[([^[\]\n]{1,60})\]\]/g)].map(m => m[1]);
		const seen = new Set();
		for (const name of names) {
			const card = sts2.findCard(name);
			if (!card || seen.has(card.name)) continue;
			seen.add(card.name);
			if (seen.size > 3) break;
			await message.reply({ ...await sts2.buildCardMessage(card, 'base'), allowedMentions: { repliedUser: false } });
		}
	},
};
