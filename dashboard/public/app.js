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

function modal({ title, text, confirm = 'OK', danger = false, checkbox }) {
	return new Promise(resolve => {
		const box = checkbox ? h('input', { type: 'checkbox', checked: Boolean(checkbox.checked) }) : null;
		const close = val => { overlay.remove(); resolve(val); };
		const overlay = h('div', { class: 'overlay', onclick: e => { if (e.target === overlay) close(null); } },
			h('div', { class: 'card modal', role: 'dialog', 'aria-modal': 'true' },
				h('h2', {}, title),
				text ? h('p', {}, text) : null,
				checkbox ? h('label', { class: 'check' }, box, checkbox.label) : null,
				h('div', { class: 'row' },
					h('button', { class: 'ghost', onclick: () => close(null) }, 'Cancel'),
					h('button', { class: danger ? 'danger' : 'primary', onclick: () => close({ checked: box?.checked ?? false }) }, confirm),
				),
			),
		);
		document.body.append(overlay);
		overlay.querySelector('button.danger, button.primary').focus();
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
	if (res.status === 401) { showLogin('That key didn\'t work. Copy the newest one from the bot\'s console.'); throw new Error('Locked'); }
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
	const views = { send: viewSend, menus: viewMenus, roles: viewRoles, members: viewMembers, settings: viewSettings };
	const el = (views[state.view] ?? viewSend)();
	$('#view').replaceChildren(...[].concat(el).filter(Boolean));
}

function permissionBanner() {
	const me = state.guild.me;
	if (me.manageRoles) return null;
	return h('div', { class: 'banner' }, 'The bot doesn\'t have the Manage Roles permission in this server, so it can\'t give out or edit roles. Give its role Manage Roles (or Administrator) in Server Settings → Roles.');
}

// ---------- Discord-style markdown for the preview ----------

function escapeHtml(s) {
	return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function markdown(text, { block = true } = {}) {
	if (!text) return '';
	const stash = [];
	const keep = html => `\u0000${stash.push(html) - 1}\u0000`;
	let s = escapeHtml(text);

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
	const m = /^<(a?):(\w+):(\d{17,20})>$/.exec(text ?? '');
	if (m) return h('img', { src: `https://cdn.discordapp.com/emojis/${m[3]}.${m[1] ? 'gif' : 'webp'}?size=48`, alt: m[2] });
	return text ? document.createTextNode(text) : null;
}

// ---------- view: send message ----------

const DEFAULT_DRAFT = () => ({
	channelId: '',
	content: '',
	embedOn: true,
	embed: { title: '', url: '', description: '', color: '#ff69b4', author: { name: '', iconURL: '' }, thumbnail: '', image: '', footer: { text: '', iconURL: '' }, timestamp: false, fields: [] },
	menuOn: false,
	menu: { mode: 'reactions', unique: false, items: [] },
	allowMentions: false,
});

let draft = Object.assign(DEFAULT_DRAFT(), store.get('draft', {}));
const saveDraft = debounce(() => store.set('draft', draft), 300);

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
			h('p', { class: 'hint' }, reactions
				? 'People react with the emoji to get the role, and remove their reaction to lose it. Up to 20 roles.'
				: 'People click a button to get the role, and click again to remove it. Emoji are optional. Up to 25 roles.'),
			...m.items.map((it, i) => h('div', { class: `menu-item ${reactions ? 'reactions' : ''}` },
				roleSelect(it.roleId, { onchange: e => { it.roleId = e.target.value; update(); } }),
				emojiField(it.emoji, v => { it.emoji = v; update(); }),
				reactions ? null : h('input', { type: 'text', placeholder: 'Button label (default: role name)', value: it.label ?? '', maxLength: 80, oninput: e => { it.label = e.target.value; update(); } }),
				h('button', { type: 'button', class: 'danger small', onclick: () => { m.items.splice(i, 1); renderMenu(); update(); } }, '✕'),
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

	const sendBtn = h('button', { class: 'primary', onclick: () => sendMessage(sendBtn) }, 'Send to Discord');

	const form = h('div', {},
		h('div', { class: 'card' },
			h('label', { class: 'field' }, h('span', { class: 'label' }, 'Channel'), channelSelect(draft.channelId, e => { draft.channelId = e.target.value; saveDraft(); })),
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
				h('button', { class: 'ghost', onclick: async () => { if (await modal({ title: 'Clear the form?', text: 'This empties every box.', confirm: 'Clear', danger: true })) { draft = DEFAULT_DRAFT(); store.set('draft', draft); render(); } } }, 'Clear form'),
			),
		),
	);

	update();
	return [
		h('h1', {}, 'Send a message'),
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

async function sendMessage(btn) {
	if (!draft.channelId) return toast('Pick a channel first.', 'warn');
	const items = draft.menuOn ? draft.menu.items.filter(i => i.roleId) : [];
	if (draft.menuOn && draft.menu.items.length && !items.length) return toast('Pick a role for each menu row (or close the Role menu section).', 'warn');
	const body = {
		channelId: draft.channelId,
		content: draft.content,
		embed: draft.embedOn ? draft.embed : null,
		menu: items.length ? { mode: draft.menu.mode, unique: draft.menu.unique, items } : null,
		allowMentions: draft.allowMentions,
	};
	btn.disabled = true;
	btn.textContent = 'Sending…';
	try {
		const res = await api(`/guilds/${state.guildId}/messages`, { method: 'POST', body });
		toast(items.length ? 'Role menu posted!' : 'Message sent!', 'ok', { href: res.url, text: 'Open in Discord' });
		if (res.warning) toast(res.warning, 'warn');
	} catch (e) {
		if (e.message !== 'Locked') toast(e.message, 'bad');
	} finally {
		btn.disabled = false;
		btn.textContent = 'Send to Discord';
	}
}

// ---------- view: role menus ----------

function viewMenus() {
	const body = h('div', { class: 'card' }, h('div', { class: 'empty' }, 'Loading…'));
	const load = async () => {
		let menus;
		try { menus = await api(`/guilds/${state.guildId}/menus`); } catch (e) { body.replaceChildren(h('div', { class: 'empty' }, e.message)); return; }
		if (!menus.length) {
			body.replaceChildren(h('div', { class: 'empty' }, 'No role menus yet. Make one from Send message → Role menu.'));
			return;
		}
		body.replaceChildren(h('table', {},
			h('thead', {}, h('tr', {}, h('th', {}, 'Menu'), h('th', {}, 'Channel'), h('th', {}, 'Type'), h('th', {}, 'Roles'), h('th', {}, ''))),
			h('tbody', {}, menus.map(m => h('tr', {},
				h('td', {}, h('div', { style: { fontWeight: 600 } }, m.title), h('div', { class: 'hint' }, m.createdAt ? new Date(m.createdAt).toLocaleString() : '')),
				h('td', {}, m.channelName ? `#${m.channelName}` : h('span', { class: 'badge warn' }, 'channel deleted')),
				h('td', {}, m.mode === 'reactions' ? 'Reactions' : 'Buttons', m.unique ? h('div', { class: 'hint' }, 'pick one') : null),
				h('td', {}, h('div', { class: 'chips' }, m.items.map(i => {
					const r = roleById(i.roleId);
					return h('span', { class: 'chip' }, emojiPreview(i.emoji), h('span', { class: 'dot', style: { background: roleColor(r) } }), r?.name ?? 'deleted role');
				}))),
				h('td', {}, h('div', { class: 'row', style: { justifyContent: 'flex-end', flexWrap: 'nowrap' } },
					h('a', { href: m.url, target: '_blank', rel: 'noreferrer' }, 'Open'),
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
								load();
							} catch (e) { toast(e.message, 'bad'); }
						},
					}, 'Delete'),
				)),
			))),
		));
	};
	load();
	return [
		h('h1', {}, 'Role menus'),
		h('p', { class: 'lead' }, 'Menus you posted from this dashboard. Menus made with /rolemenu in Discord work too, but only show up here if made from the dashboard.'),
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

// ---------- view: settings ----------

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
