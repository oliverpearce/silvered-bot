// Carl-bot style embed maker. /embed send and /embed edit open a pop-up form (so the description
// can have multiple lines). For thumbnails, authors and fields, use the web dashboard.
const {
	SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags, ChannelType,
	ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { buildEmbed, embedToDraft, parseColor } = require('../../embeds');
const { fetchMessage } = require('../../messageLinks');

const EPHEMERAL = MessageFlags.Ephemeral;

const data = new SlashCommandBuilder()
	.setName('embed')
	.setDescription('Post or edit a custom embed')
	.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
	.setContexts(InteractionContextType.Guild)
	.addSubcommand(sub => sub
		.setName('send')
		.setDescription('Write an embed in a pop-up form and post it')
		.addChannelOption(o => o.setName('channel').setDescription('Where to post it (default: here)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
	.addSubcommand(sub => sub
		.setName('edit')
		.setDescription('Edit an embed the bot posted')
		.addStringOption(o => o.setName('message').setDescription('Link to the message (right-click → Copy Message Link), or its ID').setRequired(true)));

function input(id, label, { style = TextInputStyle.Short, max, value, placeholder } = {}) {
	const text = new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(false);
	if (max) text.setMaxLength(max);
	if (placeholder) text.setPlaceholder(placeholder);
	if (value) text.setValue(String(value).slice(0, max ?? 4000));
	return new LabelBuilder().setLabel(label).setTextInputComponent(text);
}

function embedModal(customId, title, draft = {}) {
	return new ModalBuilder()
		.setCustomId(customId)
		.setTitle(title)
		.addLabelComponents(
			input('title', 'Title', { max: 256, value: draft.title }),
			input('description', 'Description', { style: TextInputStyle.Paragraph, max: 4000, value: draft.description, placeholder: 'Supports **bold**, *italics*, <@&role id> mentions, emoji…' }),
			input('color', 'Colour (hex)', { max: 7, value: draft.color ?? '#ff69b4', placeholder: '#ff69b4' }),
			input('image', 'Image URL (big picture at the bottom)', { max: 2000, value: draft.image, placeholder: 'https://…' }),
			input('footer', 'Footer text', { max: 2048, value: draft.footer?.text }),
		);
}

const reply = (interaction, content) => interaction.reply({ content, flags: EPHEMERAL });

module.exports = {
	data,
	async execute(interaction) {
		const sub = interaction.options.getSubcommand();

		if (sub === 'send') {
			const channel = interaction.options.getChannel('channel') ?? interaction.channel;
			if (!channel.permissionsFor(interaction.guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
				return reply(interaction, `❌ I need View Channel, Send Messages and Embed Links in ${channel}.`);
			}
			if (!channel.permissionsFor(interaction.member)?.has(PermissionFlagsBits.SendMessages)) {
				return reply(interaction, `❌ You can't send messages in ${channel}.`);
			}
			return interaction.showModal(embedModal(`embed:send:${channel.id}`, 'New embed'));
		}

		const { message, error } = await fetchMessage(interaction, interaction.options.getString('message'));
		if (error) return reply(interaction, `❌ ${error}`);
		if (message.author.id !== interaction.client.user.id) return reply(interaction, '❌ I can only edit messages I sent.');
		const draft = message.embeds[0] ? embedToDraft(message.embeds[0]) : {};
		return interaction.showModal(embedModal(`embed:edit:${message.channelId}:${message.id}`, 'Edit embed', draft));
	},

	// Called from index.js when the pop-up form is submitted.
	async handleModal(interaction) {
		if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) return reply(interaction, '❌ You need Manage Messages.');
		const [, action, channelId, messageId] = interaction.customId.split(':');
		const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
		if (!channel || channel.guildId !== interaction.guildId || !channel.isTextBased()) return reply(interaction, '❌ That channel is gone.');

		let message = null;
		let draft = {};
		if (action === 'edit') {
			message = await channel.messages.fetch(messageId).catch(() => null);
			if (!message) return reply(interaction, '❌ That message is gone.');
			// Start from the existing embed so thumbnails, fields etc. survive the edit.
			if (message.embeds[0]) draft = embedToDraft(message.embeds[0]);
		}

		const get = id => interaction.fields.getTextInputValue(id) ?? '';
		const colorText = get('color').trim();
		if (colorText && parseColor(colorText) === null) return reply(interaction, '❌ The colour has to be a hex code like `#ff69b4`.');
		Object.assign(draft, {
			title: get('title'),
			description: get('description'),
			color: colorText || null,
			image: get('image').trim(),
			footer: { ...draft.footer, text: get('footer') },
		});

		let embed;
		try {
			embed = buildEmbed(draft);
		} catch (e) {
			return reply(interaction, `❌ ${e.message}`);
		}
		if (!embed) return reply(interaction, '❌ The embed is empty. Fill in at least a title or description.');

		try {
			if (message) {
				await message.edit({ embeds: [embed] });
				return reply(interaction, `✅ Embed updated: ${message.url}`);
			}
			const sent = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
			return reply(interaction, `✅ Embed posted: ${sent.url}`);
		} catch (e) {
			return reply(interaction, `❌ Discord refused it: ${e.message}`);
		}
	},
};
