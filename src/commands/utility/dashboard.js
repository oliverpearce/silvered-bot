const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, InteractionContextType } = require('discord.js');
const { dashboard } = require('../../config');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('dashboard')
		.setDescription('Get your private login link for the web dashboard')
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.setContexts(InteractionContextType.Guild),
	async execute(interaction) {
		const auth = interaction.client.dashboardAuth;
		let content;
		if (dashboard.mode === 'off') {
			content = 'The web dashboard is turned off (`DASHBOARD=off`).';
		} else if (dashboard.mode === 'local') {
			content = 'The dashboard is in local mode, so it only opens on the computer running the bot. The link (with the key) is printed in the console when the bot starts.';
		} else if (!auth) {
			content = 'The dashboard isn\'t set up yet. Add an https:// `DASHBOARD_URL` to `.env` and restart.';
		} else if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
			content = '❌ You need Administrator in this server to use the dashboard.';
		} else {
			content = `🔐 **Your private dashboard link:** ${auth.createLoginLink(interaction.user)}\nIt works once and expires in 5 minutes. Don't share it.`;
		}
		return interaction.reply({ content, flags: MessageFlags.Ephemeral });
	},
};
