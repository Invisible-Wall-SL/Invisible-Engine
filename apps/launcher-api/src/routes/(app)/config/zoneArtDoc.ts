import {
	SALMONS_ART_GENERATORS,
	SALMONS_DRAWN_ZONE_FAMILIES,
	SALMONS_PROJECT_SHEETS,
	salmonsProjectSheetOf,
	ZONE_ART_LIMITS,
	normalizeZoneArt,
	zoneFamilyOf,
	type GameConfigDoc,
	type ZoneArt,
	type ZoneArtSource,
} from 'game-config';

import { SALMONS_BUILT_IN_ZONE_ART, type SalmonsCodeDrawn } from './zoneArtBuiltIn';
import { countBy } from './zones';

/**
 * What `/config`'s ZONE ART card shows and writes (`arcade.zoneArt`, `docs/design/zone-art.md`):
 * one row per zone family of the zones the game plays (the config's own, or the level a seed
 * makes), and the edits of an entry. Every write goes through `game-config` `normalizeZoneArt`, so
 * what is stored is what the runtime reads; an edit that leaves nothing usable removes the entry.
 * Pure, so `check:zone-art` runs it on the real modules.
 */

export type ZoneArtRow = {
	family: string;
	/** How many zones of the family the shown level has; 0 for an entry no zone has. */
	count: number;
	/** A family a generator makes for its rules only (an invisible wall), which nothing draws. */
	ruleOnly: boolean;
	art: ZoneArt | undefined;
};

/** The families a generator's own art draws, or `undefined` when every family may be drawn. */
const drawnFamilies = (generator: string | undefined): readonly string[] | undefined =>
	generator && SALMONS_ART_GENERATORS.includes(generator) ? SALMONS_DRAWN_ZONE_FAMILIES : undefined;

/** The card's rows: the zones' families, most first, then an entry no zone has (it draws
 *  nothing, and is kept to be removed or for another level). */
export function zoneArtRows(
	zones: readonly { id: string }[],
	doc: GameConfigDoc,
	generator: string | undefined,
): ZoneArtRow[] {
	const map = doc.arcade?.zoneArt ?? {};
	const drawn = drawnFamilies(generator);
	const rows: ZoneArtRow[] = countBy(zones.map((z) => zoneFamilyOf(z.id))).map((g) => ({
		family: g.label,
		count: g.count,
		ruleOnly: !!drawn && !drawn.includes(g.label),
		art: map[g.label],
	}));
	for (const [family, art] of Object.entries(map))
		if (!rows.some((r) => r.family === family))
			rows.push({ family, count: 0, ruleOnly: false, art });
	return rows;
}

/** The rows the card lists: rule-only families only when asked, or when they have art. */
export const shownZoneArtRows = (rows: readonly ZoneArtRow[], ruleOnly: boolean): ZoneArtRow[] =>
	rows.filter((r) => ruleOnly || !r.ruleOnly || r.art);

/** Store `map` as the config's zone art, normalized; none left ⇒ the field goes. */
function store(doc: GameConfigDoc, map: Record<string, unknown>): void {
	const next = normalizeZoneArt(map);
	if (next) {
		doc.arcade ??= {};
		doc.arcade.zoneArt = next;
	} else if (doc.arcade) {
		delete doc.arcade.zoneArt;
		if (!Object.keys(doc.arcade).length) delete doc.arcade;
	}
}

const copy = (doc: GameConfigDoc): Record<string, ZoneArt> =>
	structuredClone(doc.arcade?.zoneArt ?? {});

/**
 * Set picture `index` of a family (0 its source, 1… its variants) to `source`. A family with no
 * entry is given one, stamped. `undefined` clears it: a variant goes; the source goes with the
 * entry when there is no variant, else the first variant takes its place.
 */
export function setZoneArtSource(
	doc: GameConfigDoc,
	family: string,
	index: number,
	source: ZoneArtSource | undefined,
): void {
	const map = copy(doc);
	const art = map[family];
	if (!art) {
		if (source && index === 0) map[family] = { source, placement: 'stamp' };
		return store(doc, map);
	}
	const pool = [art.source, ...(art.variants ?? [])];
	if (index < 0 || index > pool.length) return;
	if (source) pool[index] = source;
	else pool.splice(index, 1);
	const [first, ...rest] = pool;
	if (!first) delete map[family];
	else {
		art.source = first;
		if (rest.length) art.variants = rest.slice(0, ZONE_ART_LIMITS.variants);
		else delete art.variants;
	}
	store(doc, map);
}

/** Add a variant, a copy of the source to be changed; refused past the limit. */
export function addZoneArtVariant(doc: GameConfigDoc, family: string): boolean {
	const map = copy(doc);
	const art = map[family];
	if (!art || (art.variants?.length ?? 0) >= ZONE_ART_LIMITS.variants) return false;
	art.variants = [...(art.variants ?? []), structuredClone(art.source)];
	store(doc, map);
	return true;
}

/** The fitted size's factor; blank or out of range ⇒ 1. */
export function setZoneArtScale(doc: GameConfigDoc, family: string, value: string): void {
	const map = copy(doc);
	const art = map[family];
	if (!art) return;
	const n = Number(value);
	const { min, max } = ZONE_ART_LIMITS.scale;
	if (value.trim() !== '' && Number.isFinite(n) && n >= min && n <= max) art.scale = n;
	else delete art.scale;
	store(doc, map);
}

export function removeZoneArt(doc: GameConfigDoc, family: string): void {
	const map = copy(doc);
	delete map[family];
	store(doc, map);
}

/** A clip's first frame as a scoped ref (`<sheet>::<frame>`), for its thumbnail. */
export function clipThumbRef(clip: { assetKey: string; firstFrame: string } | undefined): string {
	if (!clip?.firstFrame) return '';
	return clip.firstFrame.includes('::') ? clip.firstFrame : `${clip.assetKey}::${clip.firstFrame}`;
}

/** What a family with no zone art draws today: a line for it, and its pictures as scoped refs. */
export { SALMONS_BUILT_IN_ZONE_ART };

export type ZoneArtDefault = { label: string; thumbs: string[]; drawn?: SalmonsCodeDrawn };

/**
 * What `family` draws with no entry: Salmons' built-in art for a Salmons generator (its pictures
 * from the project's copy of the sheet, none when the project has no such sheet), else nothing. A
 * rule-only family (an invisible wall or area) says so.
 */
export function zoneArtDefault(
	family: string,
	generator: string | undefined,
	sheets: readonly { key: string }[],
	ruleOnly = false,
): ZoneArtDefault {
	if (ruleOnly) return { label: 'Invisible (rules only)', thumbs: [] };
	const builtIn =
		generator && SALMONS_ART_GENERATORS.includes(generator)
			? SALMONS_BUILT_IN_ZONE_ART[family]
			: undefined;
	if (!builtIn) return { label: 'Nothing drawn', thumbs: [] };
	const keyOf = new Map(
		sheets.flatMap((s) => {
			const sheet = salmonsProjectSheetOf(s.key);
			return sheet ? [[sheet, s.key] as const] : [];
		}),
	);
	const thumbs = builtIn.pictures.flatMap(([sheet, region]) => {
		const key = keyOf.get(SALMONS_PROJECT_SHEETS[sheet]);
		return key ? [`${key}::${region}`] : [];
	});
	return builtIn.drawn
		? { label: builtIn.label, thumbs, drawn: builtIn.drawn }
		: { label: builtIn.label, thumbs };
}
