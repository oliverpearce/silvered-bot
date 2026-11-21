// /event: post an event (time shows in everyone's own timezone) and ping a role before it starts.
const { SlashCommandBuilder, PermissionFlagsBits: P, InteractionContextType, MessageFlags, ChannelType } = require('discord.js');
const events = require('../../lib/events');

const EPHEMERAL = MessageFlags.Ephemeral;
const reply = (interaction, content) => interaction.reply({ content, flags: EPHEMERAL, allowedMentions: { parse: [] } });
const ts = (ms, style) => `<t:${Math.floor(ms / 1000)}:${style}>`;

const data = new SlashCommandBuilder()
	.setName('event')
	.setDescription('Events: post one and get its role pinged before it starts')
	.setDefaultMemberPermissions(P.ManageGuild)
	.setContexts(InteractionContextType.Guild)
	.addSubcommand(sub => sub
		.setName('create')
		.setDescription('Post an event')
		.addStringOption(o => o.setName('title').setDescription('e.g. Movie Night').setRequired(true).setMaxLength(200))
		.addStringOption(o => o.setName('when').setDescription('e.g. 2026-11-22 20:00, 22/11 8pm, tomorrow 7pm, in 2h').setRequired(true).setMaxLength(60))
		.addRoleOption(o => o.setName('role').setDescription('Role to ping (people can react 🔔 to get it)'))
		.addStringOption(o => o.setName('description').setDescription('Details. Use \\n for a new line').setMaxLength(2000))
		.addIntegerOption(o => o.setName('remind').setDescription('Minutes before the start to ping (default 15, 0 = at the start)').setMinValue(0).setMaxValue(10080))
		.addChannelOption(o => o.setName('channel').setDescription('Where to post it (default: here)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
	.addSubcommand(sub => sub
		.setName('list')
		.setDescription('Upcoming events'))
	.addSubcommand(sub => sub
		.setName('cancel')
		.setDescription('Cancel an event (its reminder is dropped and the post is marked cancelled)')
		.addStringOption(o => o.setName('id').setDescription('The event ID from /event list').setRequired(true).setAutocomplete(true)))
	.addSubcommand(sub => sub
		.setName('timezone')
		.setDescription('Set the timezone used for times you type, e.g. Europe/London or America/New_York')
		.addStringOption(o => o.setName('zone').setDescription('An IANA timezone name').setRequired(true).setAutocomplete(true)));

const ZONES = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC', 'Europe/London', 'America/New_York', 'America/Chicago', 'America/Los_Angeles'];

module.exports = {
	data,
	async execute(interaction) {
		const guild = interaction.guild;
		const subcommand = interaction.options.getSubcommand();

		if (subcommand === 'create') {
			const tz = events.timezone(guild.id);
			const at = events.parseWhen(interaction.options.getString('when'), tz);
			if (!at) return reply(interaction, `❌ I didn't understand that time. Try \`2026-11-22 20:00\`, \`22/11 8pm\`, \`20:00\` or \`in 2h\`. Times use **${tz}** (change with \`/event timezone\`).`);
			const channel = interaction.options.getChannel('channel') ?? interaction.channel;
			if (!channel.permissionsFor(guild.members.me)?.has([P.ViewChannel, P.SendMessages, P.EmbedLinks])) {
				return reply(interaction, `❌ I need View Channel, Send Messages and Embed Links in ${channel}.`);
			}
			await interaction.deferReply({ flags: EPHEMERAL });
			try {
				const { message, job, warnings } = await events.create(guild, channel, {
					title: interaction.options.getString('title'),
					description: (interaction.options.getString('description') ?? '').replace(/\\n/g, '\n'),
					at,
					roleId: interaction.options.getRole('role')?.id ?? null,
					remindMinutes: interaction.options.getInteger('remind') ?? 15,
				});
				return interaction.editReply({
					content: `✅ Posted ${message.url}\nStarts ${ts(at, 'F')} (${ts(at, 'R')}). Reminder ${ts(job.at, 'R')}. ID \`${job.id}\`${warnings.length ? `\n\n⚠️ ${warnings.join('\n⚠️ ')}` : ''}`,
					allowedMentions: { parse: [] },
				});
			} catch (e) {
				return interaction.editReply(`❌ ${e.message}`);
			}
		}

		if (subcommand === 'list') {
			const upcoming = events.list(guild.id);
			if (!upcoming.length) return reply(interaction, 'No upcoming events. Make one with `/event create`.');
			return reply(interaction, upcoming.slice(0, 20).map(e =>
				`\`${e.id}\` **${e.title}** ${ts(e.eventAt, 'F')}${e.roleId ? ` · <@&${e.roleId}>` : ''} · [post](https://discord.com/channels/${guild.id}/${e.channelId}/${e.messageId})`).join('\n'));
		}

		if (subcommand === 'cancel') {
			await interaction.deferReply({ flags: EPHEMERAL });
			const job = await events.cancel(guild, interaction.options.getString('id').trim());
			return interaction.editReply(job ? `✅ Cancelled **${job.title}**.` : '❌ No upcoming event with that ID. Check `/event list`.');
		}

		if (subcommand === 'timezone') {
			const zone = interaction.options.getString('zone').trim();
			if (!events.setTimezone(guild.id, zone)) return reply(interaction, '❌ That isn\'t a timezone I know. Pick one from the list, e.g. `Europe/London`.');
			return reply(interaction, `✅ Times you type now use **${zone}**. It's ${new Date().toLocaleString('en-GB', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' })} there now.`);
		}
	},
	async autocomplete(interaction) {
		const focused = interaction.options.getFocused(true);
		const typed = focused.value.toLowerCase();
		const choices = focused.name === 'id'
			? events.list(interaction.guildId).map(e => ({ name: `${e.title} (${new Date(e.eventAt).toUTCString().slice(0, 22)} UTC)`.slice(0, 100), value: e.id }))
			: ZONES.map(z => ({ name: z, value: z }));
		await interaction.respond(choices.filter(c => c.name.toLowerCase().includes(typed)).slice(0, 25)).catch(() => {});
	},
};
