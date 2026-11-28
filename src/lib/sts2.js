// Slay the Spire 2 cards and relics, pulled from the Slay the Spire wiki's Cargo tables.
// Used by /card, /relic, [[card name]] and {{relic name}}.
const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');
const { ContainerBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

const WIKI = 'https://slaythespire.wiki.gg';
const API = `${WIKI}/api.php`;
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const REFRESH_MS = 24 * 60 * 60 * 1000;
const http = axios.create({ timeout: 15000, headers: { 'User-Agent': 'silvered-bot (Discord card lookup)' } });

// Each class's card frame colour, used for the bar down the side of the message.
const COLORS = {
	Ironclad: 0xB8392C, Silent: 0x4E9A3E, Regent: 0xE08A2C, Necrobinder: 0xB0507A,
	Defect: 0x3A7FC1, Colorless: 0x8C8C8C, Fool: 0xD9B43A,
};

const CARD_VARIANTS = [
	{ key: 'base', label: 'Base', art: 'FullCard', upgraded: false },
	{ key: 'plus', label: 'Upgraded', art: 'FullCardPlus', upgraded: true },
	{ key: 'beta', label: 'Beta art', art: 'FullCardBeta', upgraded: false },
	{ key: 'betaplus', label: 'Beta art+', art: 'FullCardBetaPlus', upgraded: true },
];
const RELIC_VARIANTS = [
	{ key: 'base', label: 'Base' },
	{ key: 'beta', label: 'Beta art' },
];

// Keeps "?" so the fake relics ("Anchor???") don't collide with the real ones ("Anchor").
const normalize = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9?]/g, '');
const imageUrl = file => (file ? `${WIKI}/images/${encodeURIComponent(file.replace(/ /g, '_'))}` : null);

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

async function fetchCards() {
	const [rows, art] = await Promise.all([
		cargo('Cards', '_pageName=Page,Name,Color,Type,Rarity,NoUpgrade'),
		cargo('CardArt', 'Name,FullCard,FullCardPlus,FullCardBeta,FullCardBetaPlus'),
	]);
	const artByName = new Map(art.map(a => [a.Name, a]));
	return rows.map(r => {
		const a = artByName.get(r.Name) ?? {};
		return {
			name: r.Name,
			page: r.Page,
			color: r.Color,
			type: r.Type,
			rarity: r.Rarity,
			noUpgrade: r.NoUpgrade === '1',
			images: Object.fromEntries(CARD_VARIANTS.map(v => [v.key, imageUrl(a[v.art])])),
		};
	});
}

async function fetchRelics() {
	const rows = await cargo('Relics', '_pageName=Page,Name,Image,BetaImage,Rarity,ExclusiveTo,Description');
	return rows.map(r => ({
		name: r.Name,
		page: r.Page,
		rarity: r.Rarity,
		color: r.ExclusiveTo && r.ExclusiveTo !== 'Any' ? r.ExclusiveTo : null,
		description: cleanText(r.Description),
		images: { base: imageUrl(r.Image), beta: imageUrl(r.BetaImage) },
	}));
}

/** Turns the wiki's description markup into plain Discord text. */
function cleanText(text) {
	return String(text ?? '')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/\[\[File:[^\]]*Energy[^\]]*\]\]/gi, '⚡')
		.replace(/\[\[File:[^\]]*Star[^\]]*\]\]/gi, '⭐')
		.replace(/\[\[File:[^\]]*\]\]\s*/gi, '')
		.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
		.replace(/\[\[([^\]]*)\]\]/g, '$1')
		.replace(/\[https?:\/\/\S+ ([^\]]*)\]/g, '$1')
		.replace(/<[^>]+>/g, '')
		.replace(/'''(.*?)'''/g, '**$1**')
		.replace(/''(.*?)''/g, '*$1*')
		.replace(/&nbsp;/g, ' ')
		.replace(/[ \t]+/g, ' ')
		.replace(/ *\n */g, '\n')
		.replace(/\n{2,}/g, '\n')
		.trim();
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

