// The bot's Discord status. Saved in data/settings.json under "_bot": { status: { type, text, online, url } }
const { ActivityType } = require('discord.js');
const storage = require('./storage');

const SCOPE = '_bot';
const KEY = 'status';
const DEFAULT_STATUS = { type: 'listening', text: 'you <3', online: 'online' };

const ACTIVITY_TYPES = {
	listening: { label: 'Listening to', value: ActivityType.Listening },
	playing: { label: 'Playing', value: ActivityType.Playing },
	watching: { label: 'Watching', value: ActivityType.Watching },
	competing: { label: 'Competing in', value: ActivityType.Competing },
	streaming: { label: 'Streaming', value: ActivityType.Streaming },
	custom: { label: 'Custom', value: ActivityType.Custom },
};

const ONLINE_STATES = {
	online: 'Online',
	idle: 'Idle',
	dnd: 'Do Not Disturb',
	invisible: 'Invisible',
};

function getStatus() {
	const saved = storage.get(SCOPE, KEY);
	if (!saved || !ACTIVITY_TYPES[saved.type] || !saved.text || !ONLINE_STATES[saved.online]) return { ...DEFAULT_STATUS };
	return saved;
}

function toPresence({ type, text, online, url }) {
	const value = ACTIVITY_TYPES[type].value;
	const activity = type === 'custom'
		? { type: value, name: 'Custom Status', state: text }
		: { type: value, name: text, ...(type === 'streaming' && url ? { url } : {}) };
	return { status: online, activities: [activity] };
}

function apply(client) {
	client.presence.set(toPresence(getStatus()));
}

function setStatus(client, status) {
	storage.set(SCOPE, KEY, status);
	apply(client);
}

function resetStatus(client) {
	storage.set(SCOPE, KEY, null);
	apply(client);
}

function describe({ type, text, online }) {
	const activity = type === 'custom' ? text : `${ACTIVITY_TYPES[type].label} ${text}`;
	return `**${activity}** (${ONLINE_STATES[online]})`;
}

module.exports = { ACTIVITY_TYPES, ONLINE_STATES, getStatus, toPresence, apply, setStatus, resetStatus, describe };
