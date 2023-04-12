const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('botstats')
		.setDescription('Displays statistics relating to the bot.'),
	async execute(interaction) {
        const client = interaction.client;
        const icon = `${client.user.displayAvatarURL()}`;
        let serverCount = await client.guilds.cache.reduce((a,b) => a+b.memberCount, 0);

        let totalSeconds = (client.uptime / 1000);
        let days = Math.floor(totalSeconds / 86400);
        totalSeconds %= 86400;
        let hours = Math.floor(totalSeconds / 3600);
        totalSeconds %= 3600;
        let minutes = Math.floor(totalSeconds / 60);
        totalSeconds %= 60;
        let seconds = Math.floor(totalSeconds)

        let uptime = `${days} days, ${hours} hours, ${minutes} minutes, ${seconds} seconds`;

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Bot Invite')
                    .setStyle(ButtonStyle.Link)
                    .setURL('https://discord.com/api/oauth2/authorize?client_id=731213329124818986&permissions=8&scope=bot')
        );

        const embed = new EmbedBuilder()
            .setColor('LuminousVividPink')
            .setAuthor({ name: 'Silvered Bot', iconURL: icon })
            .setThumbnail(`${icon}`)
            .setFooter({ text: `Bot ID: ${client.user.id}` })
            .setTimestamp()
            .addFields(
                { name: 'Servers', value: `${client.guilds.cache.size}` , inline: true},
                { name: 'Users', value: `${serverCount}`, inline: true },
                { name: 'Creator', value: `Silver#6288`, inline: true },
                { name: 'Uptime', value: `\`\`\`${uptime}\`\`\``},
            );
            
        await interaction.reply({ embeds: [embed], components: [row] });
	},
};