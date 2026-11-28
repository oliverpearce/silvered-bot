// Slay the Spire 2 card data, pulled from the Slay the Spire wiki's Cargo tables.
// Used by /card and the [[card name]] message lookup.
const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');
const { ContainerBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

const WIKI = 'https://slaythespire.wiki.gg';
const API = `${WIKI}/api.php`;
const SNAPSHOT = path.join(__dirname, '..', '..', 'data', 'sts2-cards.json');
const REFRESH_MS = 24 * 60 * 60 * 1000;
const http = axios.create({ timeout: 15000, headers: { 'User-Agent': 'silvered-bot (Discord card lookup)' } });

const CARD_FIELDS = '_pageName=Page,Name,Color,Type,Rarity,Cost,CostPlus,StarCost,Description,NoUpgrade,HasBeta';
const ART_FIELDS = 'Name,FullCard,FullCardPlus,FullCardBeta,FullCardBetaPlus';

const COLORS = {
	Ironclad: 0xC0392B, Silent: 0x27AE60, Regent: 0xE67E22, Necrobinder: 0x9B59B6,
	Defect: 0x3498DB, Colorless: 0x95A5A6, Fool: 0xF1C40F,
};

const VARIANTS = [
	{ key: 'base', label: 'Base', art: 'FullCard', upgraded: false },
	{ key: 'plus', label: 'Upgraded', art: 'FullCardPlus', upgraded: true },
	{ key: 'beta', label: 'Beta art', art: 'FullCardBeta', upgraded: false },
	{ key: 'betaplus', label: 'Beta art+', art: 'FullCardBetaPlus', upgraded: true },
];

let cards = new Map(); // normalized name -> card
const sourceCache = new Map();
let refreshTimer = null;

const normalize = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

async function cargo(table, fields) {
	const rows = [];
	for (let offset = 0; ; offset += 500) {
		const { data } = await http.get(API, {
			params: { action: 'cargoquery', tables: table, fields, where: 'Game="2"', limit: 500, offset, format: 'json' },
		});
		if (data.error) throw new Error(`${table}: ${data.error.info}`);
		const page = (data.cargoquery ?? []).map(r => r.title);
		rows.push(...page);
		if (page.length < 500) return rows;
	}
}

const imageUrl = file => (file ? `${WIKI}/images/${encodeURIComponent(file.replace(/ /g, '_'))}` : null);

function setCards(list) {
	const next = new Map();
	for (const c of list) next.set(normalize(c.name), c);
	cards = next;
}

async function fetchCards() {
	const [rows, art] = await Promise.all([cargo('Cards', CARD_FIELDS), cargo('CardArt', ART_FIELDS)]);
	const artByName = new Map(art.map(a => [a.Name, a]));
	return rows.map(r => {
		const a = artByName.get(r.Name) ?? {};
		return {
			name: r.Name,
			page: r.Page,
			color: r.Color,
			type: r.Type,
			rarity: r.Rarity,
			cost: r.Cost === '' ? null : Number(r.Cost),
			costPlus: r.CostPlus === '' ? null : Number(r.CostPlus),
			starCost: r.StarCost === '' ? null : Number(r.StarCost),
			description: r.Description ?? '',
			noUpgrade: r.NoUpgrade === '1',
			images: Object.fromEntries(VARIANTS.map(v => [v.key, imageUrl(a[v.art])])),
		};
	});
}

/** Loads the card list (falls back to the last saved copy if the wiki is down) and refreshes it daily. */
async function loadCards() {
	if (!refreshTimer) {
		refreshTimer = setInterval(() => loadCards().catch(() => {}), REFRESH_MS);
		refreshTimer.unref();
	}
	try {
		const list = await fetchCards();
		setCards(list);
		sourceCache.clear();
		try {
			fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
			fs.writeFileSync(SNAPSHOT, JSON.stringify(list));
		} catch (e) { console.warn('[sts2] could not save card snapshot:', e.message); }
		console.log(`[sts2] loaded ${list.length} cards from the wiki`);
	} catch (e) {
		console.warn('[sts2] could not fetch cards from the wiki:', e.message);
		if (!cards.size && fs.existsSync(SNAPSHOT)) {
			try {
				setCards(JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')));
				console.log(`[sts2] using saved snapshot (${cards.size} cards)`);
			} catch (err) { console.warn('[sts2] could not read snapshot:', err.message); }
		}
	}
	return cards.size;
}

function levenshtein(a, b) {
	const row = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		let prev = row[0];
		row[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const tmp = row[j];
			row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
			prev = tmp;
		}
	}
	return row[b.length];
}

/** Cards ranked by how well they match the query, best first. */
function searchCards(query, limit = 25) {
	const q = normalize(query);
	const all = [...cards.values()];
	if (!q) return all.sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
	const scored = [];
	for (const [key, card] of cards) {
		let score;
		if (key === q) score = 0;
		else if (key.startsWith(q)) score = 1;
		else if (key.includes(q)) score = 2;
		else {
			const d = levenshtein(q, key);
			if (d > Math.max(2, Math.floor(q.length / 3))) continue;
			score = 3 + d;
		}
		scored.push({ card, score });
	}
	return scored.sort((a, b) => a.score - b.score || a.card.name.length - b.card.name.length || a.card.name.localeCompare(b.card.name))
		.slice(0, limit).map(s => s.card);
}

/** The single best match, or null. Typos only count when they're close (2 edits or fewer). */
function findCard(query) {
	const q = normalize(query);
	if (!q) return null;
	if (cards.has(q)) return cards.get(q);
	if (q.length < 3) return null; // too short to guess from
	const [best] = searchCards(query, 1);
	if (!best) return null;
	const key = normalize(best.name);
	if (key.startsWith(q) || key.includes(q) || levenshtein(q, key) <= 2) return best;
	return null;
}

// --- Text cleanup -------------------------------------------------------

/** Turns a bit of raw wikitext (the "Obtaining" section) into readable Discord text. */
function cleanWikitext(text) {
	let s = text;
	// Templates like {{C2|Name}}, {{R2|Name|Shown}}, {{StS2|Page|Shown}}, {{KW|Enchant|Enchanted|2}}.
	for (let n = 0; n < 5 && /\{\{/.test(s); n++) {
		s = s.replace(/\{\{([^{}]*)\}\}/g, (_, inner) => {
			const [name, ...args] = inner.split('|').map(x => x.trim());
			const t = name.toLowerCase();
			if (/^icon2?$/.test(t)) return /e$/i.test(args[0] ?? '') ? '⚡' : '';
			if (t === 'stars2' || t === 'star2') return '⭐';
			const named = args.filter(a => !a.includes('=') && !/^\d+$/.test(a));
			if (!named.length) return '';
			if (t === 'querylink2') return named[named.length - 1];
			if (t === 'sts2' || t === 'kw') return named[1] ?? named[0];
			return `**${named[1] ?? named[0]}**`;
		});
	}
	s = s.replace(/\[\[File:[^\]]*\]\]/gi, '')
		.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
		.replace(/\[\[([^\]]*)\]\]/g, '$1')
		.replace(/\[https?:\/\/\S+ ([^\]]*)\]/g, '$1')
		.replace(/<[^>]+>/g, '')
		.replace(/'''(.*?)'''/g, '**$1**')
		.replace(/''(.*?)''/g, '*$1*')
		.replace(/\*{4,}/g, '**')
		.replace(/^\*\*(?=[^*])/gm, '  - ') // nested list bullets
		.replace(/^\*(?=\s|[^*])/gm, '- ')
		.replace(/^-\s+/gm, '- ')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n{2,}/g, '\n');
	return s.trim();
}

