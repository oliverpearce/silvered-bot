// Loads settings from environment variables (.env file or the host's panel),
// falling back to config.json for running locally like before.
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

let fileConfig = {};
const jsonPath = path.join(__dirname, 'config.json');
if (fs.existsSync(jsonPath)) {
	try { fileConfig = require(jsonPath); } catch (e) { console.warn('[config] could not read config.json:', e.message); }
}

module.exports = {
	token: process.env.DISCORD_TOKEN || fileConfig.token,
	clientId: process.env.CLIENT_ID || fileConfig.clientId,
	// Optional: set a server ID to register commands instantly in that one server.
	// Leave blank to register globally (works in every server the bot is in).
	guildId: process.env.GUILD_ID || fileConfig.guildId || '',
	// Port for the small "I'm alive" web page. Pterodactyl hosts (like Wispbyte) set SERVER_PORT.
	port: process.env.PORT || process.env.SERVER_PORT || 3000,
	dashboard: {
		// Set DASHBOARD=off to turn the web dashboard off (e.g. on a host where you can't reach localhost anyway).
		enabled: !/^(off|false|0|no)$/i.test(process.env.DASHBOARD ?? ''),
		port: Number(process.env.DASHBOARD_PORT) || 3001,
		// Set DASHBOARD_KEY to keep the same key between restarts; otherwise a new one is made each start.
		key: process.env.DASHBOARD_KEY || crypto.randomBytes(18).toString('base64url'),
	},
};
