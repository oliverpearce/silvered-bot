const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('echo')
		.setDescription('Replies with your input!')
        .addUserOption(option =>
			option.setName('input')
				.setDescription('what will silvered say?')
                .setRequired(true)),
    async execute(interaction) {
        const input = interaction.options.getString("input");
        await interaction.reply(input);
    }
};

