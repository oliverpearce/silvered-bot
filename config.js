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

function dashboardMode(value) {
	const v = (value ?? '').trim().toLowerCase();
	if (/^(off|false|0|no)$/.test(v)) return 'off';
	if (v === 'public') return 'public';
	return 'local';
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
		// DASHBOARD=local  (default) only reachable from this computer, on DASHBOARD_PORT.
		// DASHBOARD=public shares the main port at /dashboard/ so you can reach it on Wispbyte. Needs DASHBOARD_KEY.
		// DASHBOARD=off    no dashboard.
		mode: dashboardMode(process.env.DASHBOARD),
		port: Number(process.env.DASHBOARD_PORT) || 3001,
		// Set DASHBOARD_KEY to keep the same key between restarts; otherwise a new one is made each start (local only).
		key: process.env.DASHBOARD_KEY || crypto.randomBytes(18).toString('base64url'),
		keyFromEnv: Boolean(process.env.DASHBOARD_KEY),
	},
};
