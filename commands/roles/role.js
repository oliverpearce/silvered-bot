// Mods give/take roles: /role add, /role remove, /role info
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const { botCantManage, memberCantManage } = require('../../roleUtils');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('role')
		.setDescription('Give or take roles from members')
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
		.setContexts(InteractionContextType.Guild)
		.addSubcommand(s => s.setName('add').setDescription('Give a member a role')
			.addUserOption(o => o.setName('member').setDescription('Who').setRequired(true))
			.addRoleOption(o => o.setName('role').setDescription('Which role').setRequired(true)))
		.addSubcommand(s => s.setName('remove').setDescription('Take a role from a member')
			.addUserOption(o => o.setName('member').setDescription('Who').setRequired(true))
			.addRoleOption(o => o.setName('role').setDescription('Which role').setRequired(true)))
		.addSubcommand(s => s.setName('info').setDescription('Show info about a role')
			.addRoleOption(o => o.setName('role').setDescription('Which role').setRequired(true))),
	async execute(interaction) {
		const sub = interaction.options.getSubcommand();
		const role = interaction.options.getRole('role');

		if (sub === 'info') {
			await interaction.guild.members.fetch();
			const embed = new EmbedBuilder()
				.setColor(role.colors.primaryColor || 'LuminousVividPink')
				.setTitle(role.name)
				.addFields(
					{ name: 'Members', value: `${role.members.size}`, inline: true },
					{ name: 'Position', value: `${role.position}`, inline: true },
					{ name: 'Mentionable', value: role.mentionable ? 'yes' : 'no', inline: true },
					{ name: 'Key permissions', value: role.permissions.toArray().slice(0, 15).join(', ') || 'none' },
				)
				.setFooter({ text: `ID: ${role.id}` });
			return interaction.reply({ embeds: [embed] });
		}

		const member = await interaction.guild.members.fetch(interaction.options.getUser('member').id).catch(() => null);
		if (!member) return interaction.reply({ content: "❌ That person isn't in this server.", flags: MessageFlags.Ephemeral });

		const err = botCantManage(interaction.guild, role) || memberCantManage(interaction.member, role);
		if (err) return interaction.reply({ content: `❌ ${err}`, flags: MessageFlags.Ephemeral });

		if (sub === 'add') {
			if (member.roles.cache.has(role.id)) return interaction.reply({ content: `${member} already has ${role}.`, flags: MessageFlags.Ephemeral });
			await member.roles.add(role, `/role add by ${interaction.user.tag}`);
			return interaction.reply({ content: `✅ Gave ${role} to ${member}.`, allowedMentions: { parse: [] } });
		}
		if (!member.roles.cache.has(role.id)) return interaction.reply({ content: `${member} doesn't have ${role}.`, flags: MessageFlags.Ephemeral });
		await member.roles.remove(role, `/role remove by ${interaction.user.tag}`);
		return interaction.reply({ content: `✅ Removed ${role} from ${member}.`, allowedMentions: { parse: [] } });
	},
};
