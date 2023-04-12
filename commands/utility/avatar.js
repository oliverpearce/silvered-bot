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
            .setImage(`${user.displayAvatarURL({size: 1024, format: 'png', dynamic: true})}`)
            // .setURL(user.displayAvatarURL());
            // .setTimestamp();
            .setFooter({text: `made by ${user.username}`, iconURL: `${user.displayAvatarURL()}`});

		// interaction.guild is the object representing the Guild in which the command was run
		await interaction.reply({ embeds: [embed] });
	},
};