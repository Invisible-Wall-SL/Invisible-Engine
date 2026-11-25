import { ONLINE_GENERATORS } from 'engine-mechanics';
import {
	ONLINE_GENERATOR_IDS,
	normalizeLevels,
	type ArcadeOnlineSolid,
	type ArcadeZone,
	type GameConfigDoc,
	zoneFamilyOf,
} from 'game-config';
import { MAX_SEED, validSeed } from '$lib/editor/generatedLevelCore';

/**
 * What `/config` shows of an arcade game's ZONES and their rules (`arcade.zones`,
 * `arcade.online.rules.zones`, `arcade.forces`): the zone map's roles and geometry, the grouped
 * counts of a long list, its filter and paging, and the level a field generator makes. Pure, so
 * `check:game-config-family` runs it on the real modules.
 *
 * A generated game (`arcade.online.generator`) plays none of the zones its config stores: each room
 * makes its own from its seed. The page shows the level a seed makes, through the very generator a
 * room runs, and any stored snapshot only read-only.
 */

export type Rect = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };

/** A zone rule as the map reads it: an online rule, an offline force (`arcade.forces`) or a rule a
 *  generator made (`pull`: an original level's whirlpool). */
export type ZoneRuleLike = {
	zone: string;
	force?: Point;
	pull?: unknown;
	solid?: ArcadeOnlineSolid;
	kind?: string;
	goal?: boolean;
	characters?: readonly string[];
};

/** What a zone is to the game, as the map colours it, in paint order: a later role is drawn over an
 *  earlier one, so a current shows over the land a character cannot cross. */
export const ZONE_ROLES = ['none', 'solid', 'push', 'oneWay', 'kind', 'goal'] as const;
export type ZoneRole = (typeof ZONE_ROLES)[number];

export const ZONE_ROLE_LABELS: Record<ZoneRole, string> = {
	none: 'No rule',
	solid: 'Solid',
	push: 'Pushes (a current)',
	oneWay: 'Solid from one side',
	kind: 'A kind the rules module acts on',
	goal: 'The goal',
};

/** Which of a zone's rules names it, when it has several. */
const ROLE_RANK: ZoneRole[] = ['goal', 'solid', 'oneWay', 'kind', 'push', 'none'];

function ruleRole(rule: ZoneRuleLike): ZoneRole {
	if (rule.goal) return 'goal';
	if (rule.solid === true) return 'solid';
	if (rule.solid) return 'oneWay';
	if (rule.kind) return 'kind';
	if (rule.force || rule.pull) return 'push';
	return 'none';
}

/** A zone's role from the rules on it; none ⇒ `none`. */
export function zoneRole(rules: readonly ZoneRuleLike[] | undefined): ZoneRole {
	let best: ZoneRole = 'none';
	for (const rule of rules ?? []) {
		const role = ruleRole(rule);
		if (ROLE_RANK.indexOf(role) < ROLE_RANK.indexOf(best)) best = role;
	}
	return best;
}

/** The rules a config puts on its zones: an online game's zone rules, else its offline forces (an
 *  online game plays its rules' currents, not `arcade.forces`). */
export function zoneRulesOf(doc: GameConfigDoc): ZoneRuleLike[] {
	const online = doc.arcade?.online;
	if (online) return online.rules?.zones ?? [];
	return doc.arcade?.forces ?? [];
}

export function rulesByZone(rules: readonly ZoneRuleLike[]): Map<string, ZoneRuleLike[]> {
	const byZone = new Map<string, ZoneRuleLike[]>();
	for (const rule of rules) {
		const list = byZone.get(rule.zone);
		if (list) list.push(rule);
		else byZone.set(rule.zone, [rule]);
	}
	return byZone;
}

/** What a rule does, without its numbers: `push`, `solid from below + kind waterfall`, `goal`. */
export function ruleWhat(rule: ZoneRuleLike): string {
	const parts: string[] = [];
	if (rule.force) parts.push('push');
	if (rule.pull) parts.push('pull');
	if (rule.solid === true) parts.push('solid');
	else if (rule.solid) parts.push(`solid from ${rule.solid}`);
	if (rule.kind) parts.push(`kind ${rule.kind}`);
	if (rule.goal) parts.push('goal');
	return parts.join(' + ') || 'nothing';
}

/** A rule on one line, with its push and the characters it applies to. */
export function ruleText(rule: ZoneRuleLike): string {
	const what = rule.force
		? ruleWhat(rule).replace(/^push/, `push ${rule.force.x}, ${rule.force.y} px/s`)
		: ruleWhat(rule);
	return rule.characters?.length ? `${what} (${rule.characters.join(', ')})` : what;
}

/** Whether a zone rule does something, which a stored one must: push, be the goal, be solid or
 *  have a kind (the normalizer drops any other). */
export const zoneRuleActs = (rule: Omit<ZoneRuleLike, 'zone'>): boolean =>
	!!(rule.force || rule.goal || rule.solid || rule.kind);

/** The Solid select of a zone rule: its value, and what the page calls it. */
export const SOLID_CHOICES = [
	['', '—'],
	['every', 'every side'],
	['below', 'from below'],
	['above', 'from above'],
	['left', 'from left'],
	['right', 'from right'],
] as const;

/** A rule's `solid` as the select's value. */
export const solidChoice = (solid: ArcadeOnlineSolid | undefined): string =>
	solid === true ? 'every' : (solid ?? '');