const RARITY_SOURCE = {
	Basic: 'Starter deck card.',
	Common: 'Card rewards after combat and the shop.',
	Uncommon: 'Card rewards after combat and the shop.',
	Rare: 'Card rewards (more likely from elites and bosses) and the shop.',
	Event: 'Event card: only from an event, not from normal card rewards.',
	Ancient: 'Ancient card: given by an Ancient, not from normal card rewards.',
	Token: 'Created by other cards, relics or effects during a run.',
	Curse: 'Curse: added to your deck by events, relics or enemies.',
	Status: 'Status: added to your deck during combat, usually by enemies.',
	Quest: 'Quest card: given by an event or effect as part of a quest.',
	Special: 'Special card: obtained through a specific effect.',
};

/** The lines under "== Obtaining ... ==", up to the next top-level "== ... ==" heading. */
function obtainingSection(wikitext) {
	const lines = wikitext.split('\n');
	const start = lines.findIndex(l => /^==\s*Obtaining\b/i.test(l.trim()));
	if (start === -1) return '';
	const out = [];
	for (const line of lines.slice(start + 1)) {
		if (/^==[^=]/.test(line.trim())) break;
		if (/^(\|-\||<tabber|\{\|)/i.test(line.trim())) break; // tabs/tables: stop at the readable part
		if (/^===/.test(line.trim())) continue; // sub-headings
		out.push(line);
	}
	return out.join('\n');
}

const pageTitle = card => card.page || `Slay the Spire 2:${card.name}`;
const pageUrl = card => `${WIKI}/wiki/${encodeURIComponent(pageTitle(card).replace(/ /g, '_')).replace(/%3A/g, ':')}`;

/** "How to get it" text: the rarity rule, plus the wiki's "Obtaining" section when it has one. */
async function getSource(card) {
	if (sourceCache.has(card.name)) return sourceCache.get(card.name);
	const base = RARITY_SOURCE[card.rarity] ?? '';
	let detail = '';
	try {
		const { data } = await http.get(`${WIKI}/index.php`, { params: { title: pageTitle(card), action: 'raw' }, responseType: 'text' });
		detail = cleanWikitext(obtainingSection(String(data)));
	} catch (e) {
		console.warn(`[sts2] could not fetch the page for ${card.name}:`, e.message);
		return base || 'Unknown.'; // don't cache, try again next time
	}
	if (detail.length > 700) detail = `${detail.slice(0, 700).replace(/\s+\S*$/, '')}…`;
	const text = [base, detail].filter(Boolean).join('\n') || 'Unknown.';
	sourceCache.set(card.name, text);
	return text;
}

// --- Message building ---------------------------------------------------

function variants(card) {
	return VARIANTS.filter(v => card.images[v.key] && !(v.upgraded && card.noUpgrade));
}

/** The message for one card: name (class), the card art, then how to get it, with buttons to switch art. */
async function buildCardMessage(card, variantKey = 'base') {
	const options = variants(card);
	const variant = options.find(v => v.key === variantKey) ?? options[0] ?? VARIANTS[0];
	const source = await getSource(card);

	const container = new ContainerBuilder()
		.setAccentColor(COLORS[card.color] ?? 0x95A5A6)
		.addTextDisplayComponents(t => t.setContent(`### [${card.name}${variant.upgraded ? '+' : ''} (${card.color})](${pageUrl(card)})`));
	if (card.images[variant.key]) {
		container.addMediaGalleryComponents(g => g.addItems(i => i.setURL(card.images[variant.key]).setDescription(`${card.name} (${variant.label})`)));
	}
	container.addTextDisplayComponents(t => t.setContent(`**How to get it**\n${source.slice(0, 3500)}\n-# ${variant.label} · Data: Slay the Spire Wiki (CC BY-SA)`));
	if (options.length > 1) {
		container.addActionRowComponents(new ActionRowBuilder().addComponents(options.map(v => new ButtonBuilder()
			.setCustomId(`sts2:${v.key}:${card.name}`.slice(0, 100))
			.setLabel(v.label)
			.setStyle(v.key === variant.key ? ButtonStyle.Primary : ButtonStyle.Secondary)
			.setDisabled(v.key === variant.key))));
	}
	return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/** Exact lookup by name, for button presses. */
const getCard = name => cards.get(normalize(name)) ?? null;

module.exports = { loadCards, findCard, searchCards, getCard, cleanWikitext, getSource, variants, buildCardMessage, normalize };
