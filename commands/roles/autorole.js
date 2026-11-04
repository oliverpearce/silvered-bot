// Give every new member a role automatically when they join.
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } = require('discord.js');
const { botCantManage, memberCantManage } = require('../../roleUtils');
const storage = require('../../storage');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('autorole')
		.setDescription('Automatically give new members a role')
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
		.setContexts(InteractionContextType.Guild)
		.addSubcommand(s => s.setName('set').setDescription('Set the join role')
			.addRoleOption(o => o.setName('role').setDescription('Role new members get').setRequired(true)))
		.addSubcommand(s => s.setName('off').setDescription('Turn autorole off'))
		.addSubcommand(s => s.setName('show').setDescription('Show the current join role')),
	async execute(interaction) {
		const sub = interaction.options.getSubcommand();
		const gid = interaction.guild.id;

		if (sub === 'off') {
			storage.set(gid, 'autorole', null);
			return interaction.reply({ content: '✅ Autorole turned off.', flags: MessageFlags.Ephemeral });
		}
		if (sub === 'show') {
			const id = storage.get(gid, 'autorole');
			return interaction.reply({ content: id ? `New members get <@&${id}>.` : 'Autorole is off.', flags: MessageFlags.Ephemeral });
		}
		const role = interaction.options.getRole('role');
		const err = botCantManage(interaction.guild, role) || memberCantManage(interaction.member, role);
		if (err) return interaction.reply({ content: `❌ ${err}`, flags: MessageFlags.Ephemeral });
		storage.set(gid, 'autorole', role.id);
		return interaction.reply({ content: `✅ New members will get ${role}.`, flags: MessageFlags.Ephemeral });
	},

	// Called from index.js on GuildMemberAdd
	async onJoin(member) {
		const id = storage.get(member.guild.id, 'autorole');
		if (!id || member.user.bot) return;
		const role = member.guild.roles.cache.get(id);
		if (!role || botCantManage(member.guild, role)) return;
		await member.roles.add(role, 'Autorole').catch(e => console.error('[autorole]', e.message));
	},
};
