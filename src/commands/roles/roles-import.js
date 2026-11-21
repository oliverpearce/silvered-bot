// /roles-import: paste a list of roles, get the roles created and a reaction menu per category.
//
//   # games
//   minecraft #2ecc71
//   valorant
//   # pronouns (pick one)
//   he/him
//
// "# Heading" starts a category (one menu each; "(pick one)" makes it pick-one).
// Each other line is: role name, optional #hex colour. Names without an emoji become lowercase
// and the menu uses buttons with the name on them.
// Start a line with an emoji instead (🎮 Minecraft) to keep the name as typed; a category where
// every line has an emoji gets a reaction menu.
// Roles that already exist (any capitalisation) are reused and renamed to match. Nothing is deleted.
const {
	SlashCommandBuilder, PermissionFlagsBits: P, InteractionContextType, MessageFlags, ChannelType, EmbedBuilder,
	ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const roleMenus = require('../../lib/roleMenus');
const { botCantManage, memberCantManage } = require('../../lib/roleUtils');
const { parseColor } = require('../../lib/embeds');
const { syncList } = require('./reactionrole');
const { buildRows, makeButton } = require('./rolemenu');

const EPHEMERAL = MessageFlags.Ephemeral;
const MAX_REACTIONS = 20; // per message
const MAX_BUTTONS = 25; // per message
const DEFAULT_COLOR = 0xff69b4;
const INTRO = 'React below to get a role. Remove your reaction to lose it.';
const BUTTON_INTRO = 'click a button to get the role. click it again to remove it.';
const CUSTOM_EMOJI = /^<a?:\w{2,32}:\d{17,20}>$/;
const UNICODE_EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3)/u;
const EXAMPLE = '# games\nminecraft\nvalorant\nroblox\n# events\nmovie night\n# pronouns (pick one)\nhe/him\nshe/her\nthey/them';

/** Turns the pasted text into [{ category, unique, items: [{ emoji, name, color }] }] (emoji is null on plain lines) plus a list of problems. */
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
		const first = parts[0];
		const emoji = CUSTOM_EMOJI.test(first) || UNICODE_EMOJI.test(first) ? parts.shift() : null;
		let color = null;
		if (parts.length && /^#[0-9a-f]{6}$/i.test(parts.at(-1))) color = parseColor(parts.pop());
		const typed = parts.join(' ').slice(0, 100);
		const name = emoji ? typed : typed.toLowerCase();
		if (!name) return problems.push(`Line ${i + 1}: no role name in \`${line.slice(0, 60)}\``);
		if (!current) { current = { category: 'Roles', unique: false, items: [] }; groups.push(current); }
		current.items.push({ emoji, name, color });
	});
	return { groups: groups.filter(g => g.items.length), problems };
}

const data = new SlashCommandBuilder()
	.setName('roles-import')
	.setDescription('Paste a list of roles: creates them and posts a menu per category')
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
			.setLabel('# Category, then one role name per line')
			.setDescription('Names go lowercase. Add "(pick one)" after a category for pick-one. Existing roles are reused.')
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
				if (!item.emoji && role.name !== item.name) {
					try {
						await role.setName(item.name, `/roles-import by ${interaction.user.tag}`);
					} catch (e) {
						problems.push(`${role.name}: couldn't rename it to ${item.name} (${e.message})`);
					}
				}
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

		// Any line without an emoji makes the whole category a button menu.
		const useButtons = items.some(i => !i.emoji);
		const perMenu = useButtons ? MAX_BUTTONS : MAX_REACTIONS;
		for (let start = 0; start < items.length; start += perMenu) {
			const chunk = items.slice(start, start + perMenu);
			const title = start ? `${group.category} (${start / perMenu + 1})` : group.category;
			if (useButtons) {
				const description = BUTTON_INTRO + (group.unique ? '\n*you can only have one role from this menu.*' : '');
				try {
					const message = await channel.send({
						embeds: [new EmbedBuilder().setTitle(title).setColor(DEFAULT_COLOR).setDescription(description)],
						components: buildRows(chunk.map(i => makeButton(i.role, group.unique, i.emoji || undefined, i.name))),
						allowedMentions: { parse: [] },
					});
					roleMenus.save(guild.id, message.id, {
						channelId: channel.id,
						mode: 'buttons',
						unique: group.unique,
						category: group.category,
						title,
						items: chunk.map(i => ({ roleId: i.role.id, emoji: i.emoji ?? '', label: i.name.slice(0, 80) })),
						createdAt: new Date().toISOString(),
					});
					posted.push(`[${title}](${message.url}): ${chunk.length} role${chunk.length === 1 ? '' : 's'}${group.unique ? ', pick one' : ''}`);
				} catch (e) {
					problems.push(`${title}: couldn't post the menu (${e.message})`);
				}
				continue;
			}
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
