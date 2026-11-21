// Carl-bot style reaction roles: react with an emoji to get a role, remove the reaction to lose it.
// Menus are saved in data/settings.json (see roleMenus.js), so the dashboard can list and edit them too.
const {
	SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags, ChannelType, EmbedBuilder, parseEmoji,
} = require('discord.js');
const roleMenus = require('../../roleMenus');
const { botCantManage, memberCantManage } = require('../../roleUtils');
const { fetchMessage } = require('../../messageLinks');
const { parseColor } = require('../../embeds');

const EPHEMERAL = MessageFlags.Ephemeral;
const MAX_ITEMS = 20; // Discord allows 20 different reactions per message
const DEFAULT_COLOR = 0xff69b4;
const PICK_ONE_FOOTER = 'You can only pick one role from this menu.';
// Role lines the bot writes into self-updating menus, e.g. "🎮 - <@&123>" (older menus: "🎮 <@&123>")
const ROLE_LINE = /^\S+ (?:- )?<@&\d{17,20}>$/;

const messageOption = o => o.setName('message').setDescription('Link to the menu message (right-click → Copy Message Link), or its ID').setRequired(true);
const categoryOption = o => o.setName('category').setDescription('Group for this menu, e.g. Games, Events, Interests').setMaxLength(50).setAutocomplete(true);

