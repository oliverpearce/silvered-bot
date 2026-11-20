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
		} else if (!dashboard.url) {
			content = 'The dashboard is on, but its address isn\'t set. Add `DASHBOARD_URL` (e.g. `http://123.45.67.89:25565/dashboard/`) in the host\'s Startup variables and restart.';
		} else {
			content = `🛠️ **Dashboard:** ${dashboard.url}\nLog in with the dashboard password (\`DASHBOARD_KEY\`).`;
		}
		return interaction.reply({ content, flags: MessageFlags.Ephemeral });
	},
};
