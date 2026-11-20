// Carl-bot style self-assign role menus, using buttons instead of reactions.
// Button IDs carry the role ID ("rr:<roleId>" or "rru:<roleId>" for pick-one menus),
// so menus keep working after restarts with no database.
const {
	SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, InteractionContextType, MessageFlags,
	ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType,
} = require('discord.js');
const { botCantManage, memberCantManage } = require('../../roleUtils');

const MAX_ROLES = 10;
const EPHEMERAL = MessageFlags.Ephemeral;

function buildRows(buttons) {
	const rows = [];
	for (let i = 0; i < buttons.length; i += 5) {
		rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
	}
	return rows;
}

function makeButton(role, unique, emoji, label) {
	const b = new ButtonBuilder()
		.setCustomId(`${unique ? 'rru' : 'rr'}:${role.id}`)
		.setLabel((label || role.name).slice(0, 80))
		.setStyle(ButtonStyle.Secondary);
	if (emoji) b.setEmoji(emoji);
	return b;
}

// All role buttons on a menu message.
function menuButtons(message) {
	return message.components
		.flatMap(row => row.components ?? [])
		.filter(c => /^rru?:/.test(c.customId ?? ''));
}

const data = new SlashCommandBuilder()
	.setName('rolemenu')
	.setDescription('Self-assign role menus (games, pings, etc.)')
	.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
	.setContexts(InteractionContextType.Guild)
	.addSubcommand(sub => {
		sub.setName('create')
			.setDescription('Post a role menu with buttons people click to get/remove roles')
			.addStringOption(o => o.setName('title').setDescription('Menu title, e.g. "Pick your games"').setRequired(true))
			.addRoleOption(o => o.setName('role1').setDescription('First role').setRequired(true));
		for (let i = 2; i <= MAX_ROLES; i++) {
			sub.addRoleOption(o => o.setName(`role${i}`).setDescription(`Role #${i}`));
		}
		return sub
			.addStringOption(o => o.setName('description').setDescription('Text shown under the title'))
			.addBooleanOption(o => o.setName('pick_one').setDescription('Only allow one role from this menu at a time (default: no)'))
			.addChannelOption(o => o.setName('channel').setDescription('Where to post it (default: here)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement));
	})
	.addSubcommand(sub => sub
		.setName('add')
		.setDescription('Add a role to an existing menu')
		.addStringOption(o => o.setName('message_id').setDescription('ID of the menu message (right-click → Copy Message ID)').setRequired(true))
		.addRoleOption(o => o.setName('role').setDescription('Role to add').setRequired(true))
		.addStringOption(o => o.setName('emoji').setDescription('Optional emoji for the button')))
	.addSubcommand(sub => sub
		.setName('remove')
		.setDescription('Remove a role from an existing menu')
		.addStringOption(o => o.setName('message_id').setDescription('ID of the menu message').setRequired(true))
		.addRoleOption(o => o.setName('role').setDescription('Role to remove').setRequired(true)));

async function fetchMenu(interaction, messageId) {
	if (!/^\d{17,20}$/.test(messageId)) return null;
	const msg = await interaction.channel.messages.fetch(messageId).catch(() => null);
	if (!msg || msg.author.id !== interaction.client.user.id) return null;
	return msg;
}

module.exports = {
	buildRows,
	makeButton,
	data,
	async execute(interaction) {
		const sub = interaction.options.getSubcommand();

		if (sub === 'create') {
			const roles = [];
			for (let i = 1; i <= MAX_ROLES; i++) {
				const r = interaction.options.getRole(`role${i}`);
				if (r && !roles.some(x => x.id === r.id)) roles.push(r);
			}
			for (const r of roles) {
				const err = botCantManage(interaction.guild, r) || memberCantManage(interaction.member, r);
				if (err) return interaction.reply({ content: `❌ ${err}`, flags: EPHEMERAL });
			}

			const unique = interaction.options.getBoolean('pick_one') ?? false;
			const channel = interaction.options.getChannel('channel') ?? interaction.channel;
			const embed = new EmbedBuilder()
				.setColor('LuminousVividPink')
				.setTitle(interaction.options.getString('title'))
				.setDescription(
					(interaction.options.getString('description') ?? 'Click a button to get the role. Click again to remove it.') +
					(unique ? '\n*You can only have one role from this menu.*' : ''),
				);

			try {
				await channel.send({ embeds: [embed], components: buildRows(roles.map(r => makeButton(r, unique))) });
			} catch (e) {
				return interaction.reply({ content: `❌ I couldn't post in ${channel} (${e.message}). Check that I can view and send messages there.`, flags: EPHEMERAL });
			}
			return interaction.reply({ content: `✅ Role menu posted in ${channel}.`, flags: EPHEMERAL });
		}

		// add / remove edit an existing menu in this channel
		const msg = await fetchMenu(interaction, interaction.options.getString('message_id').trim());
		if (!msg) {
			return interaction.reply({ content: "❌ Couldn't find a role menu with that ID in this channel. Run this in the same channel as the menu.", flags: EPHEMERAL });
		}
		const role = interaction.options.getRole('role');
		const buttons = menuButtons(msg).map(c => ButtonBuilder.from(c));
		const unique = buttons.some(b => b.data.custom_id.startsWith('rru:'));

		if (sub === 'add') {
			const err = botCantManage(interaction.guild, role) || memberCantManage(interaction.member, role);
			if (err) return interaction.reply({ content: `❌ ${err}`, flags: EPHEMERAL });
			if (buttons.some(b => b.data.custom_id.endsWith(`:${role.id}`))) {
				return interaction.reply({ content: `${role} is already on that menu.`, flags: EPHEMERAL });
			}
			if (buttons.length >= 25) return interaction.reply({ content: '❌ A menu can hold at most 25 roles.', flags: EPHEMERAL });
			buttons.push(makeButton(role, unique, interaction.options.getString('emoji')));
		} else {
			const idx = buttons.findIndex(b => b.data.custom_id.endsWith(`:${role.id}`));
			if (idx === -1) return interaction.reply({ content: `${role} isn't on that menu.`, flags: EPHEMERAL });
			buttons.splice(idx, 1);
			if (buttons.length === 0) return interaction.reply({ content: '❌ That would leave the menu empty, so just delete the message instead.', flags: EPHEMERAL });
		}

		try {
			await msg.edit({ components: buildRows(buttons) });
		} catch (e) {
			// Usually a bad emoji in /rolemenu add
			return interaction.reply({ content: `❌ Discord rejected that change (${e.message}). If you gave an emoji, make sure it's a normal emoji or one from this server.`, flags: EPHEMERAL });
		}
		return interaction.reply({ content: '✅ Menu updated.', flags: EPHEMERAL });
	},

	// Called from index.js when someone clicks a role button.
	async handleButton(interaction) {
		const [kind, roleId] = interaction.customId.split(':');
		const guild = interaction.guild;
		const role = guild.roles.cache.get(roleId);
		if (!role) return interaction.reply({ content: "❌ That role doesn't exist anymore.", flags: EPHEMERAL });

		const err = botCantManage(guild, role);
		if (err) return interaction.reply({ content: `❌ ${err} (Tell a mod!)`, flags: EPHEMERAL });

		const member = interaction.member;
		if (member.roles.cache.has(roleId)) {
			await member.roles.remove(role, 'Role menu');
			return interaction.reply({ content: `➖ Removed ${role}.`, flags: EPHEMERAL });
		}

		if (kind === 'rru') {
			// Pick-one menu: drop the member's other roles from THIS menu and add the new one
			// in a single request, so they never end up with two (or zero) if a call fails midway.
			// Roles the bot can't manage (e.g. someone moved them above the bot) are left alone.
			const menuIds = new Set(menuButtons(interaction.message).map(c => c.customId.split(':')[1]));
			const swapOut = member.roles.cache.filter(r => r.id !== roleId && menuIds.has(r.id) && !botCantManage(guild, r));
			if (swapOut.size) {
				const next = member.roles.cache
					.filter(r => r.id !== guild.id && !swapOut.has(r.id))
					.map(r => r.id);
				next.push(roleId);
				await member.roles.set(next, 'Role menu (pick one)');
				return interaction.reply({ content: `➕ Gave you ${role} (swapped from ${swapOut.map(r => `${r}`).join(', ')}).`, flags: EPHEMERAL });
			}
		}

		await member.roles.add(role, 'Role menu');
		return interaction.reply({ content: `➕ Gave you ${role}.`, flags: EPHEMERAL });
	},
};
