// Creates (or updates) the server's staff/organization roles, top to bottom:
//   Mod > Semi-Mod > Perms > Non-User
// Safe to run more than once: existing roles with the same names are updated, not duplicated.
const { SlashCommandBuilder, PermissionFlagsBits: P, InteractionContextType, MessageFlags } = require('discord.js');

const TIERS = [
	{
		name: 'Mod',
		color: 0xE74C3C,
		hoist: true,
		about: 'full moderation: kick, ban, timeout, manage messages/channels/roles below them',
		permissions: [
			P.KickMembers, P.BanMembers, P.ModerateMembers, P.ManageMessages, P.ManageChannels,
			P.ManageRoles, P.ManageNicknames, P.ManageThreads, P.ViewAuditLog,
			P.MuteMembers, P.DeafenMembers, P.MoveMembers, P.MentionEveryone,
		],
	},
	{
		name: 'Semi-Mod',
		color: 0xE67E22,
		hoist: true,
		about: 'light moderation: timeout, delete messages, manage nicknames, voice mute/move',
		permissions: [P.ModerateMembers, P.ManageMessages, P.ManageNicknames, P.ManageThreads, P.MuteMembers, P.MoveMembers],
	},
	{
		name: 'Perms',
		color: 0x3498DB,
		hoist: true,
		about: 'trusted members: links, files, external emojis/stickers, threads',
		permissions: [P.EmbedLinks, P.AttachFiles, P.UseExternalEmojis, P.UseExternalStickers, P.CreatePublicThreads, P.ChangeNickname],
	},
	{
		name: 'Non-User',
		color: 0x95A5A6,
		hoist: false,
		about: 'no extra permissions, for bots, alts, or restricted/unverified accounts',
		permissions: [],
	},
];

/**
 * Works out new positions so `tierRoles` (top → bottom) sit directly under the bot's
 * highest role, keeping every other role below the bot in its current order.
 * Only roles below the bot are touched (the bot can't move anything else).
 */
function planPositions(guild, tierRoles) {
	const top = guild.members.me.roles.highest.position;
	const tierIds = new Set(tierRoles.map(r => r.id));
	const others = [...guild.roles.cache.values()]
		.filter(r => r.id !== guild.id && r.position < top && !tierIds.has(r.id))
		.sort((a, b) => a.position - b.position);
	const bottomToTop = [...others, ...[...tierRoles].reverse()];
	// Send the full layout (not just changed roles): Discord's raw positions can have gaps
	// or ties, so a partial update could leave roles in an unexpected order.
	return bottomToTop.map((role, i) => ({ role: role.id, position: i + 1 }));
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('setup-roles')
		.setDescription('Create the Mod > Semi-Mod > Perms > Non-User roles (safe to re-run)')
		.setDefaultMemberPermissions(P.Administrator)
		.setContexts(InteractionContextType.Guild),
	planPositions,
	async execute(interaction) {
		const guild = interaction.guild;
		const me = guild.members.me;
		if (!me.permissions.has(P.ManageRoles)) {
			return interaction.reply({ content: '❌ I need the **Manage Roles** permission first.', flags: MessageFlags.Ephemeral });
		}
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		await guild.roles.fetch();

		// The bot can only grant permissions it has itself.
		const lines = [];
		const roles = [];
		for (const tier of TIERS) {
			const allowed = tier.permissions.filter(p => me.permissions.has(p));
			const skipped = tier.permissions.length - allowed.length;
			const opts = { permissions: allowed, colors: { primaryColor: tier.color }, hoist: tier.hoist, reason: '/setup-roles' };
			let role = guild.roles.cache.find(r => r.name.toLowerCase() === tier.name.toLowerCase());

			if (role && role.position >= me.roles.highest.position) {
				lines.push(`⚠️ **${tier.name}** already exists above my role, so I left it alone.`);
				continue;
			}
			if (role) {
				role = await role.edit(opts);
				lines.push(`🔁 Updated ${role}: ${tier.about}`);
			} else {
				role = await guild.roles.create({ name: tier.name, ...opts });
				lines.push(`✅ Created ${role}: ${tier.about}`);
			}
			if (skipped) lines.push(`   ↳ skipped ${skipped} permission(s) I don't have myself`);
			roles.push(role);
		}

		// Stack them directly under the bot's own role, in order.
		try {
			const changes = planPositions(guild, roles);
			if (roles.length) await guild.roles.setPositions(changes);
		} catch (e) {
			lines.push(`⚠️ Couldn't reorder roles automatically (${e.message}). Drag them into order in Server Settings → Roles.`);
		}

		lines.push('', 'Give people these roles with `/role add`. Make sure **my** role stays above all of them.');
		return interaction.editReply(lines.join('\n'));
	},
};
