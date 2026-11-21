// Silvered dashboard front end. Plain JS, no build step.
'use strict';

// ---------- tiny helpers ----------

const $ = (sel, root = document) => root.querySelector(sel);

// Let replaceChildren skip empty slots (null/false) the same way h() does.
const nativeReplace = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function (...nodes) { return nativeReplace.apply(this, nodes.filter(n => n !== null && n !== undefined && n !== false)); };

// h('div', { class: 'x', onclick: fn }, child, 'text', ...) builds DOM safely (text is never parsed as HTML).
function h(tag, attrs = {}, ...children) {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs ?? {})) {
		if (v === undefined || v === null || v === false) continue;
		if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
		else if (k === 'class') el.className = v;
		else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
		else if (k in el && typeof v !== 'string') el[k] = v;
		else el.setAttribute(k, v === true ? '' : v);
	}
	for (const c of children.flat(Infinity)) {
		if (c === null || c === undefined || c === false) continue;
		el.append(c instanceof Node ? c : document.createTextNode(String(c)));
	}
	return el;
}

const store = {
	get(k, fallback = null) { try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
	set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
	del(k) { try { localStorage.removeItem(k); } catch { /* storage blocked */ } },
};

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function toast(msg, kind = 'ok', link) {
	const el = h('div', { class: `toast ${kind}` }, msg, link ? [' ', h('a', { href: link.href, target: '_blank', rel: 'noreferrer' }, link.text)] : null);
	$('#toasts').append(el);
	setTimeout(() => el.remove(), kind === 'bad' ? 9000 : 6000);
}

function modal({ title, text, confirm = 'OK', danger = false, checkbox, input }) {
	return new Promise(resolve => {
		const box = checkbox ? h('input', { type: 'checkbox', checked: Boolean(checkbox.checked) }) : null;
		const field = input?.multiline
			? h('textarea', { rows: 12, placeholder: input.placeholder ?? '', maxLength: input.max ?? 4000, style: { width: '100%' } })
			: input ? h('input', { type: 'text', value: input.value ?? '', placeholder: input.placeholder ?? '', maxLength: input.max ?? 100, onkeydown: e => { if (e.key === 'Enter') close({ checked: box?.checked ?? false, value: field.value.trim() }); } }) : null;
		const close = val => { overlay.remove(); resolve(val); };
		const overlay = h('div', { class: 'overlay', onclick: e => { if (e.target === overlay) close(null); } },
			h('div', { class: 'card modal', role: 'dialog', 'aria-modal': 'true' },
				h('h2', {}, title),
				text ? h('p', {}, text) : null,
				field ? h('div', { style: { marginBottom: '12px' } }, field) : null,
				checkbox ? h('label', { class: 'check' }, box, checkbox.label) : null,
				h('div', { class: 'row' },
					h('button', { class: 'ghost', onclick: () => close(null) }, 'Cancel'),
					h('button', { class: danger ? 'danger' : 'primary', onclick: () => close({ checked: box?.checked ?? false, value: field?.value.trim() }) }, confirm),
				),
			),
		);
		document.body.append(overlay);
		(field ?? overlay.querySelector('button.danger, button.primary')).focus();
		overlay.addEventListener('keydown', e => { if (e.key === 'Escape') close(null); });
	});
}

// ---------- state + API ----------

const state = {
	key: null,
	status: null,
	guildId: null,
	guild: null,
	view: store.get('view', 'send'),
};

async function api(path, { method = 'GET', body } = {}) {
	const res = await fetch(`/api${path}`, {
		method,
		headers: { 'x-dashboard-key': state.key ?? '', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	const data = await res.json().catch(() => ({}));
	if (res.status === 401) { showLogin('That key didn\'t work. Use your DASHBOARD_KEY (or the newest key from the bot\'s console).'); throw new Error('Locked'); }
	if (res.status === 429) { showLogin(data.error || 'Too many wrong keys. Wait a bit and try again.'); throw new Error('Locked'); }
	if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
	return data;
}

const roleById = id => state.guild?.roles.find(r => r.id === id);
const channelById = id => state.guild?.channels.find(c => c.id === id);
const assignableRoles = () => state.guild.roles.filter(r => !r.locked && !r.managed && !r.everyone);
const roleColor = r => (r && r.color !== '#000000' ? r.color : '#99aab5');

function roleSelect(value, { placeholder = 'Pick a role…', roles = assignableRoles(), onchange } = {}) {
	return h('select', { onchange },
		h('option', { value: '' }, placeholder),
		roles.map(r => h('option', { value: r.id, selected: r.id === value }, r.name)),
	);
}

function channelSelect(value, onchange) {
	const groups = new Map();
	for (const c of state.guild.channels) {
		const g = c.category ?? 'No category';
		if (!groups.has(g)) groups.set(g, []);
		groups.get(g).push(c);
	}
	return h('select', { onchange },
		h('option', { value: '' }, 'Pick a channel…'),
		[...groups].map(([g, list]) => h('optgroup', { label: g },
			list.map(c => h('option', { value: c.id, selected: c.id === value, disabled: !c.canSend }, `# ${c.name}${c.canSend ? '' : ' (no access)'}`)))),
	);
}

// ---------- login ----------

function showLogin(err = '') {
	$('#login').hidden = false;
	$('#login-error').textContent = err;
	$('#login-key').focus();
}

$('#login-form').addEventListener('submit', async e => {
	e.preventDefault();
	state.key = $('#login-key').value.trim();
	store.set('key', state.key);
	$('#login').hidden = true;
	await boot();
});

$('#logout').addEventListener('click', () => {
	store.del('key');
	state.key = null;
	showLogin();
});

// ---------- boot / navigation ----------

async function boot() {
	try {
		state.status = await api('/status');
	} catch (e) {
		if (e.message !== 'Locked') $('#view').replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Can\'t load the dashboard'), h('p', {}, e.message)));
		return;
	}
	const { bot, guilds, defaultGuild } = state.status;
	if (bot) {
		$('#bot-avatar').src = bot.avatar;
		$('#bot-avatar').hidden = false;
		$('#bot-tag').textContent = bot.tag;
	}
	const saved = store.get('guild');
	state.guildId = [saved, defaultGuild, guilds[0]?.id].find(id => id && guilds.some(g => g.id === id)) ?? null;
	$('#guild-select').replaceChildren(...guilds.map(g => h('option', { value: g.id, selected: g.id === state.guildId }, g.name)));
	if (!state.guildId) {
		$('#view').replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'The bot isn\'t in any servers yet'), h('p', {}, 'Invite it to your server first (see the walkthrough), then press Refresh.')));
		return;
	}
	await loadGuild();
}

async function loadGuild() {
	$('#view').replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
	try {
		state.guild = await api(`/guilds/${state.guildId}`);
	} catch (e) {
		if (e.message !== 'Locked') $('#view').replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Couldn\'t load the server'), h('p', {}, e.message)));
		return;
	}
	render();
}

$('#guild-select').addEventListener('change', e => {
	state.guildId = e.target.value;
	store.set('guild', state.guildId);
	loadGuild();
});
$('#refresh').addEventListener('click', () => loadGuild().then(() => toast('Reloaded from Discord.')));
$('#nav').addEventListener('click', e => {
	const b = e.target.closest('button[data-view]');
	if (!b) return;
	state.view = b.dataset.view;
	store.set('view', state.view);
	render();
});

function render() {
	for (const b of document.querySelectorAll('#nav button')) b.classList.toggle('active', b.dataset.view === state.view);
	const views = { send: viewSend, scheduled: viewScheduled, menus: viewMenus, roles: viewRoles, members: viewMembers, whois: viewWhois, settings: viewSettings };
	const el = (views[state.view] ?? viewSend)();
	$('#view').replaceChildren(...[].concat(el).filter(Boolean));
}

function permissionBanner() {
	const me = state.guild.me;
	if (me.manageRoles) return null;
	return h('div', { class: 'banner' }, 'The bot doesn\'t have the Manage Roles permission in this server, so it can\'t give out or edit roles. Give its role Manage Roles (or Administrator) in Server Settings → Roles.');
}

// ---------- :shortcode: emoji ----------
// Discord only converts :heart: when a person types it. Bots have to send the real emoji.
const EMOJI_CODES = {
	heart: '❤️', orange_heart: '🧡', yellow_heart: '💛', green_heart: '💚', blue_heart: '💙', purple_heart: '💜',
	pink_heart: '🩷', light_blue_heart: '🩵', grey_heart: '🩶', white_heart: '🤍', black_heart: '🖤', brown_heart: '🤎',
	heartpulse: '💗', heartbeat: '💓', sparkling_heart: '💖', two_hearts: '💕', revolving_hearts: '💞', cupid: '💘', gift_heart: '💝', broken_heart: '💔',
	red_circle: '🔴', orange_circle: '🟠', yellow_circle: '🟡', green_circle: '🟢', blue_circle: '🔵', purple_circle: '🟣', black_circle: '⚫', white_circle: '⚪',
	star: '⭐', star2: '🌟', sparkles: '✨', fire: '🔥', tada: '🎉', art: '🎨', bell: '🔔', calendar: '📆', date: '📅', video_game: '🎮', joystick: '🕹️', game_die: '🎲', space_invader: '👾',
	trophy: '🏆', crossed_swords: '⚔️', shield: '🛡️', musical_note: '🎵', notes: '🎶', headphones: '🎧', movie_camera: '🎥', clapper: '🎬', camera: '📷', books: '📚', pencil: '📝', computer: '💻',
	crescent_moon: '🌙', sunny: '☀️', cherry_blossom: '🌸', rainbow: '🌈', pizza: '🍕', coffee: '☕', cat: '🐱', dog: '🐶', wave: '👋', thumbsup: '👍', speech_balloon: '💬', loudspeaker: '📢', mega: '📣',
	white_check_mark: '✅', x: '❌', warning: '⚠️', eyes: '👀', skull: '💀', crown: '👑', gem: '💎', ribbon: '🎀', butterfly: '🦋',
};

/** Swaps :heart: for ❤️ and :server_emoji: for that emoji. Anything it doesn't know is left alone. */
function fixEmoji(text) {
	if (typeof text !== 'string' || !text.includes(':')) return text;
	return text.replace(/<a?:\w+:\d+>|:([a-z0-9_]+):/gi, (all, name) => {
		if (!name) return all;
		return state.guild?.emojis?.find(e => e.name === name)?.text ?? EMOJI_CODES[name.toLowerCase()] ?? all;
	});
}

