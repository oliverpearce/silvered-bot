const { SlashCommandBuilder, EmbedBuilder, ApplicationCommandOptionType } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('avatar')
		.setDescription('Displays avatar of the mentioned user.')
		.addUserOption(option =>
			option.setName('mention')
				.setDescription('The user to show the avatar of.')),
	async execute(interaction) {
        const user = interaction.options.getUser('mention') ?? interaction.user;
        const member = interaction.guild.members.cache.get(user.id);
        
        const embed = new EmbedBuilder()
            .setTitle(`${member.displayName}'s avatar!`)
            .setColor('LuminousVividPink')
            .setImage(`${user.displayAvatarURL({size: 1024, format: 'png', dynamic: true})}`)
            .setFooter({ text: `Requested by ${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL()}`});

		await interaction.reply({ embeds: [embed] });
	},
};