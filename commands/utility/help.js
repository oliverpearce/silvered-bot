const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('help')
		.setDescription('The classic help command!'),
	async execute(interaction) {
        const embed = new EmbedBuilder()
            .setColor('LuminousVividPink')
            .setTitle(`**< __Help Center__ >**`)
            .addFields(
                { name: ':gear: Main Page', value: 'main menu for browsing commands!' },
                { name: ':tools: Utility Page', value: 'all the basic utility commands!' },
                { name: ':tada: Fun Page', value: `infinite fun! infinite fun commands!` },
            )
            .setFooter({ text: 'Main'})
            .setTimestamp()
            
        const embed2 = new EmbedBuilder()
            .setColor('LuminousVividPink')
            .setTitle(`:tools:   **< __Utility Center__ >**`)
            .addFields(
                { name: '/avatar *[mention]*', value: `displays avatar of the mentioned user`},
                { name: '/botstats', value: `displays statistics relating to the bot`},
                { name: '/help', value: `the classic help command`},
                { name: '/ping', value: `checks the ping of bot`},
                { name: '/server', value: `provides information about the server`},
                { name: '/user *[mention]*', value: `provides information about the mentioned user`},
            )
            .setFooter({ text: 'Utility' })
            .setTimestamp()

        const embed3 = new EmbedBuilder()
            .setColor('LuminousVividPink')
            .setTitle(`:tada:   **< __Fun Center__ >**`)
            .addFields(
                { name: '/pokeguess *[generation]*', value: `start a pokemon guessing game!`},
            )
            .setFooter({ text: 'Fun' })
            .setTimestamp()

        const button = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('main')
                .setLabel('-Main-')
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId('utility')
                .setLabel('-Utility-')
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId('fun')
                .setLabel('-Fun-')
                .setStyle(ButtonStyle.Primary)
        )

        const message = await interaction.reply({ embeds: [embed], components: [button] });
        const collector = await message.createMessageComponentCollector();

        collector.on('collect', async i => {
            if (i.customId === 'main') {
                if (i.user.id !== interaction.user.id) {
                    return await i.reply({ content: `Only ${interaction.user.tag} can use these buttons`, ephemeral: true})
                }
                await i.update({ embeds: [embed], components: [button] })
            }

            if (i.customId === 'utility') {
                if (i.user.id !== interaction.user.id) {
                    return await i.reply({ content: `Only ${interaction.user.tag} can use these buttons`, ephemeral: true})
                }
                await i.update({ embeds: [embed2], components: [button] })
            }

            if (i.customId === 'fun') {
                if (i.user.id !== interaction.user.id) {
                    return await i.reply({ content: `Only ${interaction.user.tag} can use these buttons`, ephemeral: true})
                }
                await i.update({ embeds: [embed3], components: [button] })
            }
        })
	},
};