function fixEmbedEmoji(e) {
	if (!e) return e;
	return {
		...e,
		title: fixEmoji(e.title),
		description: fixEmoji(e.description),
		author: e.author && { ...e.author, name: fixEmoji(e.author.name) },
		footer: e.footer && { ...e.footer, text: fixEmoji(e.footer.text) },
		fields: (e.fields ?? []).map(x => ({ ...x, name: fixEmoji(x.name), value: fixEmoji(x.value) })),
	};
}

// ---------- Discord-style markdown for the preview ----------

function escapeHtml(s) {
	return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function markdown(text, { block = true } = {}) {
	if (!text) return '';
	const stash = [];
	const keep = html => `\u0000${stash.push(html) - 1}\u0000`;
	let s = escapeHtml(fixEmoji(text));

	s = s.replace(/```(?:[a-z0-9]+\n)?([\s\S]*?)```/gi, (_, code) => keep(`<div class="md-pre">${code}</div>`));
	s = s.replace(/`([^`\n]+)`/g, (_, code) => keep(`<span class="md-code">${code}</span>`));
	s = s.replace(/&lt;(a?):(\w+):(\d{17,20})&gt;/g, (_, a, name, id) => keep(`<img class="md-emoji" alt=":${name}:" src="https://cdn.discordapp.com/emojis/${id}.${a ? 'gif' : 'webp'}?size=48">`));
	s = s.replace(/&lt;@&amp;(\d{17,20})&gt;/g, (_, id) => { const r = roleById(id); return keep(`<span class="mention" style="color:${r ? roleColor(r) : ''}">@${escapeHtml(r?.name ?? 'unknown-role')}</span>`); });
	s = s.replace(/&lt;#(\d{17,20})&gt;/g, (_, id) => keep(`<span class="mention">#${escapeHtml(channelById(id)?.name ?? 'unknown')}</span>`));
	s = s.replace(/&lt;@!?(\d{17,20})&gt;/g, () => keep('<span class="mention">@user</span>'));
	s = s.replace(/@(everyone|here)\b/g, (_, w) => keep(`<span class="mention">@${w}</span>`));
	s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, href) => keep(`<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`));
	s = s.replace(/https?:\/\/[^\s<]+[^\s<.,:;"')\]]/g, href => keep(`<a href="${href}" target="_blank" rel="noreferrer">${href}</a>`));
	s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>')
		.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
		.replace(/__(.+?)__/g, '<u>$1</u>')
		.replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>')
		.replace(/(^|\W)_(.+?)_(?=\W|$)/g, '$1<i>$2</i>')
		.replace(/~~(.+?)~~/g, '<s>$1</s>')
		.replace(/\|\|(.+?)\|\|/g, '<span class="md-code">$1</span>');
	if (block) {
		s = s.split('\n').map(line => {
			let m;
			if ((m = line.match(/^(#{1,3}) (.+)/))) return `<div class="md-h${m[1].length}">${m[2]}</div>`;
			if ((m = line.match(/^-# (.+)/))) return `<div class="md-sub">${m[1]}</div>`;
			if ((m = line.match(/^&gt; ?(.*)/))) return `<div class="md-quote">${m[1] || '&nbsp;'}</div>`;
			if ((m = line.match(/^\s*[-*] (.+)/))) return `<div>• ${m[1]}</div>`;
			return `${line}<br>`;
		}).join('').replace(/<br>$/, '');
	} else {
		s = s.replace(/\n/g, '<br>');
	}
	return s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[i]);
}

const md = (text, opts) => { const span = h('div'); span.innerHTML = markdown(text, opts); return span; };

// ---------- emoji picker ----------

const COMMON_EMOJI = ['✅', '❌', '⭐', '🔥', '🎉', '👍', '👋', '💬', '🔔', '📢', '🎮', '🕹️', '👾', '🎲', '🏆', '⚔️', '🛡️', '🎨', '🎵', '🎧', '📷', '🎬', '📚', '✏️', '💻', '🌙', '☀️', '🌸', '🍕', '☕', '🐱', '🐶', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '🇺🇸', '🇬🇧', '🇪🇺', '♂️', '♀️', '⚧️'];

function emojiField(value, onchange) {
	const input = h('input', { type: 'text', value: value ?? '', placeholder: 'emoji', oninput: () => onchange(input.value) });
	const wrap = h('div', { class: 'emoji-input' }, input);
	let pop = null;
	const pick = text => { input.value = text; onchange(text); pop?.remove(); pop = null; };
	const closeOnOutside = e => { if (pop && !wrap.contains(e.target)) { pop.remove(); pop = null; document.removeEventListener('mousedown', closeOnOutside); } };
	wrap.append(h('button', {
		type: 'button', class: 'emoji-btn', title: 'Pick an emoji', 'aria-label': 'Pick an emoji',
		onclick: () => {
			if (pop) { pop.remove(); pop = null; return; }
			const custom = state.guild.emojis;
			pop = h('div', { class: 'emoji-pop' },
				custom.length ? [h('div', { class: 'label' }, state.guild.name), h('div', { class: 'emoji-grid' }, custom.map(e => h('button', { type: 'button', title: `:${e.name}:`, onclick: () => pick(e.text) }, h('img', { src: e.url, alt: e.name }))))] : null,
				h('div', { class: 'label' }, 'Common'),
				h('div', { class: 'emoji-grid' }, COMMON_EMOJI.map(e => h('button', { type: 'button', onclick: () => pick(e) }, e))),
				h('div', { class: 'hint' }, 'Tip: on Windows press Win + . to type any emoji.'),
			);
			wrap.append(pop);
			document.addEventListener('mousedown', closeOnOutside);
		},
	}, '☺'));
	return wrap;
}

function emojiPreview(text) {
	text = fixEmoji(text);
	const m = /^<(a?):(\w+):(\d{17,20})>$/.exec(text ?? '');
	if (m) return h('img', { src: `https://cdn.discordapp.com/emojis/${m[3]}.${m[1] ? 'gif' : 'webp'}?size=48`, alt: m[2] });
	return text ? document.createTextNode(text) : null;
}

// ---------- view: send message ----------

// ---------- paste a whole role menu ----------

const PASTE_EXAMPLE = '# 🎮 pick ur games :3\nReact for the games you play.\n🔫 - valorant\n⛏️ - minecraft\n🌱 - indie games';

/**
 * Reads a pasted menu:  "# Title (pick one)", then "emoji - role name #hexcolour" lines.
 * Any other line becomes the text above the list.
 */
function parseMenuPaste(text) {
	const out = { title: '', unique: false, intro: [], rows: [] };
	for (const raw of text.split('\n')) {
		const line = fixEmoji(raw.trim());
		if (!line) continue;
		if (/^#\s/.test(line)) {
			out.unique = /\(pick one\)\s*$/i.test(line);
			out.title = line.replace(/^#\s*/, '').replace(/\(pick one\)\s*$/i, '').trim();
			continue;
		}
		const m = /^(<a?:\w+:\d+>|\S+)\s+(?:[-–—:]\s*)?(.+?)(?:\s+(#[0-9a-f]{6}))?$/i.exec(line);
		const isEmoji = m && (/^<a?:\w+:\d+>$/.test(m[1]) || /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3)/u.test(m[1]));
		if (isEmoji) out.rows.push({ emoji: m[1], name: m[2].trim(), color: m[3] ?? null });
		else out.intro.push(line);
	}
	return out;
}

async function pasteMenu() {
	const res = await modal({
		title: 'Paste a list',
		text: 'One role per line, like "❤️ - Red". Add "# Title" on top, and "(pick one)" after it if people can only have one. Roles you already have are matched by name.',
		confirm: 'Fill in',
		input: { multiline: true, placeholder: PASTE_EXAMPLE },
	});
	if (!res?.value) return;
	const parsed = parseMenuPaste(res.value);
	if (!parsed.rows.length) return toast('No role lines found. Each one needs an emoji first, like "🔫 - valorant".', 'warn');

	const problems = [];
	const seen = new Set();
	const rows = parsed.rows.filter(r => {
		const key = r.emoji.replace(/\uFE0F/g, '');
		if (seen.has(key)) { problems.push(`${r.name}: ${r.emoji} is already used`); return false; }
		seen.add(key);
		return true;
	});
	if (rows.length > 20) { problems.push(`Only the first 20 fit (Discord's reaction limit), so ${rows.length - 20} were left off`); rows.length = 20; }

	const find = name => state.guild.roles.find(r => !r.everyone && r.name.toLowerCase() === name.toLowerCase());
	const missing = rows.filter(r => !find(r.name));
	if (missing.length) {
		const ok = await modal({ title: `Create ${missing.length} new role${missing.length === 1 ? '' : 's'}?`, text: `These don't exist yet: ${missing.map(r => r.name).join(', ')}. They'll have no permissions.`, confirm: 'Create them' });
		if (!ok) return;
		for (const r of missing) {
			try {
				const out = await api(`/guilds/${state.guildId}/roles`, { method: 'POST', body: { name: r.name, color: r.color, permissions: [] } });
				state.guild.roles.push(out.role);
			} catch (e) {
				if (e.message === 'Locked') return;
				problems.push(`${r.name}: ${e.message}`);
			}
		}
	}

	const items = [];
	for (const r of rows) {
		const role = find(r.name);
		if (!role) continue;
		if (role.locked || role.managed) { problems.push(`${role.name}: the bot can't give this role (move it below the bot's role)`); continue; }
		if (items.some(i => i.roleId === role.id)) { problems.push(`${role.name} is on the list twice`); continue; }
		items.push({ roleId: role.id, emoji: r.emoji, label: '' });
	}
	if (!items.length) return toast(problems[0] ?? 'No usable roles.', 'bad');

	const list = items.map(i => `${i.emoji} - <@&${i.roleId}>`).join('\n');
	const title = parsed.title || draft.embed.title;
	const lower = title.toLowerCase();
	draft.embedOn = true;
	draft.embed.title = title;
	draft.embed.description = [parsed.intro.join('\n'), list].filter(Boolean).join('\n\n');
	draft.menuOn = true;
	draft.menu = {
		...draft.menu,
		mode: 'reactions',
		unique: parsed.unique,
		autoList: true,
		category: lower.includes('colo') ? 'Colours' : lower.includes('game') ? 'Games' : lower.includes('event') ? 'Events' : draft.menu.category,
		items,
	};
	store.set('draft', draft);
	render();
	toast(`Filled in ${items.length} roles. Pick a channel, check the preview, then send.`);
	if (problems.length) toast(`Skipped: ${problems.slice(0, 5).join('; ')}`, 'warn');
}

const DEFAULT_DRAFT = () => ({
	channelId: '',
	content: '',
	embedOn: true,
	embed: { title: '', url: '', description: '', color: '#ff69b4', author: { name: '', iconURL: '' }, thumbnail: '', image: '', footer: { text: '', iconURL: '' }, timestamp: false, fields: [] },
	menuOn: false,
	menu: { mode: 'reactions', unique: false, category: '', items: [] },
	allowMentions: false,
	// Set when editing a message that's already posted: { messageId, channelId, url, own, hadMenu }
	editing: null,
});

// Ready-made starting points for common messages. Pick one, then add your roles and tweak.
const COLOUR_EMOJI = { red: '❤️', orange: '🧡', yellow: '💛', green: '💚', blue: '💙', purple: '💜', pink: '💗', gray: '🤍', grey: '🤍', white: '🤍', black: '🖤', brown: '🤎' };
// Game and company tags, in menu order, each with its own emoji. Matched against your role names.
const GAME_EMOJI = [
	['valorant', '🔫'], ['minecraft', '⛏️'], ['league', '⚔️'], ['roblox', '🧱'], ['overwatch', '🦸'], ['fortnite', '🪂'], ['apex', '🦊'],
	['counter', '💣'], ['terraria', '🌳'], ['stardew', '🌾'], ['osu', '⭕'], ['among us', '🚀'], ['indie', '🌱'],
	['gacha', '🎰'], ['hoyo', '✨'], ['mihoyo', '🌠'], ['cygames', '🐎'], ['riot', '👊'], ['nintendo', '🍄'], ['steam', '♨️'],
];
const TEMPLATES = {
	colours: {
		label: '🎨 Colour roles',
		embed: { title: '🎨 pick ur colour :3', description: 'React to pick the colour of your name. You can only have one, so picking a new one swaps it.', color: '#ff69b4' },
		menu: { mode: 'reactions', unique: true, category: 'Colours' },
		// Pre-fills roles named after a colour ("Red", "blue"…) with its heart, in rainbow order.
		items: () => {
			const roles = assignableRoles();
			const used = new Set();
			return Object.entries(COLOUR_EMOJI).flatMap(([word, emoji]) => {
				const role = roles.find(r => r.name.trim().toLowerCase() === word);
				if (!role || used.has(emoji)) return [];
				used.add(emoji);
				return [{ roleId: role.id, emoji, label: '' }];
			});
		},
		// The list people read: "❤️ - Red"
		describe: items => items.map(i => `${i.emoji} - ${roleById(i.roleId)?.name}`).join('\n'),
	},
	games: {
		label: '🎮 Games',
		embed: { title: '🎮 pick ur games :3', description: 'React for the games you play. Remove your reaction to drop the role.', color: '#5865f2' },
		menu: { mode: 'reactions', unique: false, category: 'Games', autoList: true },
		// Pre-fills roles that match a game or company. The bot keeps the list up to date after that.
		items: () => {
			const roles = assignableRoles();
			const used = new Set();
			return GAME_EMOJI.flatMap(([word, emoji]) => {
				const role = roles.find(r => !used.has(r.id) && r.name.toLowerCase().includes(word));
				if (!role) return [];
				used.add(role.id);
				return [{ roleId: role.id, emoji, label: '' }];
			}).slice(0, 20);
		},
		describe: items => `React for the games you play. Remove your reaction to drop the role.\n\n${items.map(i => `${i.emoji} - <@&${i.roleId}>`).join('\n')}`,
	},
	events: {
		label: '📅 Events',
		embed: {
			title: '📅 Event pings',
			description: 'React to get pinged when these events happen. Remove your reaction to stop the pings.',
			color: '#faa61a',
			fields: [{ name: 'When', value: 'Times are posted in announcements before each event.', inline: false }],
		},
		menu: { mode: 'reactions', unique: false, category: 'Events' },
	},
};

let draft = Object.assign(DEFAULT_DRAFT(), store.get('draft', {}));
draft.menu.category ??= '';
const saveDraft = debounce(() => store.set('draft', draft), 300);

// Pulls a posted message (and its role menu, if it has one) into the editor.
async function loadMessage(channelId, messageId) {
	try {
		const m = await api(`/guilds/${state.guildId}/messages/${messageId}${channelId ? `?channelId=${channelId}` : ''}`);
		const fresh = DEFAULT_DRAFT();
		draft = {
			...fresh,
			channelId: m.channelId,
			content: m.content ?? '',
			embedOn: Boolean(m.embed),
			embed: m.embed ? { ...fresh.embed, ...m.embed } : fresh.embed,
			menuOn: Boolean(m.menu),
			menu: m.menu ?? fresh.menu,
			editing: { messageId: m.messageId, channelId: m.channelId, url: m.url, own: m.own, hadMenu: Boolean(m.menu) },
		};
		store.set('draft', draft);
		state.view = 'send';
		store.set('view', state.view);
		render();
		toast(m.own ? 'Loaded. Change anything, then press Save changes.' : 'Loaded. The bot didn\'t send this message, so you can only change its reaction roles.', m.own ? 'ok' : 'warn');
	} catch (e) {
		if (e.message !== 'Locked') toast(e.message, 'bad');
	}
}

function loadFromLink(text) {
	const m = /channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})/.exec(text ?? '');
	if (!m) return toast('Paste a message link (right-click the message → Copy Message Link).', 'warn');
	if (m[1] !== state.guildId) return toast('That link is from a different server. Switch servers first.', 'warn');
	return loadMessage(m[2], m[3]);
}

function viewSend() {
	const preview = h('div');
	const update = () => { saveDraft(); preview.replaceChildren(renderPreview()); };

	const text = (obj, key, { label, max, area, placeholder, type = 'text' }) => {
		const counter = max ? h('span', { class: 'count' }) : null;
		const sync = () => { if (counter) { counter.textContent = `${obj[key].length}/${max}`; counter.classList.toggle('over', obj[key].length > max); } };
		const input = h(area ? 'textarea' : 'input', {
			type: area ? undefined : type, value: obj[key] ?? '', placeholder,
			oninput: e => { obj[key] = e.target.value; sync(); update(); },
		});
		if (area) input.value = obj[key] ?? '';
		sync();
		return h('label', { class: 'field' }, h('div', { class: 'row' }, h('span', { class: 'label grow' }, label), counter), input);
	};

	// Insert a mention at the cursor in the description box
	const insertInto = (selector, value) => {
		const ta = $(selector);
		if (!ta) return;
		const at = ta.selectionStart ?? ta.value.length;
		ta.value = ta.value.slice(0, at) + value + ta.value.slice(ta.selectionEnd ?? at);
		ta.dispatchEvent(new Event('input'));
		ta.focus();
		ta.selectionStart = ta.selectionEnd = at + value.length;
	};

	const descField = text(draft.embed, 'description', { label: 'Description', max: 4096, area: true, placeholder: 'Supports **bold**, *italics*, __underline__, ~~strike~~, `code`, > quotes, # headings, [links](https://...)' });
	descField.querySelector('textarea').id = 'desc-box';
	descField.querySelector('textarea').rows = 6;

	const fieldsBox = h('div');
	const renderFields = () => {
		fieldsBox.replaceChildren(
			...draft.embed.fields.map((f, i) => h('div', { class: 'field-item' },
				h('div', { class: 'row' },
					h('input', { type: 'text', class: 'grow', placeholder: 'Field name', value: f.name, oninput: e => { f.name = e.target.value; update(); } }),
					h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.inline, onchange: e => { f.inline = e.target.checked; update(); } }), 'Inline'),
					h('button', { type: 'button', class: 'danger small', onclick: () => { draft.embed.fields.splice(i, 1); renderFields(); update(); } }, 'Remove'),
				),
				(() => { const ta = h('textarea', { placeholder: 'Field value', rows: 2, oninput: e => { f.value = e.target.value; update(); } }); ta.value = f.value; return ta; })(),
			)),
			draft.embed.fields.length < 25 ? h('button', { type: 'button', class: 'secondary small', onclick: () => { draft.embed.fields.push({ name: '', value: '', inline: false }); renderFields(); update(); } }, '+ Add field') : null,
		);
	};
	renderFields();

	const menuBox = h('div');
	const renderMenu = () => {
		const m = draft.menu;
		const reactions = m.mode === 'reactions';
		const limit = reactions ? 20 : 25;
		menuBox.replaceChildren(
			h('div', { class: 'row', style: { marginBottom: '12px' } },
				h('div', { class: 'seg', role: 'group', 'aria-label': 'Menu type' },
					h('button', { type: 'button', class: reactions ? 'on' : '', onclick: () => { m.mode = 'reactions'; renderMenu(); update(); } }, 'Reactions'),
					h('button', { type: 'button', class: reactions ? '' : 'on', onclick: () => { m.mode = 'buttons'; renderMenu(); update(); } }, 'Buttons'),
				),
				h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: m.unique, onchange: e => { m.unique = e.target.checked; update(); } }), 'Pick one only'),
			),
			h('label', { class: 'field' },
				h('span', { class: 'label' }, 'Category (groups your menus, e.g. Games, Events, Interests)'),
				h('input', { type: 'text', list: 'menu-categories', maxLength: 50, value: m.category ?? '', placeholder: 'Games', oninput: e => { m.category = e.target.value; saveDraft(); } }),
				h('datalist', { id: 'menu-categories' }, (state.guild.menuCategories ?? []).map(c => h('option', { value: c }))),
			),
			h('p', { class: 'hint' }, reactions
				? 'People react with the emoji to get the role, and remove their reaction to lose it. Up to 20 roles.'
				: 'People click a button to get the role, and click again to remove it. Emoji are optional. Up to 25 roles.'),
			...m.items.map((it, i) => h('div', { class: `menu-item ${reactions ? 'reactions' : ''}` },
				roleSelect(it.roleId, { onchange: e => { it.roleId = e.target.value; writeRowsToDescription(); update(); } }),
				emojiField(it.emoji, v => { it.emoji = v; writeRowsToDescription(); update(); }),
				reactions ? null : h('input', { type: 'text', placeholder: 'Button label (default: role name)', value: it.label ?? '', maxLength: 80, oninput: e => { it.label = e.target.value; update(); } }),
				h('button', { type: 'button', class: 'danger small', onclick: () => { m.items.splice(i, 1); writeRowsToDescription(); renderMenu(); update(); } }, '✕'),
			)),
			h('div', { class: 'row' },
				m.items.length < limit ? h('button', { type: 'button', class: 'secondary small', onclick: () => { m.items.push({ roleId: '', emoji: '', label: '' }); renderMenu(); update(); } }, '+ Add role') : null,
				m.items.length ? h('button', {
					type: 'button', class: 'ghost small', title: 'Adds a line per role (emoji → @role) to the description',
					onclick: () => {
						const lines = m.items.filter(x => x.roleId).map(x => `${x.emoji ? `${x.emoji} ` : ''}<@&${x.roleId}>`);
						if (!lines.length) return toast('Pick some roles first.', 'warn');
						draft.embedOn = true;
						draft.embed.description = (draft.embed.description ? `${draft.embed.description}\n\n` : '') + lines.join('\n');
						render();
					},
				}, 'Write the role list into the description') : null,
			),
			assignableRoles().length ? null : h('p', { class: 'banner' }, 'There are no roles the bot can give out. Create some in Roles, and make sure the bot\'s role is above them.'),
		);
	};
	renderMenu();

	const mentionPicker = h('select', {
		'aria-label': 'Insert a mention',
		style: { width: 'auto' },
		onchange: e => { if (e.target.value) insertInto('#desc-box', e.target.value); e.target.value = ''; },
	},
	h('option', { value: '' }, 'Insert mention…'),
	h('optgroup', { label: 'Roles' }, state.guild.roles.filter(r => !r.everyone).map(r => h('option', { value: `<@&${r.id}>` }, `@${r.name}`))),
	h('optgroup', { label: 'Channels' }, state.guild.channels.map(c => h('option', { value: `<#${c.id}>` }, `#${c.name}`))),
	);

	const editing = draft.editing;
	const sendBtn = h('button', { class: 'primary', onclick: () => sendMessage(sendBtn) }, editing ? 'Save changes' : 'Send to Discord');
	const stopEditing = () => { draft.editing = null; store.set('draft', draft); render(); };

	const linkInput = h('input', { type: 'url', class: 'grow', placeholder: 'Paste a message link to edit it…', onkeydown: e => { if (e.key === 'Enter') loadFromLink(linkInput.value); } });
	const channelPicker = channelSelect(draft.channelId, e => { draft.channelId = e.target.value; saveDraft(); });
	if (editing) channelPicker.disabled = true;

	const useTemplate = async t => {
		const dirty = draft.embed.title || draft.embed.description || draft.content || draft.menu.items.length;
		if (dirty && !await modal({ title: `Start from "${t.label}"?`, text: 'This replaces what\'s in the form (the channel stays).', confirm: 'Use template' })) return;
		const fresh = DEFAULT_DRAFT();
		draft = {
			...fresh,
			channelId: draft.channelId,
			editing: draft.editing, // keep editing the loaded message, if there is one
			content: t.content ?? '',
			embed: { ...fresh.embed, ...t.embed, author: { ...fresh.embed.author, ...t.embed.author }, footer: { ...fresh.embed.footer, ...t.embed.footer }, fields: (t.embed.fields ?? []).map(f => ({ ...f })) },
			embedOn: Object.keys(t.embed ?? {}).length > 0,
			menuOn: t.menuOn ?? true,
			menu: { ...fresh.menu, ...t.menu, items: t.items ? t.items() : [] },
		};
		if (t.describe && draft.menu.items.length) draft.embed.description = t.describe(draft.menu.items);
		store.set('draft', draft);
		render();
		toast(!draft.menuOn ? 'Template loaded.' : draft.menu.items.length ? `Loaded with ${draft.menu.items.length} roles. Check them, then send.` : 'Now add your roles under Role menu, then send.');
	};

	const saved = state.guild.templates ?? {};
	const savedTemplate = (name, t) => ({
		label: name,
		embed: t.embed ?? {},
		content: t.content ?? '',
		menu: t.menu ? { mode: t.menu.mode, unique: t.menu.unique, category: t.menu.category } : {},
		items: t.menu?.items?.length ? () => t.menu.items.filter(i => roleById(i.roleId)).map(i => ({ ...i })) : null,
		menuOn: Boolean(t.menu?.items?.length),
	});
	const saveTemplate = async () => {
		const res = await modal({ title: 'Save as a template', text: 'Saves the text, embed and role menu so you can reuse them. Same name = overwrite.', confirm: 'Save', input: { placeholder: 'Template name', max: 50, value: draft.embed.title.slice(0, 50) } });
		if (!res?.value) return;
		try {
			const out = await api(`/guilds/${state.guildId}/templates`, { method: 'POST', body: { name: res.value, draft: { content: draft.content, embed: draft.embedOn ? draft.embed : null, menu: draft.menuOn ? draft.menu : null } } });
			state.guild.templates = out.templates;
			toast(`Saved "${res.value}".`);
			render();
		} catch (e) { toast(e.message, 'bad'); }
	};
	const deleteTemplate = async name => {
		if (!await modal({ title: `Delete "${name}"?`, confirm: 'Delete', danger: true })) return;
		try {
			const out = await api(`/guilds/${state.guildId}/templates?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
			state.guild.templates = out.templates;
			render();
		} catch (e) { toast(e.message, 'bad'); }
	};

	const form = h('div', {},
		editing ? null : h('div', { class: 'card' },
			h('div', { class: 'label', style: { marginBottom: '8px' } }, 'Start from a template'),
			h('div', { class: 'row' },
				h('button', { type: 'button', class: 'primary small', onclick: pasteMenu }, '📋 Paste a list'),
				Object.values(TEMPLATES).map(t => h('button', { type: 'button', class: 'secondary small', onclick: () => useTemplate(t) }, t.label)),
				Object.entries(saved).map(([name, t]) => h('span', { class: 'chip' },
					h('button', { type: 'button', style: { color: 'inherit' }, onclick: () => useTemplate(savedTemplate(name, t)) }, `⭐ ${name}`),
					h('button', { type: 'button', title: `Delete ${name}`, 'aria-label': `Delete ${name}`, onclick: () => deleteTemplate(name) }, '✕'))),
			),
			h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { type: 'button', class: 'ghost small', onclick: saveTemplate }, '+ Save what\'s in the form as a template')),
		),
		editing
			? h('div', { class: 'banner' },
				'Editing ', h('a', { href: editing.url, target: '_blank', rel: 'noreferrer' }, 'this message'), '. Saving changes updates it in place.',
				editing.own ? null : ' The bot didn\'t send it, so only the reaction roles can change (the text and embed are ignored).',
				' ', h('button', { type: 'button', class: 'ghost small', onclick: stopEditing }, 'Stop editing (post as new)'))
			: h('div', { class: 'card' },
				h('div', { class: 'row' }, linkInput, h('button', { type: 'button', class: 'secondary small', onclick: () => loadFromLink(linkInput.value) }, 'Load message')),
				h('p', { class: 'hint', style: { marginBottom: 0 } }, 'Load an embed or role menu that\'s already posted to change it, like Carl-bot\'s edit.'),
			),
		h('div', { class: 'card' },
			h('label', { class: 'field' }, h('span', { class: 'label' }, 'Channel'), channelPicker),
			text(draft, 'content', { label: 'Message text (above the embed, optional)', max: 2000, area: true }),
		),
		h('details', { class: 'card collapse', open: draft.embedOn, ontoggle: e => { draft.embedOn = e.target.open; update(); } },
			h('summary', {}, 'Embed'),
			h('div', { class: 'body' },
				h('div', { class: 'row' },
					h('div', { class: 'grow' }, text(draft.embed, 'title', { label: 'Title', max: 256 })),
					h('label', { class: 'field' }, h('span', { class: 'label' }, 'Colour'), h('input', { type: 'color', value: draft.embed.color, oninput: e => { draft.embed.color = e.target.value; update(); } })),
				),
				descField,
				h('div', { class: 'row', style: { marginTop: '-6px', marginBottom: '12px' } }, mentionPicker, h('span', { class: 'hint' }, 'Mentions in embeds show up but never ping anyone.')),
				text(draft.embed, 'url', { label: 'Title link (optional)', type: 'url', placeholder: 'https://…' }),
				h('details', { class: 'collapse' }, h('summary', {}, 'Author, images, footer'),
					h('div', { class: 'body' },
						h('div', { class: 'grid2' },
							text(draft.embed.author, 'name', { label: 'Author name', max: 256 }),
							text(draft.embed.author, 'iconURL', { label: 'Author icon URL', type: 'url' }),
							text(draft.embed, 'thumbnail', { label: 'Thumbnail URL (small, top right)', type: 'url' }),
							text(draft.embed, 'image', { label: 'Image URL (big, bottom)', type: 'url' }),
							text(draft.embed.footer, 'text', { label: 'Footer text', max: 2048 }),
							text(draft.embed.footer, 'iconURL', { label: 'Footer icon URL', type: 'url' }),
						),
						h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: draft.embed.timestamp, onchange: e => { draft.embed.timestamp = e.target.checked; update(); } }), 'Show the time it was sent'),
					),
				),
				h('h3', {}, 'Fields'),
				fieldsBox,
			),
		),
		h('details', { class: 'card collapse', open: draft.menuOn, ontoggle: e => { draft.menuOn = e.target.open; update(); } },
			h('summary', {}, 'Role menu (give roles from this message)'),
			h('div', { class: 'body' }, menuBox),
		),
		h('div', { class: 'card' },
			h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: draft.allowMentions, onchange: e => { draft.allowMentions = e.target.checked; saveDraft(); } }), 'Let mentions in the message text ping people (off = they show but don\'t notify)'),
			h('div', { class: 'row', style: { marginTop: '14px' } },
				sendBtn,
				editing ? null : (() => {
					const when = h('input', { type: 'datetime-local', style: { width: 'auto' }, 'aria-label': 'Send later at' });
					const btn = h('button', {
						class: 'secondary', title: 'Send it automatically at this time (your computer\'s timezone)',
						onclick: () => {
							const at = when.value ? new Date(when.value).getTime() : NaN;
							if (!Number.isFinite(at)) return toast('Pick a date and time to send it later.', 'warn');
							sendMessage(btn, at);
						},
					}, 'Schedule');
					return h('span', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'hint' }, 'or send later:'), when, btn);
				})(),
				h('button', { class: 'ghost', onclick: async () => { if (await modal({ title: 'Clear the form?', text: 'This empties every box.', confirm: 'Clear', danger: true })) { draft = DEFAULT_DRAFT(); store.set('draft', draft); render(); } } }, 'Clear form'),
			),
		),
	);

	update();
	return [
		h('h1', {}, editing ? 'Edit a message' : 'Send a message'),
		h('p', { class: 'lead' }, 'Build an embed, optionally turn it into a role menu, and post it to any channel.'),
		permissionBanner(),
		h('div', { class: 'composer' }, form, h('div', { class: 'preview-col' }, h('div', { class: 'label', style: { marginBottom: '6px' } }, 'Preview'), preview)),
	];
}

function renderPreview() {
	const e = draft.embed;
	const bot = state.status.bot;
	const embedHas = draft.embedOn && (e.title || e.description || e.author.name || e.image || e.thumbnail || e.footer.text || e.fields.some(f => f.name || f.value));
	const m = draft.menu;
	const items = draft.menuOn ? m.items.filter(i => i.roleId) : [];

	const embed = embedHas ? h('div', { class: 'embed', style: { borderLeftColor: e.color } },
		e.thumbnail ? h('img', { class: 'thumb', src: e.thumbnail, alt: '' }) : null,
		e.author.name ? h('div', { class: 'author' }, e.author.iconURL ? h('img', { src: e.author.iconURL, alt: '' }) : null, e.author.name) : null,
		e.title ? h('div', { class: 'title' }, e.url ? h('a', { href: e.url, target: '_blank', rel: 'noreferrer' }, md(e.title, { block: false })) : md(e.title, { block: false })) : null,
		e.description ? h('div', { class: 'desc' }, md(e.description)) : null,
		e.fields.some(f => f.name || f.value) ? h('div', { class: 'fields' }, e.fields.filter(f => f.name || f.value).map(f => h('div', { class: `f ${f.inline ? 'inline' : ''}` }, h('div', { class: 'fn' }, md(f.name, { block: false })), h('div', { class: 'fv' }, md(f.value))))) : null,
		e.image ? h('img', { class: 'image', src: e.image, alt: '' }) : null,
		e.footer.text || e.timestamp ? h('div', { class: 'footer' }, e.footer.iconURL ? h('img', { src: e.footer.iconURL, alt: '' }) : null, [e.footer.text, e.timestamp ? 'Today at ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null].filter(Boolean).join(' • ')) : null,
	) : null;

	let menuPreview = null;
	if (items.length && m.mode === 'reactions') {
		menuPreview = h('div', { class: 'dc-reactions' }, items.filter(i => i.emoji).map(i => h('span', { class: 'dc-reaction', title: roleById(i.roleId)?.name }, emojiPreview(i.emoji), '1')));
	} else if (items.length) {
		const rows = [];
		for (let i = 0; i < items.length; i += 5) rows.push(items.slice(i, i + 5));
		menuPreview = h('div', { class: 'dc-buttons' }, rows.map(row => h('div', { class: 'dc-btnrow' }, row.map(i => h('span', { class: 'dc-btn' }, emojiPreview(i.emoji), i.label || roleById(i.roleId)?.name || 'role')))));
	}

	return h('div', { class: 'dc' },
		bot ? h('img', { class: 'dc-avatar', src: bot.avatar, alt: '' }) : h('div', { class: 'dc-avatar' }),
		h('div', { class: 'dc-head' }, h('span', { class: 'dc-name' }, bot?.tag.split('#')[0] ?? 'Silvered'), h('span', { class: 'dc-bot' }, 'APP'), h('span', { class: 'dc-time' }, 'Today at ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))),
		draft.content ? h('div', { class: 'dc-content' }, md(draft.content)) : null,
		embed,
		menuPreview,
		!draft.content && !embed ? h('div', { class: 'hint' }, 'Your message will show up here as you type.') : null,
	);
}

// Self-updating menus: the "emoji - @role" lines in the description and the menu rows stay the same.
const MENU_LINE = /^(\S+) (?:- )?<@&(\d{17,20})>$/;

/** Rows changed: rewrite the list in the description. */
function writeRowsToDescription() {
	if (!draft.menu.autoList || draft.menu.mode !== 'reactions') return;
	const intro = (draft.embed.description ?? '').split('\n').filter(l => !MENU_LINE.test(l.trim())).join('\n').trim();
	const list = draft.menu.items.filter(i => i.roleId && i.emoji).map(i => `${fixEmoji(i.emoji)} - <@&${i.roleId}>`).join('\n');
	draft.embed.description = [intro, list].filter(Boolean).join('\n\n');
	const box = document.querySelector('#desc-box');
	if (box) { box.value = draft.embed.description; box.dispatchEvent(new Event('input')); }
}

/** Description edited by hand: the rows follow it, so the reactions give what the text says. */
function readRowsFromDescription() {
	if (!draft.menuOn || !draft.menu.autoList || draft.menu.mode !== 'reactions') return;
	const lines = (draft.embed.description ?? '').split('\n').map(l => MENU_LINE.exec(fixEmoji(l.trim()))).filter(Boolean);
	if (lines.length) draft.menu.items = lines.map(m => ({ roleId: m[2], emoji: m[1], label: '' }));
}

async function sendMessage(btn, sendAt = null) {
	if (!draft.channelId) return toast('Pick a channel first.', 'warn');
	readRowsFromDescription();
	const items = (draft.menuOn ? draft.menu.items.filter(i => i.roleId) : []).map(i => ({ ...i, emoji: fixEmoji(i.emoji) }));
	if (draft.menuOn && draft.menu.items.length && !items.length) return toast('Pick a role for each menu row (or close the Role menu section).', 'warn');
	const editing = draft.editing;
	const body = {
		channelId: editing?.channelId ?? draft.channelId,
		content: fixEmoji(draft.content),
		embed: draft.embedOn ? fixEmbedEmoji(draft.embed) : null,
		menu: items.length ? { mode: draft.menu.mode, unique: draft.menu.unique, category: draft.menu.category ?? '', autoList: draft.menu.autoList === true, items } : null,
		allowMentions: draft.allowMentions,
	};
	if (sendAt) {
		btn.disabled = true;
		try {
			const res = await api(`/guilds/${state.guildId}/messages`, { method: 'POST', body: { ...body, sendAt } });
			toast(`Scheduled for ${new Date(res.scheduled.at).toLocaleString()}. See it on the Scheduled page.`);
		} catch (e) {
			if (e.message !== 'Locked') toast(e.message, 'bad');
		} finally {
			btn.disabled = false;
		}
		return;
	}
	if (editing?.hadMenu && !items.length && !(await modal({ title: 'Save without a role menu?', text: 'This message\'s role menu will stop giving roles. People keep the roles they already have.', confirm: 'Save' }))) return;
	const label = btn.textContent;
	btn.disabled = true;
	btn.textContent = editing ? 'Saving…' : 'Sending…';
	try {
		const res = editing
			? await api(`/guilds/${state.guildId}/messages/${editing.messageId}`, { method: 'PATCH', body })
			: await api(`/guilds/${state.guildId}/messages`, { method: 'POST', body });
		const what = editing ? 'Saved!' : items.length ? 'Role menu posted!' : 'Message sent!';
		toast(what, 'ok', { href: res.url, text: 'Open in Discord' });
		if (res.warning) toast(res.warning, 'warn');
		if (editing) { editing.hadMenu = items.length > 0; store.set('draft', draft); }
		if (items.length && draft.menu.category && !(state.guild.menuCategories ?? []).includes(draft.menu.category)) {
			state.guild.menuCategories = [...(state.guild.menuCategories ?? []), draft.menu.category];
		}
	} catch (e) {
		if (e.message !== 'Locked') toast(e.message, 'bad');
	} finally {
		btn.disabled = false;
		btn.textContent = label;
	}
}

// ---------- view: role menus ----------

function viewMenus() {
	const body = h('div', {}, h('div', { class: 'card' }, h('div', { class: 'empty' }, 'Loading…')));

	const menuRow = (m, reload) => h('tr', {},
		h('td', {}, h('div', { style: { fontWeight: 600 } }, m.title), h('div', { class: 'hint' }, m.createdAt ? new Date(m.createdAt).toLocaleString() : '')),
		h('td', {}, m.channelName ? `#${m.channelName}` : h('span', { class: 'badge warn' }, 'channel deleted')),
		h('td', {}, m.mode === 'reactions' ? 'Reactions' : 'Buttons', m.unique ? h('div', { class: 'hint' }, 'pick one') : null),
		h('td', {}, m.items.length ? h('div', { class: 'chips' }, m.items.map(i => {
			const r = roleById(i.roleId);
			return h('span', { class: 'chip' }, emojiPreview(i.emoji), h('span', { class: 'dot', style: { background: roleColor(r) } }), r?.name ?? 'deleted role');
		})) : h('span', { class: 'hint' }, 'no roles yet')),
		h('td', {}, h('div', { class: 'row', style: { justifyContent: 'flex-end', flexWrap: 'nowrap' } },
			h('a', { href: m.url, target: '_blank', rel: 'noreferrer' }, 'Open'),
			m.channelName ? h('button', { class: 'secondary small', onclick: () => loadMessage(m.channelId, m.messageId) }, 'Edit') : null,
			h('button', {
				class: 'danger small',
				onclick: async () => {
					const ok = await modal({
						title: 'Delete this role menu?',
						text: m.mode === 'reactions'
							? 'Reactions on it will stop giving roles. People keep the roles they already have.'
							: 'It will be removed from this list. Its buttons keep working until the message is deleted.',
						confirm: 'Delete', danger: true,
						checkbox: { label: 'Also delete the message in Discord', checked: true },
					});
					if (!ok) return;
					try {
						const res = await api(`/guilds/${state.guildId}/menus/${m.messageId}?deleteMessage=${ok.checked ? 1 : 0}`, { method: 'DELETE' });
						toast(`Menu deleted.${res.note ?? ''}`);
						reload();
					} catch (e) { toast(e.message, 'bad'); }
				},
			}, 'Delete'),
		)),
	);

	const load = async () => {
		let menus;
		try { menus = await api(`/guilds/${state.guildId}/menus`); } catch (e) { body.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'empty' }, e.message))); return; }
		if (!menus.length) {
			body.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'empty' }, 'No role menus yet. Make one from Send message → Role menu, or with /reactionrole create in Discord.')));
			return;
		}
		// Group by category (Games, Events, Interests…), uncategorised last.
		const groups = new Map();
		for (const m of menus) {
			const cat = m.category || '';
			if (!groups.has(cat)) groups.set(cat, []);
			groups.get(cat).push(m);
		}
		const order = [...groups.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b));
		body.replaceChildren(...order.flatMap(cat => [
			h('h3', {}, cat || 'No category', h('span', { class: 'hint', style: { marginLeft: '8px', fontWeight: 400 } }, `${groups.get(cat).length} menu${groups.get(cat).length === 1 ? '' : 's'}`)),
			h('div', { class: 'card', style: { padding: 0, marginBottom: '16px' } }, h('table', {},
				h('thead', {}, h('tr', {}, h('th', {}, 'Menu'), h('th', {}, 'Channel'), h('th', {}, 'Type'), h('th', {}, 'Roles'), h('th', {}, ''))),
				h('tbody', {}, groups.get(cat).map(m => menuRow(m, load))),
			)),
		]));
	};
	load();
	return [
		h('h1', {}, 'Role menus'),
		h('p', { class: 'lead' }, 'Menus made here or with /reactionrole, grouped by category. Press Edit to change a menu\'s embed, roles or emoji. (Button menus made with /rolemenu work too, but don\'t show up here.)'),
		body,
	];
}

