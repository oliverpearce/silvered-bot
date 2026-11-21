// Runs things later: scheduled messages and event reminders.
// Jobs are saved in data/settings.json under "scheduled", so they survive restarts.
// A job missed while the bot was offline still runs when it comes back, unless it's over 12 hours late.
const crypto = require('node:crypto');
const storage = require('./storage');

const KEY = 'scheduled';
const TICK_MS = 20 * 1000;
const TOO_LATE_MS = 12 * 60 * 60 * 1000;
const handlers = {};

const all = guildId => storage.get(guildId, KEY) ?? [];
const write = (guildId, jobs) => storage.set(guildId, KEY, jobs.length ? jobs : null);

/** handler(guild, job) runs when a job of this kind is due. */
function register(kind, handler) {
	handlers[kind] = handler;
}

/** Saves a job. `at` is a timestamp in milliseconds. Returns the job (with its id). */
function add(guildId, job) {
	const saved = { id: crypto.randomBytes(4).toString('hex'), createdAt: Date.now(), ...job };
	write(guildId, [...all(guildId), saved].sort((a, b) => a.at - b.at));
	return saved;
}

function remove(guildId, id) {
	const jobs = all(guildId);
	const job = jobs.find(j => j.id === id);
	if (!job) return null;
	write(guildId, jobs.filter(j => j.id !== id));
	return job;
}

function list(guildId, kind) {
	return all(guildId).filter(j => !kind || j.kind === kind);
}

let running = false;
async function tick(client) {
	if (running) return;
	running = true;
	try {
		const now = Date.now();
		for (const guild of client.guilds.cache.values()) {
			for (const job of all(guild.id).filter(j => j.at <= now)) {
				remove(guild.id, job.id); // take it off first so a crash can't make it repeat forever
				if (now - job.at > TOO_LATE_MS) {
					console.warn(`[scheduler] skipped a ${job.kind} job in ${guild.name}: it was over 12 hours late`);
					continue;
				}
				try {
					await handlers[job.kind]?.(guild, job);
				} catch (e) {
					console.error(`[scheduler] ${job.kind} job failed in ${guild.name}:`, e.message);
				}
			}
		}
	} finally {
		running = false;
	}
}

function start(client) {
	tick(client);
	setInterval(() => tick(client), TICK_MS).unref();
}

module.exports = { register, add, remove, list, start };
