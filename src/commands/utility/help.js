const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('help')
		.setDescription('The classic help command!'),
	async execute(interaction) {
        const embed = new EmbedBuilder()
            .setColor('LuminousVividPink')
            .setTitle(`:house:   **< __Help Center__ >**`)
            .addFields(
                { name: ':gear:  Main Page', value: 'main menu for browsing commands!\n' },
                { name: ':tools:  Utility Page', value: 'all the basic utility commands!\n' },
                { name: ':tada:  Fun Page', value: `infinite fun! infinite fun commands!\n` },
                { name: ':label:  Roles Page', value: `role menus, staff roles, autorole!\n` },
            )
            .setFooter({ text: 'Main'})
            .setTimestamp()
            
        const embed2 = new EmbedBuilder()
            .setColor('LuminousVividPink')
            .setTitle(`:tools:   **< __Utility Center__ >**`)
            .addFields(
                { name: '/avatar *[mention]*', value: `displays avatar of the mentioned user`},
                { name: '/botstats', value: `displays statistics relating to the bot`},
                { name: '/dashboard', value: `get your private dashboard login link (needs Administrator)`},
                { name: '/help', value: `the classic help command`},
                { name: '/ping', value: `checks the ping of bot`},
                { name: '/server', value: `provides information about the server`},
                { name: '/status set | show | reset', value: `change the bot's status (bot owner)`},
                { name: '/url-lookup', value: `extract info from a url`},
                { name: '/user *[mention]*', value: `provides information about the mentioned user`},
            )
            .setFooter({ text: 'Utility' })
            .setTimestamp()

        const embed3 = new EmbedBuilder()
            .setColor('LuminousVividPink')
            .setTitle(`:tada:   **< __Fun Center__ >**`)
            .addFields(
                { name: '/pokeguess *[generation]*', value: `start a pokemon guessing game!`},
                { name: '/echo *[input]*', value: `replies with your input!`},
                { name: '/card *[name]*  or  [[card name]]', value: `look up a Slay the Spire 2 card, with buttons for upgraded and beta art`},
            )
            .setFooter({ text: 'Fun' })
            .setTimestamp()

        const embed4 = new EmbedBuilder()
            .setColor('LuminousVividPink')
            .setTitle(`:label:   **< __Role Center__ >**`)
            .addFields(
                { name: '/rolemenu create', value: `post a button menu people click to get roles (games, pings...)`},
                { name: '/rolemenu add | remove', value: `add/remove a role on an existing menu`},
                { name: '/reactionrole create | add | remove', value: `reaction role menus: react with an emoji to get a role`},
                { name: '/reactionrole edit | list | delete', value: `set a menu's category (games, events...) or pick-one, list or delete menus`},
                { name: '/embed send | edit', value: `post or edit a custom embed with a pop-up form`},
                { name: '/whois set | clear | lock | post | unpost', value: `who's who: everyone in the server with a note, grouped by role (updates itself)`},
                { name: '/aboutme', value: `write your own line on the who's who list`},
                { name: '/event create | list | cancel | timezone', value: `post an event and ping its role before it starts`},
                { name: '/roles-import', value:`paste a list of role names: creates them and posts a button menu per category`},
                { name: '/setup-roles', value:`create Mod > Semi-Mod > Perms > Non-User roles (admins)`},
                { name: '/role add | remove | info', value: `give or take a role from someone`},
                { name: '/autorole set | off | show', value: `give new members a role automatically`},
            )
            .setFooter({ text: 'Roles' })
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
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId('roles')
                .setLabel('-Roles-')
                .setStyle(ButtonStyle.Primary)
        )

        const message = await interaction.reply({ embeds: [embed], components: [button] });
        const collector = message.createMessageComponentCollector({ time: 5 * 60 * 1000 });

        collector.on('collect', async i => {
            if (i.customId === 'main') {
                if (i.user.id !== interaction.user.id) {
                    return await i.reply({ content: `Only ${interaction.user.tag} can use these buttons`, flags: MessageFlags.Ephemeral })
                }
                await i.update({ embeds: [embed], components: [button] })
            }

            if (i.customId === 'utility') {
                if (i.user.id !== interaction.user.id) {
                    return await i.reply({ content: `Only ${interaction.user.tag} can use these buttons`, flags: MessageFlags.Ephemeral })
                }
                await i.update({ embeds: [embed2], components: [button] })
            }

            if (i.customId === 'fun') {
                if (i.user.id !== interaction.user.id) {
                    return await i.reply({ content: `Only ${interaction.user.tag} can use these buttons`, flags: MessageFlags.Ephemeral })
                }
                await i.update({ embeds: [embed3], components: [button] })
            }

            if (i.customId === 'roles') {
                if (i.user.id !== interaction.user.id) {
                    return await i.reply({ content: `Only ${interaction.user.tag} can use these buttons`, flags: MessageFlags.Ephemeral })
                }
                await i.update({ embeds: [embed4], components: [button] })
            }
        })
	},
};