// ---------- view: roles ----------

const PERM_LABELS = {
	ViewChannel: 'View Channels', ManageChannels: 'Manage Channels', ManageRoles: 'Manage Roles', ManageGuildExpressions: 'Manage Expressions',
	ViewAuditLog: 'View Audit Log', ManageWebhooks: 'Manage Webhooks', ManageGuild: 'Manage Server', CreateInstantInvite: 'Create Invite',
	ChangeNickname: 'Change Nickname', ManageNicknames: 'Manage Nicknames', KickMembers: 'Kick Members', BanMembers: 'Ban Members',
	ModerateMembers: 'Timeout Members', SendMessages: 'Send Messages', SendMessagesInThreads: 'Send Messages in Threads',
	CreatePublicThreads: 'Create Public Threads', CreatePrivateThreads: 'Create Private Threads', EmbedLinks: 'Embed Links',
	AttachFiles: 'Attach Files', AddReactions: 'Add Reactions', UseExternalEmojis: 'Use External Emoji', UseExternalStickers: 'Use External Stickers',
	MentionEveryone: 'Mention @everyone and All Roles', ManageMessages: 'Manage Messages', ManageThreads: 'Manage Threads',
	ReadMessageHistory: 'Read Message History', UseApplicationCommands: 'Use Slash Commands', SendPolls: 'Create Polls', Connect: 'Connect',
	Speak: 'Speak', Stream: 'Video / Stream', UseVAD: 'Use Voice Activity', PrioritySpeaker: 'Priority Speaker', MuteMembers: 'Mute Members',
	DeafenMembers: 'Deafen Members', MoveMembers: 'Move Members', Administrator: 'Administrator (everything, be careful)',
};

