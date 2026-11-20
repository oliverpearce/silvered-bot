// Shared checks so nobody (including the bot) can hand out roles above their own.

/** Returns an error string if the bot can't manage this role, otherwise null. */
function botCantManage(guild, role) {
	const me = guild.members.me;
	if (!me.permissions.has('ManageRoles')) return 'I need the **Manage Roles** permission.';
	if (role.managed) return `${role} is managed by an integration/bot and can't be assigned.`;
	if (role.id === guild.id) return "That's the @everyone role.";
	if (role.position >= me.roles.highest.position) {
		return `${role} is above (or equal to) my highest role. Drag my role above it in **Server Settings → Roles**.`;
	}
	return null;
}

/** Returns an error string if this member can't manage this role, otherwise null. */
function memberCantManage(member, role) {
	if (member.guild.ownerId === member.id) return null;
	if (role.position >= member.roles.highest.position) {
		return `You can only manage roles below your own highest role.`;
	}
	return null;
}

module.exports = { botCantManage, memberCantManage };