/** The select's value as `solid`; `''` or anything unknown ⇒ not solid. */
export function solidFromChoice(value: string): ArcadeOnlineSolid | undefined {
	if (value === 'every') return true;
	return value === 'below' || value === 'above' || value === 'left' || value === 'right'
		? value
		: undefined;
}

export type Group = { label: string; count: number };

/** How many of each label, most first (then by label). */
export function countBy(labels: Iterable<string>): Group[] {
	const counts = new Map<string, number>();
	for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
	return [...counts]
		.map(([label, count]) => ({ label, count }))
		.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Zone ids grouped by family (`game-config` `zoneFamilyOf`: numbers as `#`, so `band12Water` and
 *  `band13Water` are one group), as the Zone art card keys its entries. */
export const zoneGroups = (zones: readonly { id: string }[]): Group[] =>
	countBy(zones.map((z) => zoneFamilyOf(z.id)));

export const ruleGroups = (rules: readonly ZoneRuleLike[]): Group[] => countBy(rules.map(ruleWhat));

/** Rows a long table shows at first, and adds per "Show more". A table this long or shorter shows
 *  every row, with no filter. */
export const PAGE_SIZE = 50;

export type PagedRow<T> = { item: T; index: number };

/** The rows of `items` whose `text` holds `filter` (any case), the first `limit` of them, each with
 *  its index in `items` (what a setter takes); the row at `reveal` (one just added) is shown too,
 *  in its place. */
export function pageRows<T>(
	items: readonly T[],
	filter: string,
	text: (item: T) => string,
	limit: number,
	reveal = -1,
): { rows: PagedRow<T>[]; matched: number; total: number } {
	const needle = filter.trim().toLowerCase();
	const rows: PagedRow<T>[] = [];
	let matched = 0;
	items.forEach((item, index) => {
		if (needle && !text(item).toLowerCase().includes(needle)) return;
		matched += 1;
		if (rows.length < limit || index === reveal) rows.push({ item, index });
	});
	return { rows, matched, total: items.length };
}

/** What the map shows when the config has no field and no zone: a square to draw the first in. */
export const MAP_FALLBACK_AREA: Rect = Object.freeze({ x: 0, y: 0, w: 1000, h: 1000 });

/** The map's area: the field, grown to hold every zone (one off the field shows where it is), or
 *  with no field the zones' bounds from the field's corner. */
export function zoneMapArea(
	field: { w: number; h: number } | undefined,
	zones: readonly Rect[],
): Rect {
	if (!field && !zones.length) return MAP_FALLBACK_AREA;
	let x0 = 0;
	let y0 = 0;
	let x1 = field?.w ?? 0;
	let y1 = field?.h ?? 0;
	for (const z of zones) {
		x0 = Math.min(x0, z.x);
		y0 = Math.min(y0, z.y);
		x1 = Math.max(x1, z.x + z.w);
		y1 = Math.max(y1, z.y + z.h);
	}
	return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/** Field px → screen px that fits the whole area in a `viewW × viewH` view. */
export const fitScale = (area: Rect, viewW: number, viewH: number): number =>
	Math.min(viewW / area.w, viewH / area.h);

/** A rect in whole px, by its edges (so a dragged edge does not move the other), at least 1 px. */
export function wholeRect(r: Rect): Rect {
	const x = Math.round(r.x);
	const y = Math.round(r.y);
	return {
		x,
		y,
		w: Math.max(1, Math.round(r.x + r.w) - x),
		h: Math.max(1, Math.round(r.y + r.h) - y),
	};
}

/** The rect a drag from `a` to `b` draws, either way round, in whole px. */
export const drawnRect = (a: Point, b: Point): Rect =>
	wholeRect({
		x: Math.min(a.x, b.x),
		y: Math.min(a.y, b.y),
		w: Math.abs(b.x - a.x),
		h: Math.abs(b.y - a.y),
	});

/** The config's field generator when a room can run it; an unknown one (the validator refuses it)
 *  or none ⇒ `undefined`, and the zones are the config's own. */
export function zoneGenerator(doc: GameConfigDoc): string | undefined {
	const id = doc.arcade?.online?.generator;
	return id && ONLINE_GENERATOR_IDS.includes(id) && id in ONLINE_GENERATORS ? id : undefined;
}

/** The seed a preview opens on: the first pinned seed, as a new room plays, else this one. */
export const PREVIEW_SEED = 1;

export const previewSeedOf = (doc: GameConfigDoc): number =>
	doc.arcade?.online?.levels?.seeds?.[0] ?? PREVIEW_SEED;

/** A seed a room can play (the room state's uint32), or `undefined`. */
export function seedOf(text: string): number | undefined {
	const n = Number(text);
	return text.trim() !== '' && validSeed(n) ? n : undefined;
}

export const randomSeed = (): number => Math.floor(Math.random() * (MAX_SEED + 1));

export type GeneratedZones = {
	/** The generator that made them ({@link zoneGenerator}). */
	generator: string;
	seed: number;
	field: { w: number; h: number };
	zones: ArcadeZone[];
	rules: ZoneRuleLike[];
};

/** The field, zones and zone rules a room seeded `seed` plays: its generator, with the config's
 *  level overlays (`engine-mechanics` `generatedOnlineGame` does the same for a room). */
export function generatedZones(
	doc: GameConfigDoc,
	generator: string,
	seed: number,
): GeneratedZones {
	const g = ONLINE_GENERATORS[generator];
	const { field, zones, zoneRules } = g.geometry(
		g.make(seed, normalizeLevels(doc.arcade?.online?.levels)),
	);
	return { generator, seed, field, zones, rules: zoneRules };
}