const PRESETS = {
	'No extra permissions': [],
	'Trusted member': ['EmbedLinks', 'AttachFiles', 'UseExternalEmojis', 'UseExternalStickers', 'CreatePublicThreads', 'ChangeNickname'],
	'Semi-Mod': ['ModerateMembers', 'ManageMessages', 'ManageNicknames', 'ManageThreads', 'MuteMembers', 'MoveMembers'],
	Mod: ['KickMembers', 'BanMembers', 'ModerateMembers', 'ManageMessages', 'ManageChannels', 'ManageRoles', 'ManageNicknames', 'ManageThreads', 'ViewAuditLog', 'MuteMembers', 'DeafenMembers', 'MoveMembers', 'MentionEveryone'],
};

function roleEditor(role, onDone) {
	const editing = Boolean(role);
	const v = {
		name: role?.name ?? '',
		color: role?.color && role.color !== '#000000' ? role.color : '#99aab5',
		noColor: editing ? role.color === '#000000' : false,
		hoist: role?.hoist ?? false,
		mentionable: role?.mentionable ?? false,
		permissions: new Set(role?.permissions ?? []),
	};
	const noColorBox = h('input', { type: 'checkbox', checked: v.noColor, onchange: e => { v.noColor = e.target.checked; } });
	const botPerms = new Set(state.guild.me.permissions);
	const botIsAdmin = botPerms.has('Administrator');
	const permsBox = h('div', { class: 'perm-groups' });
	const renderPerms = () => permsBox.replaceChildren(...state.status.permissionGroups.flatMap(([group, names]) => [
		h('h4', {}, group),
		...names.map(n => {
			const can = botIsAdmin || botPerms.has(n);
			return h('label', { class: can ? '' : 'off', title: can ? '' : 'The bot doesn\'t have this permission itself, so it can\'t give it out.' },
				h('input', { type: 'checkbox', checked: v.permissions.has(n), disabled: !can, onchange: e => { e.target.checked ? v.permissions.add(n) : v.permissions.delete(n); } }),
				PERM_LABELS[n] ?? n);
		}),
	]));
	renderPerms();

	const save = h('button', {
		class: 'primary',
		onclick: async () => {
			if (!v.name.trim()) return toast('Give the role a name.', 'warn');
			save.disabled = true;
			const body = { name: v.name, color: v.noColor ? '#000000' : v.color, hoist: v.hoist, mentionable: v.mentionable, permissions: [...v.permissions] };
			try {
				const res = editing
					? await api(`/guilds/${state.guildId}/roles/${role.id}`, { method: 'PATCH', body })
					: await api(`/guilds/${state.guildId}/roles`, { method: 'POST', body });
				toast(editing ? `Saved ${res.role.name}.` : `Created ${res.role.name}. New roles start at the bottom of the list, drag them up in Discord if needed.`);
				if (res.skipped?.length) toast(`Skipped permissions the bot doesn't have: ${res.skipped.join(', ')}`, 'warn');
				await loadGuild();
				onDone?.();
			} catch (e) {
				toast(e.message, 'bad');
				save.disabled = false;
			}
		},
	}, editing ? 'Save changes' : 'Create role');

	return h('div', { class: editing ? 'role-editor' : '' },
		h('div', { class: 'row' },
			h('label', { class: 'field grow' }, h('span', { class: 'label' }, 'Name'), h('input', { type: 'text', value: v.name, maxLength: 100, oninput: e => { v.name = e.target.value; } })),
			h('label', { class: 'field' }, h('span', { class: 'label' }, 'Colour'), h('input', { type: 'color', value: v.color, oninput: e => { v.color = e.target.value; v.noColor = false; noColorBox.checked = false; } })),
		),
		h('div', { class: 'row', style: { marginBottom: '8px' } },
			h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: v.hoist, onchange: e => { v.hoist = e.target.checked; } }), 'Show separately in the member list'),
			h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: v.mentionable, onchange: e => { v.mentionable = e.target.checked; } }), 'Anyone can @mention it'),
			h('label', { class: 'check' }, noColorBox, 'No colour'),
		),
		h('div', { class: 'row' },
			h('span', { class: 'label' }, 'Permissions'),
			h('select', { style: { width: 'auto' }, onchange: e => { if (e.target.value) { v.permissions = new Set(PRESETS[e.target.value].filter(n => botIsAdmin || botPerms.has(n))); renderPerms(); } e.target.value = ''; } },
				h('option', { value: '' }, 'Fill from a preset…'),
				Object.keys(PRESETS).map(p => h('option', { value: p }, p))),
		),
		permsBox,
		h('div', { class: 'row', style: { marginTop: '16px' } }, save, editing ? h('button', { class: 'ghost', onclick: () => onDone?.() }, 'Cancel') : null),
	);
}

