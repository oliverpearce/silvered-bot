// Tiny JSON file store for per-server settings (e.g. autorole).
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, 'data');
const file = path.join(dir, 'settings.json');

function load() {
	try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function save(data) {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

module.exports = {
	get(guildId, key) {
		return load()[guildId]?.[key];
	},
	set(guildId, key, value) {
		const data = load();
		data[guildId] ??= {};
		if (value === undefined || value === null) delete data[guildId][key];
		else data[guildId][key] = value;
		save(data);
	},
};
