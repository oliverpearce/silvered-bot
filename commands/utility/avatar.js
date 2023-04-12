const { SlashCommandBuilder } = require('discord.js');
const { EmbedBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('avatar')
		.setDescription('Displays avatar of the user.'),
	async execute(interaction) {
        const user = interaction.user;
        const embed = new EmbedBuilder()
            .setTitle(`${user.username}'s avatar!`)
            .setColor('LuminousVividPink')
            .setImage(`${user.displayAvatarURL({size: 1024, format: 'png', dynamic: true})}`)

		await interaction.reply({ embeds: [embed] });
	},
};