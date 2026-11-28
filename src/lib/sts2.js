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

// Each class's card frame colour, used for the bar down the side of the card message.
const COLORS = {
	Ironclad: 0xB8392C, Silent: 0x4E9A3E, Regent: 0xE08A2C, Necrobinder: 0xB0507A,
	Defect: 0x3A7FC1, Colorless: 0x8C8C8C, Fool: 0xD9B43A,
};

const VARIANTS = [
	{ key: 'base', label: 'Base', art: 'FullCard', upgraded: false },
	{ key: 'plus', label: 'Upgraded', art: 'FullCardPlus', upgraded: true },
	{ key: 'beta', label: 'Beta art', art: 'FullCardBeta', upgraded: false },
	{ key: 'betaplus', label: 'Beta art+', art: 'FullCardBetaPlus', upgraded: true },
];

let cards = new Map(); // normalized name -> card
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

// --- Message building ---------------------------------------------------

function variants(card) {
	return VARIANTS.filter(v => card.images[v.key] && !(v.upgraded && card.noUpgrade));
}

/** The message for one card: just the card art, with buttons to switch versions. */
async function buildCardMessage(card, variantKey = 'base') {
	const options = variants(card);
	const variant = options.find(v => v.key === variantKey) ?? options[0] ?? VARIANTS[0];

	const container = new ContainerBuilder().setAccentColor(COLORS[card.color] ?? COLORS.Colorless);
	if (card.images[variant.key]) {
		container.addMediaGalleryComponents(g => g.addItems(i => i.setURL(card.images[variant.key]).setDescription(`${card.name} (${variant.label})`)));
	} else {
		container.addTextDisplayComponents(t => t.setContent(`**${card.name}** (no image on the wiki yet)`));
	}
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

module.exports = { loadCards, findCard, searchCards, getCard, variants, buildCardMessage, normalize };
