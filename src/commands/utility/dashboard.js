const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { dashboard } = require('../../config');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('dashboard')
		.setDescription('Get the link to the web dashboard (embed builder + role menus)')
		// Only people who can manage roles see this, so the server address isn't handed to everyone.
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
	async execute(interaction) {
		let content;
		if (dashboard.mode === 'off') {
			content = 'The web dashboard is turned off (`DASHBOARD=off`).';
		} else if (dashboard.mode === 'local') {
			content = 'The dashboard is in local mode, so it only opens on the computer running the bot. The link (with the key) is printed in the console when the bot starts.';
		} else if (!dashboard.publicUrl) {
			content = 'The dashboard is on, but its address isn\'t set. Add an https:// `DASHBOARD_URL` to `.env` and restart.';
		} else {
			content = `🛠️ **Dashboard:** ${dashboard.publicUrl}/dashboard/\nLog in with Discord. You need Administrator in this server.`;
		}
		return interaction.reply({ content, flags: MessageFlags.Ephemeral });
	},
};
