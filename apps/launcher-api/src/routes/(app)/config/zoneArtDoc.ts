import {
	SALMONS_ART_GENERATORS,
	SALMONS_DRAWN_ZONE_FAMILIES,
	SALMONS_PROJECT_SHEETS,
	salmonsProjectSheetOf,
	ZONE_ART_LIMITS,
	ZONE_ART_SCENERY,
	isZoneArtScenery,
	normalizeZoneArt,
	zoneFamilyOf,
	type GameConfigDoc,
	type ZoneArt,
	type ZoneArtRig,
	type ZoneArtScenery,
	type ZoneArtSource,
} from 'game-config';

import { SALMONS_BUILT_IN_ZONE_ART, type SalmonsCodeDrawn } from './zoneArtBuiltIn';
import { countBy } from './zones';

/**
 * What `/config`'s ZONE ART card shows and writes (`arcade.zoneArt`, `docs/design/zone-art.md`):
 * one row per zone family of the zones the game plays (the config's own, or the level a seed
 * makes), one per piece of scenery its art places (`game-config` `ZONE_ART_SCENERY`), and the
 * edits of an entry, a family's or a scenery key's alike. Every write goes through `game-config`
 * `normalizeZoneArt`, so what is stored is what the runtime reads; an edit that leaves nothing
 * usable removes the entry. Pure, so `check:zone-art` runs it on the real modules.
 */

export type ZoneArtRow = {
	family: string;
	/** How many zones of the family the shown level has; 0 for an entry no zone has. */
	count: number;
	/** A family a generator makes for its rules only (an invisible wall), which nothing draws. */
	ruleOnly: boolean;
	art: ZoneArt | undefined;
};

/** Whether a generator's rooms are drawn in Salmons' art, the one art that draws scenery. */
const drawnInSalmonsArt = (generator: string | undefined): boolean =>
	!!generator && SALMONS_ART_GENERATORS.includes(generator);

/** The families a generator's own art draws, or `undefined` when every family may be drawn. */
const drawnFamilies = (generator: string | undefined): readonly string[] | undefined =>
	drawnInSalmonsArt(generator) ? SALMONS_DRAWN_ZONE_FAMILIES : undefined;

/** The card's rows: the zones' families, most first, then an entry no zone has (it draws
 *  nothing, and is kept to be removed or for another level). Scenery has rows of its own. */
export function zoneArtRows(
	zones: readonly { id: string }[],
	doc: GameConfigDoc,
	generator: string | undefined,
): ZoneArtRow[] {
	const map = doc.arcade?.zoneArt ?? {};
	const drawn = drawnFamilies(generator);
	const families = zones.map((z) => zoneFamilyOf(z.id)).filter((f) => !isZoneArtScenery(f));
	const rows: ZoneArtRow[] = countBy(families).map((g) => ({
		family: g.label,
		count: g.count,
		ruleOnly: !!drawn && !drawn.includes(g.label),
		art: map[g.label],
	}));
	for (const [family, art] of Object.entries(map))
		if (!isZoneArtScenery(family) && !rows.some((r) => r.family === family))
			rows.push({ family, count: 0, ruleOnly: false, art });
	return rows;
}

export type ZoneArtSceneryRow = {
	key: ZoneArtScenery;
	label: string;
	/** An entry in a game whose art places no scenery: it draws nothing, and is kept to be removed. */
	stale: boolean;
	art: ZoneArt | undefined;
};

const SCENERY_LABELS: Readonly<Record<ZoneArtScenery, string>> = { '@trees': 'Trees' };

/** The card's Scenery rows: every scenery key for a game drawn in Salmons' art, and for any other
 *  game only a key it has an entry for. */
