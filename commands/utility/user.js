const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('user')
		.setDescription('Provides information about the mentioned user')
		.addUserOption(option =>
			option.setName('mention')
				.setDescription('The user to get information about')),
	async execute(interaction) {
		const user = interaction.options.getUser('mention') ?? interaction.user;
        const member = interaction.guild.members.cache.get(user.id);
        const nickname = member ? member.nickname : null;

        const embed = new EmbedBuilder()
			.setColor('LuminousVividPink')
			.setThumbnail(`${user.displayAvatarURL()}`)
			.addFields(
				{ name: 'Full name', value: `${user.username}#${user.discriminator}` , inline: true},
				{ name: 'Nickname', value: nickname || 'None', inline: true },
				{ name: 'Account created', value: `${user.createdAt.toDateString()}` , inline: true},
				{ name: 'Joined server', value: `${member.joinedAt.toDateString()}` , inline: true},
			)
			.setFooter({ text: `User ID: ${user.id}` });

		await interaction.reply({ embeds: [embed] });
	},
};