/** A named list (cards or relics) that loads from the wiki, keeps a saved copy, and does fuzzy name matching. */
function collection(label, fetch) {
	const snapshot = path.join(DATA_DIR, `sts2-${label}.json`);
	let items = new Map(); // normalized name -> item

	const set = list => { items = new Map(list.map(x => [normalize(x.name), x])); };

	async function load() {
		try {
			const list = await fetch();
			set(list);
			try {
				fs.mkdirSync(DATA_DIR, { recursive: true });
				fs.writeFileSync(snapshot, JSON.stringify(list));
			} catch (e) { console.warn(`[sts2] could not save ${label} snapshot:`, e.message); }
			console.log(`[sts2] loaded ${list.length} ${label} from the wiki`);
		} catch (e) {
			console.warn(`[sts2] could not fetch ${label} from the wiki:`, e.message);
			if (!items.size && fs.existsSync(snapshot)) {
				try {
					set(JSON.parse(fs.readFileSync(snapshot, 'utf8')));
					console.log(`[sts2] using saved ${label} snapshot (${items.size})`);
				} catch (err) { console.warn(`[sts2] could not read ${label} snapshot:`, err.message); }
			}
		}
	}

	/** Items ranked by how well they match the query, best first. */
	function search(query, limit = 25) {
		const q = normalize(query);
		if (!q) return [...items.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
		const scored = [];
		for (const [key, item] of items) {
			let score;
			if (key === q) score = 0;
			else if (key.startsWith(q)) score = 1;
			else if (key.includes(q)) score = 2;
			else {
				const d = levenshtein(q, key);
				if (d > Math.max(2, Math.floor(q.length / 3))) continue;
				score = 3 + d;
			}
			scored.push({ item, score });
		}
		return scored.sort((a, b) => a.score - b.score || a.item.name.length - b.item.name.length || a.item.name.localeCompare(b.item.name))
			.slice(0, limit).map(s => s.item);
	}

	/** The single best match, or null. Typos only count when they're close (2 edits or fewer). */
	function find(query) {
		const q = normalize(query);
		if (!q) return null;
		if (items.has(q)) return items.get(q);
		if (q.length < 3) return null; // too short to guess from
		const [best] = search(query, 1);
		if (!best) return null;
		const key = normalize(best.name);
		if (key.startsWith(q) || key.includes(q) || levenshtein(q, key) <= 2) return best;
		return null;
	}

	/** Exact lookup by name, for button presses. */
	const get = name => items.get(normalize(name)) ?? null;

	return { load, search, find, get };
}

const cards = collection('cards', fetchCards);
const relics = collection('relics', fetchRelics);

let refreshTimer = null;
/** Loads cards and relics (falling back to saved copies if the wiki is down) and refreshes them daily. */
async function loadAll() {
	if (!refreshTimer) {
		refreshTimer = setInterval(() => loadAll().catch(() => {}), REFRESH_MS);
		refreshTimer.unref();
	}
	await Promise.all([cards.load(), relics.load()]);
}

// --- Messages -----------------------------------------------------------

function variantButtons(prefix, name, options, current) {
	return new ActionRowBuilder().addComponents(options.map(v => new ButtonBuilder()
		.setCustomId(`${prefix}:${v.key}:${name}`.slice(0, 100))
		.setLabel(v.label)
		.setStyle(v.key === current ? ButtonStyle.Primary : ButtonStyle.Secondary)
		.setDisabled(v.key === current)));
}

const cardVariants = card => CARD_VARIANTS.filter(v => card.images[v.key] && !(v.upgraded && card.noUpgrade));

/** A card: just the card art, with buttons to switch versions. */
function buildCardMessage(card, variantKey = 'base') {
	const options = cardVariants(card);
	const variant = options.find(v => v.key === variantKey) ?? options[0] ?? CARD_VARIANTS[0];

	const container = new ContainerBuilder().setAccentColor(COLORS[card.color] ?? COLORS.Colorless);
	if (card.images[variant.key]) {
		container.addMediaGalleryComponents(g => g.addItems(i => i.setURL(card.images[variant.key]).setDescription(`${card.name} (${variant.label})`)));
	} else {
		container.addTextDisplayComponents(t => t.setContent(`**${card.name}** (no image on the wiki yet)`));
	}
	if (options.length > 1) container.addActionRowComponents(variantButtons('sts2', card.name, options, variant.key));
	return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/** A relic: what it does in small text, with the icon as a thumbnail on the right, and a Beta art button if it has one. */
function buildRelicMessage(relic, variantKey = 'base') {
	const options = RELIC_VARIANTS.filter(v => relic.images[v.key]);
	const variant = options.find(v => v.key === variantKey) ?? options[0] ?? RELIC_VARIANTS[0];
	const effect = (relic.description || 'No description on the wiki yet.').split('\n').map(line => `-# ${line}`).join('\n');

	const embed = new EmbedBuilder()
		.setColor(COLORS[relic.color] ?? COLORS.Colorless)
		.setDescription(effect.slice(0, 4096));
	if (relic.images[variant.key]) embed.setThumbnail(relic.images[variant.key]);
	const components = options.length > 1 ? [variantButtons('sts2r', relic.name, options, variant.key)] : [];
	return { embeds: [embed], components };
}

module.exports = {
	loadAll, normalize,
	findCard: cards.find, searchCards: cards.search, getCard: cards.get, buildCardMessage,
	findRelic: relics.find, searchRelics: relics.search, getRelic: relics.get, buildRelicMessage,
};
