// Require the necessary discord.js classes
const { Client, Collection, Events, GatewayIntentBits, ActivityType, REST, Routes, MessageFlags, Partials } = require('discord.js');
const { token, clientId, guildId, port, dashboard } = require('./config');
const roleMenus = require('./lib/roleMenus');
const whois = require('./lib/whois');
const welcome = require('./lib/welcome');
const modlog = require('./lib/modlog');
const scheduler = require('./lib/scheduler');
require('./lib/events'); // registers the event reminder job
const { createDashboardHandler, startDashboard } = require('./dashboard/server');
const { createDiscordAuth } = require('./dashboard/auth');
const fs = require('node:fs');
const path = require('node:path');
const { startWeb } = require('./web');

if (!token) {
	console.error('No bot token found! Set DISCORD_TOKEN in your .env file (or the host\'s environment variables).');
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
		GatewayIntentBits.GuildModeration, // bans, for the mod log
	],
	// Partials let the bot see reactions on messages sent before it last restarted,
	// and from people it hasn't cached yet.
	partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember],
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
	scheduler.start(c);
});

// Autorole for new members
client.on(Events.GuildMemberAdd, member => {
	client.commands.get('autorole')?.onJoin(member);
	if (!member.user.bot) whois.scheduleRefresh(member.guild);
	welcome.send(member, 'join').catch(e => console.warn('[welcome]', e.message));
});

// Keep the posted "who's who" list up to date
client.on(Events.GuildMemberRemove, member => {
	if (member.user?.bot) return;
	whois.scheduleRefresh(member.guild);
	welcome.send(member, 'leave').catch(e => console.warn('[welcome]', e.message));
});
modlog.attach(client);
client.on(Events.GuildMemberUpdate, (before, after) => {
	if (after.user.bot) return;
	if (before.partial || before.displayName !== after.displayName || before.roles.hoist?.id !== after.roles.hoist?.id) whois.scheduleRefresh(after.guild);
});
client.on(Events.GuildRoleUpdate, (before, after) => {
	if (before.name !== after.name || before.hoist !== after.hoist || before.position !== after.position) whois.scheduleRefresh(after.guild);
});

// Reaction roles (menus made in the dashboard or with /reactionrole)
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

// Slash commands, autocomplete, role menu buttons and /embed's pop-up forms
client.on(Events.InteractionCreate, async interaction => {
	try {
		if (interaction.isButton() && /^rru?:/.test(interaction.customId)) {
			return await client.commands.get('rolemenu').handleButton(interaction);
		}
		if (interaction.isModalSubmit() && interaction.customId.startsWith('embed:')) {
			return await client.commands.get('embed').handleModal(interaction);
		}
		if (interaction.isModalSubmit() && interaction.customId.startsWith('rolesimport:')) {
			return await client.commands.get('roles-import').handleModal(interaction);
		}
		if (interaction.isAutocomplete()) {
			return await client.commands.get(interaction.commandName)?.autocomplete?.(interaction);
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

process.on('unhandledRejection', e => console.error('Unhandled rejection:', e));

// Web dashboard. See config.js for the DASHBOARD modes.
let dashboardHandler = null;
if (dashboard.mode === 'public') {
	if (!dashboard.publicUrl) {
		console.error('[dashboard] DASHBOARD=public needs an https:// DASHBOARD_URL. The dashboard is OFF until you set it.');
	} else {
		const auth = createDiscordAuth(client, { publicUrl: dashboard.publicUrl });
		client.dashboardAuth = auth;
		dashboardHandler = createDashboardHandler(client, { key: dashboard.key, defaultGuild: guildId, publicMode: true, auth });
	}
} else if (dashboard.mode === 'local') {
	// Only reachable from this computer (http://localhost:3001 by default).
	startDashboard(client, { port: dashboard.port, key: dashboard.key, defaultGuild: guildId });
}

// The status page (for uptime pings) and, in public mode, the dashboard over HTTPS.
startWeb(async (req, res) => {
	if (dashboardHandler && await dashboardHandler(req, res)) return;
	const ok = client.isReady();
	res.writeHead(ok ? 200 : 503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
	res.end(ok ? `silvered-bot is online (${client.ws.ping}ms)` : 'starting up...');
}, { port, publicUrl: dashboardHandler ? dashboard.publicUrl : null, tls: dashboard.tls });

// Log in to Discord with your client's token
client.login(token).catch(e => {
	console.error(`Couldn't log in to Discord: ${e.message}`);
	console.error('Check DISCORD_TOKEN in your .env (Developer Portal -> your app -> Bot -> Reset Token).');
	process.exit(1);
});