const data = new SlashCommandBuilder()
	.setName('reactionrole')
	.setDescription('Reaction role menus: react with an emoji to get a role')
	.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
	.setContexts(InteractionContextType.Guild)
	.addSubcommand(sub => sub
		.setName('create')
		.setDescription('Post a new reaction role menu, then add roles with /reactionrole add')
		.addStringOption(o => o.setName('title').setDescription('Menu title, e.g. "Pick your games"').setRequired(true).setMaxLength(256))
		.addStringOption(o => o.setName('description').setDescription('Text above the role list. Use \\n for a new line').setMaxLength(2000))
		.addStringOption(categoryOption)
		.addBooleanOption(o => o.setName('pick_one').setDescription('Only allow one role from this menu at a time (default: no)'))
		.addStringOption(o => o.setName('color').setDescription('Embed colour as hex, e.g. #ff69b4').setMaxLength(7))
		.addChannelOption(o => o.setName('channel').setDescription('Where to post it (default: here)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
	.addSubcommand(sub => sub
		.setName('add')
		.setDescription('Add an emoji → role to a menu (works on any message, not just ones from /reactionrole create)')
		.addStringOption(messageOption)
		.addStringOption(o => o.setName('emoji').setDescription('The emoji people react with').setRequired(true).setMaxLength(100))
		.addRoleOption(o => o.setName('role').setDescription('The role they get').setRequired(true)))
	.addSubcommand(sub => sub
		.setName('remove')
		.setDescription('Take an emoji/role off a menu')
		.addStringOption(messageOption)
		.addStringOption(o => o.setName('emoji').setDescription('The emoji to remove').setMaxLength(100))
		.addRoleOption(o => o.setName('role').setDescription('Or: the role to remove')))
	.addSubcommand(sub => sub
		.setName('edit')
		.setDescription('Change a menu\'s category or pick-one setting')
		.addStringOption(messageOption)
		.addStringOption(categoryOption)
		.addBooleanOption(o => o.setName('pick_one').setDescription('Only allow one role from this menu at a time')))
	.addSubcommand(sub => sub
		.setName('list')
		.setDescription('List this server\'s role menus')
		.addStringOption(o => o.setName('category').setDescription('Only show this category').setAutocomplete(true)))
	.addSubcommand(sub => sub
		.setName('delete')
		.setDescription('Stop a message from being a reaction role menu')
		.addStringOption(messageOption)
		.addBooleanOption(o => o.setName('delete_message').setDescription('Also delete the message itself (default: no)')));

// Finds the menu message from the "message" option. A plain ID is looked up where that menu was posted.
async function findMenuMessage(interaction) {
	const input = interaction.options.getString('message').trim();
	const known = /^\d{17,20}$/.test(input) ? roleMenus.get(interaction.guildId, input) : null;
	return fetchMessage(interaction, input, known?.channelId);
}

// For menus made with /reactionrole create: rewrite the role list in the embed to match the menu.
async function syncList(message, menu) {
	if (!menu.autoList || message.author.id !== message.client.user.id || !message.embeds[0]) return;
	const embed = EmbedBuilder.from(message.embeds[0]);
	const intro = (embed.data.description ?? '').split('\n').filter(line => !ROLE_LINE.test(line.trim())).join('\n').trim();
	const lines = menu.items.map(i => `${i.emoji} - <@&${i.roleId}>`);
	const description = [intro, lines.join('\n')].filter(Boolean).join('\n\n') || 'No roles yet.';
	embed.setDescription(description.slice(0, 4096));
	if (menu.unique) embed.setFooter({ text: PICK_ONE_FOOTER });
	else if (embed.data.footer?.text === PICK_ONE_FOOTER) embed.setFooter(null);
	await message.edit({ embeds: [embed] }).catch(e => console.warn('[reactionrole] couldn\'t update the menu text:', e.message));
}

const reply = (interaction, content) => interaction.reply({ content, flags: EPHEMERAL, allowedMentions: { parse: [] } });

async function create(interaction) {
	const channel = interaction.options.getChannel('channel') ?? interaction.channel;
	const me = interaction.guild.members.me;
	const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AddReactions, PermissionFlagsBits.ReadMessageHistory];
	if (!channel.permissionsFor(me)?.has(needed)) {
		return reply(interaction, `❌ I need View Channel, Send Messages, Embed Links, Add Reactions and Read Message History in ${channel}.`);
	}
	if (!channel.permissionsFor(interaction.member)?.has(PermissionFlagsBits.SendMessages)) {
		return reply(interaction, `❌ You can't send messages in ${channel}.`);
	}
	const colorText = interaction.options.getString('color');
	const color = colorText ? parseColor(colorText) : DEFAULT_COLOR;
	if (color === null) return reply(interaction, '❌ The colour has to be a hex code like `#ff69b4`.');

	const unique = interaction.options.getBoolean('pick_one') ?? false;
	const intro = (interaction.options.getString('description') ?? 'React below to get a role. Remove your reaction to lose it.').replace(/\\n/g, '\n');
	const embed = new EmbedBuilder()
		.setTitle(interaction.options.getString('title'))
		.setColor(color)
		.setDescription(intro);
	if (unique) embed.setFooter({ text: PICK_ONE_FOOTER });

	let message;
	try {
		message = await channel.send({ embeds: [embed] });
	} catch (e) {
		return reply(interaction, `❌ I couldn't post in ${channel} (${e.message}).`);
	}
	roleMenus.save(interaction.guildId, message.id, {
		channelId: channel.id,
		mode: 'reactions',
		unique,
		category: interaction.options.getString('category')?.trim() || undefined,
		title: roleMenus.titleOf(message),
		items: [],
		autoList: true,
		createdAt: new Date().toISOString(),
	});
	return reply(interaction, `✅ Menu posted: ${message.url}\nNow add roles, one at a time:\n\`/reactionrole add message:${message.url} emoji:🎮 role:@SomeRole\``);
}

async function add(interaction) {
	const { message, error } = await findMenuMessage(interaction);
	if (error) return reply(interaction, `❌ ${error}`);
	const guild = interaction.guild;
	const role = interaction.options.getRole('role');
	const menu = roleMenus.get(guild.id, message.id);

	if (menu && menu.mode !== 'reactions') return reply(interaction, '❌ That\'s a button menu. Change it with `/rolemenu` or the dashboard.');
	const problem = botCantManage(guild, role) || memberCantManage(interaction.member, role);
	if (problem) return reply(interaction, `❌ ${problem}`);
	if (menu?.items.some(i => i.roleId === role.id)) return reply(interaction, `${role} is already on that menu.`);
	if ((menu?.items.length ?? 0) >= MAX_ITEMS) return reply(interaction, `❌ A reaction menu can hold at most ${MAX_ITEMS} roles. Make a second menu.`);
	if (!message.channel.permissionsFor(guild.members.me)?.has([PermissionFlagsBits.AddReactions, PermissionFlagsBits.ReadMessageHistory])) {
		return reply(interaction, `❌ I need Add Reactions and Read Message History in ${message.channel}.`);
	}

	const existingKeys = new Set(message.reactions.cache.map(r => roleMenus.emojiKey(r.emoji)));
	let reaction;
	try {
		reaction = await message.react(interaction.options.getString('emoji').trim());
	} catch {
		return reply(interaction, '❌ I couldn\'t react with that. Use a normal emoji, or a custom emoji from a server I\'m in.');
	}
	const key = roleMenus.emojiKey(reaction.emoji);
	const clash = menu?.items.find(i => i.key === key);
	if (clash) return reply(interaction, `❌ That emoji is already used for <@&${clash.roleId}>. Pick a different one.`);

	const next = menu ?? {
		channelId: message.channelId,
		mode: 'reactions',
		unique: false,
		title: roleMenus.titleOf(message),
		items: [],
		createdAt: new Date().toISOString(),
	};
	next.items.push({ roleId: role.id, emoji: reaction.emoji.toString(), key, label: role.name.slice(0, 80) });
	next.updatedAt = new Date().toISOString();
	roleMenus.save(guild.id, message.id, next);
	await syncList(message, next);

	const note = existingKeys.has(key) ? ' (that emoji was already on the message, so people who reacted before won\'t get the role until they react again)' : '';
	return reply(interaction, `✅ ${reaction.emoji} now gives ${role} on ${message.url}${note}`);
}

async function remove(interaction) {
	const { message, error } = await findMenuMessage(interaction);
	if (error) return reply(interaction, `❌ ${error}`);
	const menu = roleMenus.get(interaction.guildId, message.id);
	if (!menu || menu.mode !== 'reactions') return reply(interaction, '❌ That message isn\'t a reaction role menu.');

	const emojiText = interaction.options.getString('emoji')?.trim();
	const role = interaction.options.getRole('role');
	if (!emojiText && !role) return reply(interaction, '❌ Tell me which `emoji` or `role` to remove.');
	const item = menu.items.find(i => (role && i.roleId === role.id)
		|| (emojiText && (i.emoji === emojiText || i.key === roleMenus.emojiKey(parseEmoji(emojiText) ?? {}))));
	if (!item) return reply(interaction, '❌ That isn\'t on the menu. Check `/reactionrole list`.');

	menu.items = menu.items.filter(i => i !== item);
	menu.updatedAt = new Date().toISOString();
	roleMenus.save(interaction.guildId, message.id, menu);
	await roleMenus.removeBotReaction(message, item.key);
	await syncList(message, menu);
	return reply(interaction, `✅ Removed ${item.emoji} → <@&${item.roleId}>. People keep the role if they already have it.`);
}

async function edit(interaction) {
	const { message, error } = await findMenuMessage(interaction);
	if (error) return reply(interaction, `❌ ${error}`);
	const menu = roleMenus.get(interaction.guildId, message.id);
	if (!menu) return reply(interaction, '❌ That message isn\'t a role menu.');

	const category = interaction.options.getString('category');
	const unique = interaction.options.getBoolean('pick_one');
	if (category === null && unique === null) return reply(interaction, 'Nothing to change. Give a `category` or `pick_one`.');
	if (category !== null) menu.category = category.trim() || undefined;
	if (unique !== null) menu.unique = unique;
	menu.updatedAt = new Date().toISOString();
	roleMenus.save(interaction.guildId, message.id, menu);
	if (unique !== null) await syncList(message, menu);
	return reply(interaction, `✅ Updated: category **${menu.category ?? 'none'}**, pick one **${menu.unique ? 'on' : 'off'}**.`);
}

async function list(interaction) {
	const filter = interaction.options.getString('category')?.trim().toLowerCase();
	const groups = new Map();
	for (const [messageId, m] of Object.entries(roleMenus.all(interaction.guildId))) {
		const cat = m.category || 'No category';
		if (filter && cat.toLowerCase() !== filter) continue;
		if (!groups.has(cat)) groups.set(cat, []);
		const url = `https://discord.com/channels/${interaction.guildId}/${m.channelId}/${messageId}`;
		const kind = m.mode === 'buttons' ? 'buttons' : 'reactions';
		groups.get(cat).push(`[${m.title || 'Role menu'}](${url}) in <#${m.channelId}>: ${m.items.length} role${m.items.length === 1 ? '' : 's'}, ${kind}${m.unique ? ', pick one' : ''}`);
	}
	if (!groups.size) return reply(interaction, filter ? 'No menus in that category.' : 'No role menus yet. Start one with `/reactionrole create`.');

	const embed = new EmbedBuilder().setTitle('Role menus').setColor(DEFAULT_COLOR);
	for (const [cat, lines] of [...groups].sort(([a], [b]) => a.localeCompare(b)).slice(0, 25)) {
		let value = '';
		for (const line of lines) {
			if (value.length + line.length + 1 > 1000) { value += '\n…and more'; break; }
			value += (value ? '\n' : '') + line;
		}
		embed.addFields({ name: cat.slice(0, 256), value });
	}
	return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
}

async function del(interaction) {
	const input = interaction.options.getString('message').trim();
	const { message, error } = await findMenuMessage(interaction);
	// If the message is already gone, still let people clear the saved menu by ID.
	const messageId = message?.id ?? (/^\d{17,20}$/.test(input) ? input : /\/(\d{17,20})\s*$/.exec(input)?.[1]);
	const menu = messageId ? roleMenus.get(interaction.guildId, messageId) : null;
	if (!menu) return reply(interaction, `❌ ${error ?? 'That message isn\'t a role menu.'}`);

	roleMenus.remove(interaction.guildId, messageId);
	if (message && interaction.options.getBoolean('delete_message')) {
		await message.delete().catch(() => {});
		return reply(interaction, '✅ Menu and message deleted.');
	}
	if (message && menu.mode === 'reactions') {
		for (const i of menu.items) if (i.key) await roleMenus.removeBotReaction(message, i.key);
	}
	return reply(interaction, '✅ That message is no longer a role menu. People keep the roles they already have.');
}

module.exports = {
	data,
	syncList,
	async execute(interaction) {
		const handlers = { create, add, remove, edit, list, delete: del };
		return handlers[interaction.options.getSubcommand()](interaction);
	},
	async autocomplete(interaction) {
		const typed = interaction.options.getFocused().toLowerCase();
		const choices = roleMenus.categories(interaction.guildId)
			.filter(c => c.toLowerCase().includes(typed))
			.slice(0, 25)
			.map(c => ({ name: c, value: c }));
		await interaction.respond(choices).catch(() => {});
	},
};
