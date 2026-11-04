// Require the necessary discord.js classes
const { Client, Collection, Events, GatewayIntentBits, ActivityType, REST, Routes, MessageFlags, Partials } = require('discord.js');
const { token, clientId, guildId, port, dashboard } = require('./config');
const roleMenus = require('./roleMenus');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

if (!token) {
	console.error('No bot token found! Set DISCORD_TOKEN in your .env file (or the host\'s startup variables).');
	process.exit(1);
}

// Create a new client instance
const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.DirectMessages,
		GatewayIntentBits.MessageContent,
		GatewayIntentBits.GuildMessageReactions,
	],
	// Partials let the bot see reactions on messages sent before it last restarted.
	partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// create a collection for commands, easy to store and retrieve for execution!
client.commands = new Collection();

const foldersPath = path.join(__dirname, 'commands');
for (const folder of fs.readdirSync(foldersPath)) {
	const commandsPath = path.join(foldersPath, folder);
	for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
		const filePath = path.join(commandsPath, file);
		const command = require(filePath);
		if ('data' in command && 'execute' in command) {
			client.commands.set(command.data.name, command);
		} else {
			console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
		}
	}
}

// Register slash commands every time the bot starts, so new commands just show up.
async function registerCommands(appId) {
	const body = client.commands.map(c => c.data.toJSON());
	const rest = new REST().setToken(token);
	const route = guildId ? Routes.applicationGuildCommands(appId, guildId) : Routes.applicationCommands(appId);
	await rest.put(route, { body });
	console.log(`Registered ${body.length} slash commands ${guildId ? `in server ${guildId}` : 'globally'}.`);
}

client.once(Events.ClientReady, async c => {
	console.log(`Ready! Logged in as ${c.user.tag} :D`);
	c.user.setActivity({ name: 'you <3', type: ActivityType.Listening });
	try {
		await registerCommands(clientId || c.user.id);
	} catch (e) {
		console.error('Failed to register commands:', e);
	}
});

// Autorole for new members
client.on(Events.GuildMemberAdd, member => {
	client.commands.get('autorole')?.onJoin(member);
});

// Reaction roles (menus made in the dashboard)
client.on(Events.MessageReactionAdd, (reaction, user) => {
	roleMenus.onReactionAdd(reaction, user).catch(e => console.error('[reaction roles]', e.message));
});
client.on(Events.MessageReactionRemove, (reaction, user) => {
	roleMenus.onReactionRemove(reaction, user).catch(e => console.error('[reaction roles]', e.message));
});
// Forget a role menu if its message gets deleted
client.on(Events.MessageDelete, message => {
	if (message.guildId) roleMenus.remove(message.guildId, message.id);
});

// Slash commands + role menu buttons
client.on(Events.InteractionCreate, async interaction => {
	try {
		if (interaction.isButton() && /^rru?:/.test(interaction.customId)) {
			return await client.commands.get('rolemenu').handleButton(interaction);
		}
		if (!interaction.isChatInputCommand()) return;
		const command = client.commands.get(interaction.commandName);
		if (!command) return;
		await command.execute(interaction);
	} catch (error) {
		console.error(error);
		if (!interaction.isRepliable()) return;
		const msg = { content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral };
		if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => {});
		else await interaction.reply(msg).catch(() => {});
	}
});

// Tiny web page so uptime monitors / cron jobs can ping the bot.
http.createServer((req, res) => {
	const ok = client.isReady();
	res.writeHead(ok ? 200 : 503, { 'Content-Type': 'text/plain' });
	res.end(ok ? `silvered-bot is online (${client.ws.ping}ms)` : 'starting up...');
}).listen(port, () => console.log(`Keep-alive page listening on port ${port}`));

process.on('unhandledRejection', e => console.error('Unhandled rejection:', e));

// Local web dashboard (http://localhost:3001 by default). Only reachable from this computer.
if (dashboard.enabled) {
	require('./dashboard/server').startDashboard(client, { port: dashboard.port, key: dashboard.key, defaultGuild: guildId });
}

// Log in to Discord with your client's token
client.login(token).catch(e => {
	console.error(`Couldn't log in to Discord: ${e.message}`);
	console.error('Check DISCORD_TOKEN in your .env (Developer Portal -> your app -> Bot -> Reset Token).');
	process.exit(1);
});
