// Role menus made from the dashboard, saved in data/settings.json under "roleMenus".
//
//   reactions mode: people react with an emoji to get the role; removing the reaction removes it.
//                   The bot needs this file to know which emoji = which role.
//   buttons mode:   same button IDs as /rolemenu ("rr:<roleId>" / "rru:<roleId>"), so clicks are
//                   handled by rolemenu.handleButton. It's saved here only so the dashboard can list it.
const storage = require('./storage');
const { botCantManage } = require('./roleUtils');

const KEY = 'roleMenus';

// Discord sometimes drops the invisible "variation selector" from emoji like ❤️, so compare without it.
const emojiKey = emoji => (emoji.id ?? emoji.name ?? '').replace(/️/g, '');

function all(guildId) {
	return storage.get(guildId, KEY) ?? {};
}

function get(guildId, messageId) {
	return all(guildId)[messageId] ?? null;
}

function save(guildId, messageId, menu) {
	const menus = all(guildId);
	menus[messageId] = menu;
	storage.set(guildId, KEY, menus);
}

function remove(guildId, messageId) {
	const menus = all(guildId);
	if (!menus[messageId]) return false;
	delete menus[messageId];
	storage.set(guildId, KEY, Object.keys(menus).length ? menus : null);
	return true;
}

// Works out which member + role a reaction is about, or null if it's not a reaction-role reaction.
async function resolve(reaction, user) {
	if (user.bot) return null;
	if (reaction.partial) reaction = await reaction.fetch().catch(() => null);
	if (!reaction) return null;
	const message = reaction.message;
	const guild = message.guild;
	if (!guild) return null;

	const menu = get(guild.id, message.id);
	if (!menu || menu.mode !== 'reactions') return null;
	const item = menu.items.find(i => i.key === emojiKey(reaction.emoji));
	if (!item) return null;

	const role = guild.roles.cache.get(item.roleId);
	if (!role) return null;
	const problem = botCantManage(guild, role);
	if (problem) {
		console.warn(`[reaction roles] can't give ${role.name}: ${problem.replace(/\*\*/g, '')}`);
		return null;
	}
	const member = await guild.members.fetch(user.id).catch(() => null);
	if (!member) return null;
	return { message, guild, menu, item, role, member };
}

async function onReactionAdd(reaction, user) {
	const r = await resolve(reaction, user);
	if (!r) return;
	const { message, guild, menu, item, role, member } = r;

	if (!menu.unique) {
		if (!member.roles.cache.has(role.id)) await member.roles.add(role, 'Reaction role');
		return;
	}

	// Pick-one menu: swap out the member's other roles from this menu in a single request...
	const otherItems = menu.items.filter(i => i.key !== item.key);
	const swapOut = otherItems
		.map(i => guild.roles.cache.get(i.roleId))
		.filter(x => x && x.id !== role.id && member.roles.cache.has(x.id) && !botCantManage(guild, x))
		.map(x => x.id);
	if (swapOut.length) {
		const next = member.roles.cache.filter(x => x.id !== guild.id && !swapOut.includes(x.id)).map(x => x.id);
		next.push(role.id);
		await member.roles.set(next, 'Reaction role (pick one)');
	} else if (!member.roles.cache.has(role.id)) {
		await member.roles.add(role, 'Reaction role');
	}

	// ...then take their other reactions off the message so it matches.
	const full = message.partial ? await message.fetch().catch(() => null) : message;
	if (!full) return;
	for (const other of otherItems) {
		const rx = full.reactions.cache.find(x => emojiKey(x.emoji) === other.key);
		if (rx) await rx.users.remove(user.id).catch(() => {});
	}
}

async function onReactionRemove(reaction, user) {
	const r = await resolve(reaction, user);
	if (!r) return;
	if (r.member.roles.cache.has(r.role.id)) await r.member.roles.remove(r.role, 'Reaction role removed');
}

module.exports = { KEY, emojiKey, all, get, save, remove, onReactionAdd, onReactionRemove };
