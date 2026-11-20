const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('ping')
		.setDescription('Checks the ping of bot'),
	async execute(interaction) {
		const response = await interaction.reply({ content: 'Pinging...', withResponse: true });
		const sent = response.resource.message;
		await interaction.editReply(`Roundtrip latency: ${sent.createdTimestamp - interaction.createdTimestamp}ms | WebSocket: ${interaction.client.ws.ping}ms`);
	},
};
