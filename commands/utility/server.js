const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('server')
		.setDescription('Provides information about the server'),
	async execute(interaction) {
		const numBots = interaction.guild.members.cache.filter((member) => member.user.bot).size;

        const embed = new EmbedBuilder()
            .setTitle(`:gear:   < ${interaction.guild.name} >`)
			.setColor('LuminousVividPink')
			.setImage(`${interaction.guild.iconURL({size: 256})}`)
			.addFields(
				{ name: 'Users', value: `${interaction.guild.memberCount - numBots}` , inline: true},
				{ name: 'Bots', value: `${numBots}`, inline: true },
				{ name: 'Total members', value: `${interaction.guild.memberCount}`, inline: true },
				{ name: 'Server created', value: `${interaction.guild.createdAt.toDateString()}`},
			)
			.setFooter({ text: `Guild ID: ${interaction.guild.id}` });

		await interaction.reply({ embeds: [embed] });
	},
};