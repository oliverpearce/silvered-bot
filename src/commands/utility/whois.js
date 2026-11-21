// /whois: a "who's who" list of everyone in the server, with a note about each person.
const { SlashCommandBuilder, PermissionFlagsBits: P, InteractionContextType, MessageFlags, ChannelType } = require('discord.js');
const whois = require('../../lib/whois');

const EPHEMERAL = MessageFlags.Ephemeral;
const reply = (interaction, content) => interaction.reply({ content, flags: EPHEMERAL, allowedMentions: { parse: [] } });

const data = new SlashCommandBuilder()
	.setName('whois')
	.setDescription('Who\'s who: a list of everyone in the server with a note about each person')
	.setDefaultMemberPermissions(P.ManageRoles)
	.setContexts(InteractionContextType.Guild)
	.addSubcommand(sub => sub
		.setName('set')
		.setDescription('Write a note about someone, e.g. "owner, makes the bot"')
		.addUserOption(o => o.setName('user').setDescription('Who').setRequired(true))
		.addStringOption(o => o.setName('note').setDescription('Short note').setRequired(true).setMaxLength(whois.MAX_NOTE))
		.addBooleanOption(o => o.setName('lock').setDescription('Stop them changing it with /aboutme (default: leave as is)')))
	.addSubcommand(sub => sub
		.setName('clear')
		.setDescription('Remove someone\'s note (they stay on the list)')
		.addUserOption(o => o.setName('user').setDescription('Who').setRequired(true)))
	.addSubcommand(sub => sub
		.setName('lock')
		.setDescription('Lock or unlock someone\'s note so they can\'t change it with /aboutme')
		.addUserOption(o => o.setName('user').setDescription('Who').setRequired(true))
		.addBooleanOption(o => o.setName('locked').setDescription('Locked?').setRequired(true)))
	.addSubcommand(sub => sub
		.setName('post')
		.setDescription('Post the list (replaces the old one). It updates itself after that')
		.addChannelOption(o => o.setName('channel').setDescription('Where (default: here)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
	.addSubcommand(sub => sub
		.setName('unpost')
		.setDescription('Delete the posted list and stop updating it'));

module.exports = {
	data,
	async execute(interaction) {
		const guild = interaction.guild;
		const subcommand = interaction.options.getSubcommand();

		if (subcommand === 'set' || subcommand === 'clear') {
			const user = interaction.options.getUser('user');
			if (user.bot) return reply(interaction, '❌ Bots aren\'t on the list.');
			const note = whois.setNote(guild, user.id, subcommand === 'set' ? interaction.options.getString('note') : '');
			const lock = interaction.options.getBoolean('lock');
			if (lock !== null) whois.setLocked(guild.id, user.id, lock);
			const tail = whois.postedInfo(guild) ? ' The posted list updates in a few seconds.' : ' Post the list with `/whois post`.';
			return reply(interaction, (note ? `✅ ${user} — ${note}` : `✅ Cleared ${user}'s note.`) + tail);
		}

		if (subcommand === 'lock') {
			const user = interaction.options.getUser('user');
			const locked = interaction.options.getBoolean('locked');
			whois.setLocked(guild.id, user.id, locked);
			return reply(interaction, locked ? `🔒 ${user} can't change their note with /aboutme now.` : `🔓 ${user} can change their note with /aboutme again.`);
		}

		if (subcommand === 'post') {
			const channel = interaction.options.getChannel('channel') ?? interaction.channel;
			if (!channel.permissionsFor(guild.members.me)?.has([P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory])) {
				return reply(interaction, `❌ I need View Channel, Send Messages, Embed Links and Read Message History in ${channel}.`);
			}
			await interaction.deferReply({ flags: EPHEMERAL });
			try {
				const { url } = await whois.post(guild, channel);
				return interaction.editReply(`✅ Posted: ${url}\nIt updates itself when notes change or people join, leave or change roles.`);
			} catch (e) {
				return interaction.editReply(`❌ Couldn't post it (${e.message}).`);
			}
		}

		if (subcommand === 'unpost') {
			await interaction.deferReply({ flags: EPHEMERAL });
			return interaction.editReply(await whois.unpost(guild) ? '✅ Deleted the list. Notes are kept, so `/whois post` brings it back.' : 'There\'s no posted list.');
		}
	},
};