function viewRoles() {
	const list = h('div', { class: 'card', style: { padding: 0 } });
	let open = null;
	const renderList = () => {
		list.replaceChildren(...state.guild.roles.filter(r => !r.everyone).flatMap(r => {
			const row = h('div', { class: 'role-row' },
				h('span', { class: 'dot', style: { background: roleColor(r) } }),
				h('div', {}, h('div', { class: 'name' }, r.name),
					h('div', { class: 'meta' }, `${r.members} member${r.members === 1 ? '' : 's'}`,
						r.managed ? h('span', { class: 'badge' }, 'bot/integration') : null,
						r.locked && !r.managed ? h('span', { class: 'badge warn', title: r.locked }, 'above the bot') : null,
						r.permissions.includes('Administrator') ? h('span', { class: 'badge warn' }, 'admin') : null)),
				h('button', { class: 'secondary small', disabled: Boolean(r.locked), title: r.locked ?? '', onclick: () => { open = open === r.id ? null : r.id; renderList(); } }, open === r.id ? 'Close' : 'Edit'),
				h('button', {
					class: 'danger small', disabled: Boolean(r.locked), title: r.locked ?? '',
					onclick: async () => {
						if (!await modal({ title: `Delete ${r.name}?`, text: `${r.members} member(s) will lose it. This can't be undone.`, confirm: 'Delete role', danger: true })) return;
						try { await api(`/guilds/${state.guildId}/roles/${r.id}`, { method: 'DELETE' }); toast(`Deleted ${r.name}.`); await loadGuild(); } catch (e) { toast(e.message, 'bad'); }
					},
				}, 'Delete'),
			);
			return open === r.id ? [row, roleEditor(r, () => { open = null; renderList(); })] : [row];
		}));
	};
	renderList();
	return [
		h('h1', {}, 'Roles'),
		h('p', { class: 'lead' }, `Highest first, like in Discord. The bot can only change roles below its own top role (${state.guild.me.highestRole}). To reorder roles, drag them in Server Settings → Roles.`),
		permissionBanner(),
		h('details', { class: 'card collapse' }, h('summary', {}, 'Create a role'), h('div', { class: 'body' }, roleEditor(null))),
		h('h3', {}, `${state.guild.roles.length - 1} roles`),
		list,
	];
}