export function zoneArtSceneryRows(
	doc: GameConfigDoc,
	generator: string | undefined,
): ZoneArtSceneryRow[] {
	const map = doc.arcade?.zoneArt ?? {};
	const placed = drawnInSalmonsArt(generator);
	return ZONE_ART_SCENERY.filter((key) => placed || map[key]).map((key) => ({
		key,
		label: SCENERY_LABELS[key],
		stale: !placed,
		art: map[key],
	}));
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

/** A JSON round trip, not `structuredClone`: the page's doc is a `$state` proxy, which
 *  `structuredClone` refuses with a DataCloneError. */
const copy = (doc: GameConfigDoc): Record<string, ZoneArt> =>
	JSON.parse(JSON.stringify(doc.arcade?.zoneArt ?? {}));

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
	art.variants = [...(art.variants ?? []), { ...art.source }];
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

/**
 * The project's rigs as the card offers them: the list a character sheet's rig picker shows (the
 * project's own, then the shared library's), and each rig's animations as the page reads them
 * (`/api/editor/rig/meta`, which the Game Config grant reads), asked for once per rig.
 */
export type ZoneArtRigs = {
	list: readonly { name: string; shared: boolean }[];
	/** A rig's animations once read; `undefined` while it is being read, or not asked yet. */
	animationsOf: (rig: string) => readonly string[] | undefined;
	/** Read a rig's animations, once. */
	read: (rig: string) => void;
};

/** A project with no rigs, or a page that offers none. */
export const NO_RIGS: ZoneArtRigs = Object.freeze({
	list: [],
	animationsOf: () => undefined,
	read: () => {},
});

/** Every rig the config's zone art names, each once: whose animations the card reads. */
export function zoneArtRigNames(doc: GameConfigDoc): string[] {
	const names = Object.values(doc.arcade?.zoneArt ?? {}).flatMap((art) =>
		[art.source, ...(art.variants ?? [])].flatMap((s) => (s.kind === 'rig' ? [s.rig] : [])),
	);
	return [...new Set(names)];
}

/** A rig picture of `rig` playing `animation`, played once when `was` was a rig played once. */
export const rigSourceOf = (
	was: ZoneArtSource | undefined,
	rig: string,
	animation: string,
): ZoneArtRig =>
	was?.kind === 'rig' && was.loop === false
		? { kind: 'rig', rig, animation, loop: false }
		: { kind: 'rig', rig, animation };

/**
 * What picking `rig` in a rig picture's rig select makes of the picture `was`: the same animation
 * on the new rig when that rig is read and has it, else `undefined`, and the card asks for an
 * animation of the new rig before anything is stored.
 */
export function rigPicked(
	was: ZoneArtSource | undefined,
	rig: string,
	animations: readonly string[] | undefined,
): ZoneArtRig | undefined {
	if (was?.kind !== 'rig') return undefined;
	if (was.rig === rig) return was;
	return animations?.includes(was.animation) ? { ...was, rig } : undefined;
}

/** `source` looped (the default, not stored) or played once. */
export function rigLooped(source: ZoneArtRig, loop: boolean): ZoneArtRig {
	const { loop: _, ...looped } = source;
	return loop ? looped : { ...looped, loop: false };
}

/**
 * How many zones of one family a rig may draw before the card warns. 430 rigs on one screen cost
 * about 2.4 ms a frame on a desktop core and several times that on a phone (`docs/design/zone-art.md`
 * §3): a hundred is a fraction of a phone's frame. Scenery is never a rig (`zoneArtTakesRig`).
 */
export const ZONE_ART_RIG_CROWD = 100;

/** The card's warning for a family drawn with a rig on more than {@link ZONE_ART_RIG_CROWD} zones of
 *  the level shown; `''` otherwise. */
export function rigCrowdWarning(count: number, art: ZoneArt | undefined): string {
	const rig = !!art && [art.source, ...(art.variants ?? [])].some((s) => s.kind === 'rig');
	return rig && count > ZONE_ART_RIG_CROWD
		? `${count} zones drawn as rigs: as many on screen cost a phone several milliseconds a frame. A frame or a clip costs next to nothing.`
		: '';
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
 * What `family` (or a scenery key) draws with no entry: Salmons' built-in art for a Salmons
 * generator (its pictures from the project's copy of the sheet, none when the project has no such
 * sheet), else nothing. A rule-only family (an invisible wall or area) says so.
 */
export function zoneArtDefault(
	family: string,
	generator: string | undefined,
	sheets: readonly { key: string }[],
	ruleOnly = false,
): ZoneArtDefault {
	if (ruleOnly) return { label: 'Invisible (rules only)', thumbs: [] };
	const builtIn = drawnInSalmonsArt(generator) ? SALMONS_BUILT_IN_ZONE_ART[family] : undefined;
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
