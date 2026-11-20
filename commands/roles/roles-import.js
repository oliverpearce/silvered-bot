// /roles-import: paste a list of roles, get the roles created and a reaction menu per category.
//
//   # Games
//   🎮 Minecraft #2ecc71
//   🔫 Valorant
//   # Pronouns (pick one)
//   💙 he/him
//
// "# Heading" starts a category (one menu each; "(pick one)" makes it pick-one).
// Each other line is: emoji, role name, optional #hex colour.
// Roles that already exist (same name) are reused, not duplicated. Nothing is deleted.
const {
	SlashCommandBuilder, PermissionFlagsBits: P, InteractionContextType, MessageFlags, ChannelType, EmbedBuilder,
	ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const roleMenus = require('../../roleMenus');
const { botCantManage, memberCantManage } = require('../../roleUtils');
const { parseColor } = require('../../embeds');
const { syncList } = require('./reactionrole');

const EPHEMERAL = MessageFlags.Ephemeral;
const MAX_ITEMS = 20; // reactions per message
const DEFAULT_COLOR = 0xff69b4;
const INTRO = 'React below to get a role. Remove your reaction to lose it.';
const CUSTOM_EMOJI = /^<a?:\w{2,32}:\d{17,20}>$/;
const UNICODE_EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;
const EXAMPLE = '# Games\n🎮 Minecraft #2ecc71\n🔫 Valorant\n# Events\n🎬 Movie Night\n# Pronouns (pick one)\n💙 he/him\n💗 she/her';

/** Turns the pasted text into [{ category, unique, items: [{ emoji, name, color }] }] plus a list of problems. */
function parse(text) {
	const groups = [];
	const problems = [];
	let current = null;
	text.split('\n').forEach((raw, i) => {
		const line = raw.trim();
		if (!line) return;
		if (line.startsWith('#') && !/^#[0-9a-f]{6}$/i.test(line)) {
			const heading = line.replace(/^#+/, '').trim();
			const unique = /\(pick one\)\s*$/i.test(heading);
			current = { category: heading.replace(/\(pick one\)\s*$/i, '').trim().slice(0, 50) || 'Roles', unique, items: [] };
			groups.push(current);
			return;
		}
		const parts = line.split(/\s+/);
		const emoji = parts.shift();
		let color = null;
		if (parts.length && /^#[0-9a-f]{6}$/i.test(parts.at(-1))) color = parseColor(parts.pop());
		const name = parts.join(' ').slice(0, 100);
		if (!CUSTOM_EMOJI.test(emoji) && !UNICODE_EMOJI.test(emoji)) return problems.push(`Line ${i + 1}: \`${line.slice(0, 60)}\` must start with an emoji`);
		if (!name) return problems.push(`Line ${i + 1}: no role name after ${emoji}`);
		if (!current) { current = { category: 'Roles', unique: false, items: [] }; groups.push(current); }
		current.items.push({ emoji, name, color });
	});
	return { groups: groups.filter(g => g.items.length), problems };
}

const data = new SlashCommandBuilder()
	.setName('roles-import')
	.setDescription('Paste a list of roles: creates them and posts a reaction menu per category')
	.setDefaultMemberPermissions(P.ManageRoles)
	.setContexts(InteractionContextType.Guild)
	.addChannelOption(o => o.setName('channel').setDescription('Where to post the menus (default: here)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement));

async function execute(interaction) {
	const channel = interaction.options.getChannel('channel') ?? interaction.channel;
	const me = interaction.guild.members.me;
	if (!me.permissions.has(P.ManageRoles)) {
		return interaction.reply({ content: '❌ I need the **Manage Roles** permission first.', flags: EPHEMERAL });
	}
	const needed = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AddReactions, P.ReadMessageHistory];
	if (!channel.permissionsFor(me)?.has(needed)) {
		return interaction.reply({ content: `❌ I need View Channel, Send Messages, Embed Links, Add Reactions and Read Message History in ${channel}.`, flags: EPHEMERAL });
	}
	const text = new TextInputBuilder()
		.setCustomId('list')
		.setStyle(TextInputStyle.Paragraph)
		.setRequired(true)
		.setMaxLength(4000)
		.setPlaceholder(EXAMPLE.slice(0, 100))
		.setValue(EXAMPLE);
	const modal = new ModalBuilder()
		.setCustomId(`rolesimport:${channel.id}`)
		.setTitle('Import roles')
		.addLabelComponents(new LabelBuilder()
			.setLabel('# Category, then: emoji  Role name  #colour')
			.setDescription('Add "(pick one)" after a category to make it pick-one. Existing roles are reused.')
			.setTextInputComponent(text));
	return interaction.showModal(modal);
}

async function handleModal(interaction) {
	const guild = interaction.guild;
	const channel = guild.channels.cache.get(interaction.customId.split(':')[1]);
	if (!channel) return interaction.reply({ content: '❌ That channel is gone.', flags: EPHEMERAL });

	const { groups, problems } = parse(interaction.fields.getTextInputValue('list'));
	if (!groups.length) {
		return interaction.reply({ content: `❌ Nothing to import.\n${problems.slice(0, 10).join('\n')}`, flags: EPHEMERAL });
	}
	await interaction.deferReply({ flags: EPHEMERAL });
	await guild.roles.fetch();

	let created = 0, reused = 0;
	const posted = [];
	for (const group of groups) {
		// Make or find each role first.
		const items = [];
		for (const item of group.items) {
			let role = guild.roles.cache.find(r => r.name.toLowerCase() === item.name.toLowerCase());
			if (role) {
				const problem = botCantManage(guild, role) || memberCantManage(interaction.member, role);
				if (problem) { problems.push(`${item.name}: ${problem}`); continue; }
				reused++;
			} else {
				try {
					role = await guild.roles.create({
						name: item.name,
						colors: item.color !== null ? { primaryColor: item.color } : undefined,
						reason: `/roles-import by ${interaction.user.tag}`,
					});
					created++;
				} catch (e) {
					problems.push(`${item.name}: couldn't create it (${e.message})`);
					continue;
				}
			}
			items.push({ ...item, role });
		}

		// One menu per 20 roles.
		for (let start = 0; start < items.length; start += MAX_ITEMS) {
			const chunk = items.slice(start, start + MAX_ITEMS);
			const title = start ? `${group.category} (${start / MAX_ITEMS + 1})` : group.category;
			let message;
			try {
				message = await channel.send({ embeds: [new EmbedBuilder().setTitle(title).setColor(DEFAULT_COLOR).setDescription(INTRO)] });
			} catch (e) {
				problems.push(`${title}: couldn't post the menu (${e.message})`);
				continue;
			}
			const menu = {
				channelId: channel.id,
				mode: 'reactions',
				unique: group.unique,
				category: group.category,
				title,
				items: [],
				autoList: true,
				createdAt: new Date().toISOString(),
			};
			for (const { emoji, role } of chunk) {
				try {
					const reaction = await message.react(emoji);
					const key = roleMenus.emojiKey(reaction.emoji);
					if (menu.items.some(i => i.key === key)) { problems.push(`${role.name}: ${emoji} is already used on ${title}`); continue; }
					menu.items.push({ roleId: role.id, emoji: reaction.emoji.toString(), key, label: role.name.slice(0, 80) });
				} catch {
					problems.push(`${role.name}: couldn't react with ${emoji} (custom emoji must be from a server I'm in). The role exists, so add it with /reactionrole add`);
				}
			}
			roleMenus.save(guild.id, message.id, menu);
			await syncList(message, menu);
			posted.push(`[${title}](${message.url}): ${menu.items.length} role${menu.items.length === 1 ? '' : 's'}${menu.unique ? ', pick one' : ''}`);
		}
	}

	let content = `✅ Created **${created}** role${created === 1 ? '' : 's'}, reused **${reused}**. Menus in ${channel}:\n${posted.join('\n') || 'none'}`;
	if (problems.length) content += `\n\n⚠️ Skipped:\n${problems.slice(0, 15).map(p => `- ${p}`).join('\n')}${problems.length > 15 ? `\n…and ${problems.length - 15} more` : ''}`;
	return interaction.editReply({ content: content.slice(0, 2000), allowedMentions: { parse: [] } });
}

module.exports = { data, execute, handleModal, parse };