// ---------- view: members ----------

function viewMembers() {
	const results = h('div', { class: 'card', style: { padding: 0 } });
	const roles = assignableRoles();

	const memberRow = m => {
		const el = h('div', { class: 'member' });
		const fill = mem => {
			el.replaceChildren(
				h('img', { src: mem.avatar, alt: '' }),
				h('div', {},
					h('div', { class: 'who' }, mem.displayName, h('small', {}, `@${mem.username}`), mem.bot ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, 'bot') : null),
					h('div', { class: 'chips' },
						mem.roles.map(id => roleById(id)).filter(Boolean).sort((a, b) => b.position - a.position).map(r => h('span', { class: 'chip' },
							h('span', { class: 'dot', style: { background: roleColor(r) } }), r.name,
							r.locked || r.managed ? null : h('button', { title: `Remove ${r.name}`, 'aria-label': `Remove ${r.name}`, onclick: () => change(mem, r, 'DELETE') }, '✕'))),
						roleSelect('', {
							placeholder: '+ add role',
							roles: roles.filter(r => !mem.roles.includes(r.id)),
							onchange: e => { const r = roleById(e.target.value); if (r) change(mem, r, 'PUT'); },
						}),
					),
				),
			);
		};
		const change = async (mem, r, method) => {
			try {
				const res = await api(`/guilds/${state.guildId}/members/${mem.id}/roles/${r.id}`, { method });
				toast(method === 'PUT' ? `Gave ${r.name} to ${mem.displayName}.` : `Took ${r.name} from ${mem.displayName}.`);
				fill(res.member);
			} catch (e) { toast(e.message, 'bad'); fill(mem); }
		};
		fill(m);
		return el;
	};

	const search = async q => {
		results.replaceChildren(h('div', { class: 'empty' }, 'Searching…'));
		try {
			const members = await api(`/guilds/${state.guildId}/members?q=${encodeURIComponent(q)}`);
			results.replaceChildren(...(members.length ? members.map(memberRow) : [h('div', { class: 'empty' }, 'Nobody found.')]));
		} catch (e) { results.replaceChildren(h('div', { class: 'empty' }, e.message)); }
	};
	const input = h('input', { type: 'search', placeholder: 'Search by name…', oninput: debounce(e => search(e.target.value.trim()), 300) });
	search('');
	return [
		h('h1', {}, 'Members'),
		h('p', { class: 'lead' }, 'Search someone and give or take roles. Shows the first 50 matches.'),
		permissionBanner(),
		h('div', { class: 'card', style: { marginBottom: '16px' } }, input),
		results,
	];
}

