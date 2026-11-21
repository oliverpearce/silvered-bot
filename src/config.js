// Loads settings from environment variables (.env file or the host's environment),
// falling back to config.json for running locally like before.
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

let fileConfig = {};
const jsonPath = path.join(__dirname, '..', 'config.json');
if (fs.existsSync(jsonPath)) {
	try { fileConfig = require(jsonPath); } catch (e) { console.warn('[config] could not read config.json:', e.message); }
}

// The dashboard's public HTTPS address, e.g. https://bot.example.com
function dashboardUrl(value) {
	try {
		const url = new URL((value ?? '').trim());
		return url.protocol === 'https:' ? url.origin : '';
	} catch {
		return '';
	}
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
	// Port for the small "I'm alive" web page.
	port: process.env.PORT || 3000,
	dashboard: {
		// DASHBOARD=local  (default) only reachable from this computer, on DASHBOARD_PORT.
		// DASHBOARD=public shares the main port at /dashboard/ with Discord login.
		//                  Needs DISCORD_CLIENT_SECRET and an https:// DASHBOARD_URL.
		// DASHBOARD=off    no dashboard.
		mode: dashboardMode(process.env.DASHBOARD),
		port: Number(process.env.DASHBOARD_PORT) || 3001,
		// Local mode only. Set DASHBOARD_KEY to keep the same key between restarts.
		key: process.env.DASHBOARD_KEY || crypto.randomBytes(18).toString('base64url'),
		clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
		publicUrl: dashboardUrl(process.env.DASHBOARD_URL),
		// Public mode serves HTTPS itself. These defaults match the hosting guide.
		tls: {
			certFile: process.env.TLS_CERT || '/etc/silvered-bot/tls/fullchain.pem',
			keyFile: process.env.TLS_KEY || '/etc/silvered-bot/tls/privkey.pem',
			acmeDir: process.env.ACME_DIR || '/var/www/silvered-bot',
			httpPort: Number(process.env.HTTP_PORT) || 80,
			httpsPort: Number(process.env.HTTPS_PORT) || 443,
		},
	},
};
