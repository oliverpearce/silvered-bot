// Shared embed building/checking, used by the dashboard and /embed so both follow the same rules.
const { EmbedBuilder } = require('discord.js');

class EmbedError extends Error {}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function parseColor(v) {
	if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xFFFFFF) return v;
	if (typeof v === 'string' && /^#?[0-9a-f]{6}$/i.test(v.trim())) return parseInt(v.trim().replace('#', ''), 16);
	return null;
}

const hex = n => `#${(n ?? 0).toString(16).padStart(6, '0')}`;

const URL_FIELDS = [
	['Title link', e => e.url], ['Author icon', e => e.author?.iconURL], ['Author link', e => e.author?.url],
	['Thumbnail', e => e.thumbnail], ['Image', e => e.image], ['Footer icon', e => e.footer?.iconURL],
];

/**
 * Builds and checks an embed from a plain "draft" object (the dashboard's form shape).
 * Returns null if the embed is empty. Throws EmbedError with a readable message if something's wrong.
 */
function buildEmbed(e) {
	if (!e || typeof e !== 'object') return null;
	for (const [label, pick] of URL_FIELDS) {
		const v = str(pick(e), 2000);
		if (v && !/^https?:\/\/[^\s]+$/i.test(v)) throw new EmbedError(`${label} isn't a valid link. It has to start with https:// (for images, right-click the image → Copy Image Link).`);
	}
	const embed = new EmbedBuilder();
	let used = false;
	const set = (value, fn) => { if (value) { fn(value); used = true; } };

	set(str(e.title, 256), v => embed.setTitle(v));
	set(str(e.url, 2000), v => embed.setURL(v));
	set(str(e.description, 4096), v => embed.setDescription(v));
	const color = parseColor(e.color);
	if (color !== null) embed.setColor(color);
	set(str(e.author?.name, 256), v => embed.setAuthor({ name: v, iconURL: str(e.author?.iconURL, 2000) || undefined, url: str(e.author?.url, 2000) || undefined }));
	set(str(e.thumbnail, 2000), v => embed.setThumbnail(v));
	set(str(e.image, 2000), v => embed.setImage(v));
	set(str(e.footer?.text, 2048), v => embed.setFooter({ text: v, iconURL: str(e.footer?.iconURL, 2000) || undefined }));
	if (e.timestamp) embed.setTimestamp(typeof e.timestamp === 'string' && !Number.isNaN(Date.parse(e.timestamp)) ? new Date(e.timestamp) : new Date());
	const fields = (Array.isArray(e.fields) ? e.fields : [])
		.map(f => ({ name: str(f?.name, 256), value: str(f?.value, 1024), inline: Boolean(f?.inline) }))
		.filter(f => f.name || f.value)
		.slice(0, 25)
		.map(f => ({ name: f.name || '​', value: f.value || '​', inline: f.inline }));
	if (fields.length) { embed.addFields(fields); used = true; }

	if (!used) return null;
	if (embed.length > 6000) throw new EmbedError('The embed is over Discord\'s 6000 character limit.');
	return embed;
}

/** Turns an embed from a Discord message back into a draft object, so it can be edited. */
function embedToDraft(embed) {
	const d = embed?.data ?? embed ?? {};
	return {
		title: d.title ?? '',
		url: d.url ?? '',
		description: d.description ?? '',
		color: typeof d.color === 'number' ? hex(d.color) : '#ff69b4',
		author: { name: d.author?.name ?? '', iconURL: d.author?.icon_url ?? '', url: d.author?.url ?? '' },
		thumbnail: d.thumbnail?.url ?? '',
		image: d.image?.url ?? '',
		footer: { text: d.footer?.text ?? '', iconURL: d.footer?.icon_url ?? '' },
		// Keep the original time when re-saving instead of bumping it to "now".
		timestamp: d.timestamp ?? false,
		fields: (d.fields ?? []).map(f => ({ name: f.name === '​' ? '' : f.name, value: f.value === '​' ? '' : f.value, inline: Boolean(f.inline) })),
	};
}

module.exports = { EmbedError, str, parseColor, hex, buildEmbed, embedToDraft };