// ---------- view: scheduled (events + scheduled messages) ----------

function viewScheduled() {
	const listBox = h('div', { class: 'card', style: { padding: 0 } }, h('div', { class: 'empty' }, 'Loading…'));
	const ev = { title: '', description: '', when: '', roleId: '', channelId: '', remind: 15 };

	const load = async () => {
		let jobs;
		try { jobs = await api(`/guilds/${state.guildId}/scheduled`); } catch (e) { listBox.replaceChildren(h('div', { class: 'empty' }, e.message)); return; }
		if (!jobs.length) return listBox.replaceChildren(h('div', { class: 'empty' }, 'Nothing scheduled. Make an event above, or use "Schedule" on the Send message page.'));
		listBox.replaceChildren(h('table', {},
			h('thead', {}, h('tr', {}, h('th', {}, 'What'), h('th', {}, 'Channel'), h('th', {}, 'Happens'), h('th', {}, ''))),
			h('tbody', {}, jobs.map(j => h('tr', {},
				h('td', {}, h('div', { style: { fontWeight: 600 } }, j.kind === 'event' ? `📅 ${j.title}` : `✉ ${j.title}`),
					h('div', { class: 'hint' }, j.kind === 'event' ? `Event at ${new Date(j.eventAt).toLocaleString()}${j.roleId ? ` · pings @${roleById(j.roleId)?.name ?? 'deleted role'}` : ''}` : 'Scheduled message')),
				h('td', {}, `#${channelById(j.channelId)?.name ?? 'deleted'}`),
				h('td', {}, new Date(j.at).toLocaleString(), h('div', { class: 'hint' }, j.kind === 'event' ? 'reminder ping' : 'sends')),
				h('td', {}, h('div', { class: 'row', style: { justifyContent: 'flex-end', flexWrap: 'nowrap' } },
					j.messageId ? h('a', { href: `https://discord.com/channels/${state.guildId}/${j.channelId}/${j.messageId}`, target: '_blank', rel: 'noreferrer' }, 'Open') : null,
					h('button', {
						class: 'danger small',
						onclick: async () => {
							const text = j.kind === 'event' ? 'The reminder is dropped and the event post is marked as cancelled.' : 'It won\'t be sent.';
							if (!await modal({ title: j.kind === 'event' ? 'Cancel this event?' : 'Cancel this message?', text, confirm: 'Cancel it', danger: true })) return;
							try { await api(`/guilds/${state.guildId}/scheduled/${j.id}`, { method: 'DELETE' }); toast('Cancelled.'); load(); } catch (e) { toast(e.message, 'bad'); }
						},
					}, 'Cancel'),
				)),
			))),
		));
	};

	const createBtn = h('button', {
		class: 'primary',
		onclick: async () => {
			const at = ev.when ? new Date(ev.when).getTime() : NaN;
			if (!ev.title.trim()) return toast('Give the event a title.', 'warn');
			if (!Number.isFinite(at)) return toast('Pick when it starts.', 'warn');
			if (!ev.channelId) return toast('Pick a channel.', 'warn');
			createBtn.disabled = true;
			try {
				const res = await api(`/guilds/${state.guildId}/events`, { method: 'POST', body: { title: ev.title, description: ev.description, at, roleId: ev.roleId || null, channelId: ev.channelId, remindMinutes: Number(ev.remind) || 0 } });
				toast('Event posted!', 'ok', { href: res.url, text: 'Open in Discord' });
				if (res.warning) toast(res.warning, 'warn');
				load();
			} catch (e) { toast(e.message, 'bad'); } finally { createBtn.disabled = false; }
		},
	}, 'Post event');

	const desc = h('textarea', { rows: 3, maxLength: 4000, placeholder: 'What, where, what to bring… (optional)', oninput: e => { ev.description = e.target.value; } });
	load();
	return [
		h('h1', {}, 'Scheduled'),
		h('p', { class: 'lead' }, 'Events and messages waiting to go out. Times show in your computer\'s timezone, and in Discord everyone sees event times in their own.'),
		h('div', { class: 'card' },
			h('h2', {}, 'New event'),
			h('p', { class: 'hint' }, 'Posts the event now. People react 🔔 to get the role, and the role gets pinged before it starts. Same as /event create.'),
			h('div', { class: 'grid2' },
				h('label', { class: 'field' }, h('span', { class: 'label' }, 'Title'), h('input', { type: 'text', maxLength: 200, placeholder: 'Movie Night', oninput: e => { ev.title = e.target.value; } })),
				h('label', { class: 'field' }, h('span', { class: 'label' }, 'Starts'), h('input', { type: 'datetime-local', oninput: e => { ev.when = e.target.value; } })),
				h('label', { class: 'field' }, h('span', { class: 'label' }, 'Role to ping (optional)'), roleSelect('', { placeholder: 'No ping', roles: state.guild.roles.filter(r => !r.everyone && !r.managed), onchange: e => { ev.roleId = e.target.value; } })),
				h('label', { class: 'field' }, h('span', { class: 'label' }, 'Ping how many minutes before'), h('input', { type: 'number', min: 0, max: 10080, value: 15, oninput: e => { ev.remind = e.target.value; } })),
			),
			h('label', { class: 'field' }, h('span', { class: 'label' }, 'Details'), desc),
			h('div', { class: 'row' }, h('div', { class: 'grow' }, channelSelect('', e => { ev.channelId = e.target.value; })), createBtn),
		),
		h('h3', {}, 'Coming up'),
		listBox,
	];
}

// ---------- view: who's who ----------

function viewWhois() {
	const list = h('div', { class: 'card', style: { padding: 0 } }, h('div', { class: 'empty' }, 'Loading…'));
	const postBox = h('div', { class: 'card' });
	let members = [];
	let posted = null;
	let maxNote = 100;
	let channelId = '';
	let filter = '';

	const renderPost = () => {
		const btn = h('button', {
			class: 'primary',
			onclick: async () => {
				const target = channelId || posted?.channelId;
				if (!target) return toast('Pick a channel first.', 'warn');
				btn.disabled = true;
				try {
					const res = await api(`/guilds/${state.guildId}/whois/post`, { method: 'POST', body: { channelId: target } });
					posted = res.posted;
					toast('Posted.', 'ok', { href: res.url, text: 'Open in Discord' });
					renderPost();
				} catch (e) { toast(e.message, 'bad'); btn.disabled = false; }
			},
		}, posted ? 'Repost' : 'Post to Discord');
		postBox.replaceChildren(
			h('h2', {}, 'Posted list'),
			posted
				? h('p', {}, 'Posted in ', h('a', { href: posted.url, target: '_blank', rel: 'noreferrer' }, `#${channelById(posted.channelId)?.name ?? 'channel'}`),
					'. It updates itself a few seconds after you change a note, or when people join, leave or change roles.')
				: h('p', { class: 'hint' }, 'Not posted yet. Pick a channel and post it. After that it keeps itself up to date.'),
			h('div', { class: 'row' },
				h('div', { class: 'grow' }, channelSelect(channelId || posted?.channelId || '', e => { channelId = e.target.value; })),
				btn,
				posted ? h('button', {
					class: 'danger',
					onclick: async () => {
						if (!await modal({ title: 'Delete the posted list?', text: 'Notes are kept, so you can post it again later.', confirm: 'Delete', danger: true })) return;
						try { await api(`/guilds/${state.guildId}/whois/post`, { method: 'DELETE' }); posted = null; toast('Deleted.'); renderPost(); } catch (e) { toast(e.message, 'bad'); }
					},
				}, 'Delete') : null,
			),
		);
	};

	const row = m => {
		const status = h('span', { class: 'hint' });
		const input = h('input', {
			type: 'text', maxLength: maxNote, value: m.note ?? '', placeholder: 'Add a note, e.g. "owner, makes the bot"',
			onkeydown: e => { if (e.key === 'Enter') e.target.blur(); },
			onchange: async e => {
				status.textContent = 'Saving…';
				try {
					const res = await api(`/guilds/${state.guildId}/whois/${m.id}`, { method: 'PUT', body: { note: e.target.value } });
					m.note = res.note;
					e.target.value = res.note ?? '';
					status.textContent = 'Saved';
					setTimeout(() => { status.textContent = ''; }, 2000);
				} catch (err) { status.textContent = ''; toast(err.message, 'bad'); }
			},
		});
		const lock = h('label', { class: 'check', title: 'Locked notes can\'t be changed by the person with /aboutme' },
			h('input', {
				type: 'checkbox', checked: m.locked,
				onchange: async e => {
					try {
						const res = await api(`/guilds/${state.guildId}/whois/${m.id}`, { method: 'PUT', body: { locked: e.target.checked } });
						m.locked = res.locked;
						toast(m.locked ? `Locked ${m.displayName}'s note.` : `${m.displayName} can change their note again.`);
					} catch (err) { e.target.checked = m.locked; toast(err.message, 'bad'); }
				},
			}), '🔒 Lock');
		return h('div', { class: 'member' },
			h('img', { src: m.avatar, alt: '' }),
			h('div', {},
				h('div', { class: 'who' }, m.displayName, h('small', {}, `@${m.username}`), ' ', status),
				h('div', { class: 'row', style: { marginTop: '6px', flexWrap: 'nowrap' } }, h('div', { class: 'grow' }, input), lock),
			),
		);
	};

	const renderList = () => {
		const q = filter.toLowerCase();
		const shown = members.filter(m => !q || m.displayName.toLowerCase().includes(q) || m.username.toLowerCase().includes(q) || (m.note ?? '').toLowerCase().includes(q));
		if (!shown.length) return list.replaceChildren(h('div', { class: 'empty' }, members.length ? 'Nobody matches.' : 'No members found.'));
		const out = [];
		let group = null;
		for (const m of shown) {
			if (m.group !== group) {
				group = m.group;
				out.push(h('div', { class: 'label', style: { padding: '12px 12px 4px' } }, group));
			}
			out.push(row(m));
		}
		list.replaceChildren(...out);
	};

	(async () => {
		try {
			const res = await api(`/guilds/${state.guildId}/whois`);
			members = res.members;
			posted = res.posted;
			maxNote = res.maxNote;
			renderPost();
			renderList();
		} catch (e) { list.replaceChildren(h('div', { class: 'empty' }, e.message)); }
	})();
	renderPost();

	return [
		h('h1', {}, 'Who\'s who'),
		h('p', { class: 'lead' }, 'A list of everyone in the server, grouped by their role (the roles shown separately in the member list), with a note about each person. Names in the posted list are clickable and open their profile. Notes save when you press Enter or click away. Members can write their own with /aboutme unless you lock it.'),
		postBox,
		h('div', { class: 'card', style: { marginBottom: '16px' } }, h('input', { type: 'search', placeholder: 'Filter by name or note…', oninput: e => { filter = e.target.value.trim(); renderList(); } })),
		list,
	];
}

// ---------- view: settings ----------

function welcomeCard(which, title, about) {
	const g = state.guild;
	const cfg = { ...g.welcome[which] };
	const text = h('textarea', { rows: 3, maxLength: 2000, oninput: e => { cfg.text = e.target.value; } });
	text.value = cfg.text;
	const save = async () => {
		try {
			const res = await api(`/guilds/${state.guildId}/welcome/${which}`, { method: 'PUT', body: cfg });
			g.welcome = res.welcome;
			toast(cfg.channelId ? `${title} saved.` : `${title} turned off.`);
			return true;
		} catch (e) { toast(e.message, 'bad'); return false; }
	};
	return h('div', { class: 'card' },
		h('h2', {}, title),
		h('p', { class: 'hint' }, `${about} Placeholders: {user} (mention), {name}, {username}, {server}, {count}. Pick no channel to turn it off.`),
		h('div', { class: 'row' },
			h('div', { class: 'grow' }, channelSelect(cfg.channelId ?? '', e => { cfg.channelId = e.target.value || null; })),
			h('label', { class: 'field', style: { margin: 0 } }, h('input', { type: 'color', value: cfg.color, title: 'Embed colour', oninput: e => { cfg.color = e.target.value; } })),
		),
		h('div', { style: { margin: '10px 0' } }, text),
		h('div', { class: 'row' },
			h('button', { class: 'primary', onclick: save }, 'Save'),
			h('button', { class: 'ghost', title: 'Sends it once with the bot as the example member', onclick: async () => {
				if (!await save()) return;
				try { await api(`/guilds/${state.guildId}/welcome/${which}/test`, { method: 'POST' }); toast('Test sent. Check the channel.'); } catch (e) { toast(e.message, 'bad'); }
			} }, 'Save + send test'),
		),
	);
}

function viewSettings() {
	let choice = state.guild.autorole ?? '';
	const save = h('button', {
		class: 'primary',
		onclick: async () => {
			try {
				const res = await api(`/guilds/${state.guildId}/autorole`, { method: 'PUT', body: { roleId: choice || null } });
				state.guild.autorole = res.autorole;
				toast(res.autorole ? `New members will get ${roleById(res.autorole)?.name}.` : 'Autorole turned off.');
			} catch (e) { toast(e.message, 'bad'); }
		},
	}, 'Save');
	const g = state.guild;
	return [
		h('h1', {}, 'Settings'),
		h('p', { class: 'lead' }, `Settings for ${g.name}.`),
		permissionBanner(),
		h('div', { class: 'card' },
			h('h2', {}, 'Autorole'),
			h('p', { class: 'hint' }, 'Every new member gets this role when they join. Bots are skipped.'),
			h('div', { class: 'row' }, h('div', { class: 'grow' }, roleSelect(choice, { placeholder: 'Off', onchange: e => { choice = e.target.value; } })), save),
		),
		welcomeCard('join', 'Welcome message', 'Posted when someone joins (they get pinged).'),
		welcomeCard('leave', 'Goodbye message', 'Posted when someone leaves.'),
		(() => {
			let ch = g.modlog ?? '';
			return h('div', { class: 'card' },
				h('h2', {}, 'Mod log'),
				h('p', { class: 'hint' }, 'Logs joins (flags brand-new accounts), leaves, bans, deleted and edited messages, nickname and role changes. Make it a private staff channel.'),
				h('div', { class: 'row' },
					h('div', { class: 'grow' }, channelSelect(ch, e => { ch = e.target.value; })),
					h('button', { class: 'primary', onclick: async () => {
						try { const res = await api(`/guilds/${state.guildId}/modlog`, { method: 'PUT', body: { channelId: ch || null } }); g.modlog = res.modlog; toast(res.modlog ? `Mod log on in #${channelById(res.modlog)?.name}.` : 'Mod log off.'); } catch (e) { toast(e.message, 'bad'); }
					} }, 'Save'),
					g.modlog ? h('button', { class: 'ghost', onclick: async () => {
						try { await api(`/guilds/${state.guildId}/modlog`, { method: 'PUT', body: { channelId: null } }); g.modlog = null; toast('Mod log off.'); render(); } catch (e) { toast(e.message, 'bad'); }
					} }, 'Turn off') : null,
				),
			);
		})(),
		(() => {
			const mine = Intl.DateTimeFormat().resolvedOptions().timeZone;
			const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [mine, 'UTC'];
			let tz = g.timezone;
			const pick = h('select', { onchange: e => { tz = e.target.value; } }, [...new Set(['UTC', ...zones])].map(z => h('option', { value: z, selected: z === tz }, z)));
			return h('div', { class: 'card' },
				h('h2', {}, 'Timezone'),
				h('p', { class: 'hint' }, `Used for times you type in /event (e.g. "8pm"). Your computer is on ${mine}. Event posts show in each person's own timezone either way.`),
				h('div', { class: 'row' },
					h('div', { class: 'grow' }, pick),
					tz !== mine ? h('button', { class: 'ghost', onclick: () => { tz = mine; pick.value = mine; } }, `Use ${mine}`) : null,
					h('button', { class: 'primary', onclick: async () => {
						try { const res = await api(`/guilds/${state.guildId}/timezone`, { method: 'PUT', body: { timezone: tz } }); g.timezone = res.timezone; toast(`Timezone set to ${res.timezone}.`); } catch (e) { toast(e.message, 'bad'); }
					} }, 'Save'),
				),
			);
		})(),
		h('div', { class: 'card' },
			h('h2', {}, 'Bot status'),
			h('table', {}, h('tbody', {},
				h('tr', {}, h('td', {}, 'Logged in as'), h('td', {}, state.status.bot?.tag ?? '—')),
				h('tr', {}, h('td', {}, 'Bot\'s highest role'), h('td', {}, g.me.highestRole)),
				h('tr', {}, h('td', {}, 'Manage Roles permission'), h('td', {}, g.me.manageRoles ? 'Yes' : 'No: role features won\'t work')),
				h('tr', {}, h('td', {}, 'Members'), h('td', {}, String(g.memberCount))),
				h('tr', {}, h('td', {}, 'Text channels'), h('td', {}, String(g.channels.length))),
				h('tr', {}, h('td', {}, 'Custom emoji'), h('td', {}, String(g.emojis.length))),
			)),
		),
	];
}

// ---------- start ----------

(function start() {
	const fromHash = /(?:^|[#&])key=([^&]+)/.exec(location.hash);
	if (fromHash) {
		state.key = decodeURIComponent(fromHash[1]);
		store.set('key', state.key);
		history.replaceState(null, '', location.pathname);
	} else {
		state.key = store.get('key');
	}
	if (!state.key) return showLogin();
	boot();
}());
