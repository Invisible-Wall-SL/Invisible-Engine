import { FIELD_DRAWINGS, type ContainerNode, type LayoutNode, type Scene } from 'engine-layout';
import { ONLINE_GENERATORS } from 'engine-mechanics';
import {
	normalizeShapedLevels as normalizeLevels,
	type ShapedLevels as ArcadeOnlineLevels,
	type LevelCell,
	type LevelOverlay,
	type LevelOverlayKind,
	type LevelsBiomes,
	type LevelsGenerator,
	type LevelsRiver,
	type LevelsWaterfalls,
} from 'game-config';
import { drawGeneratedLevel, type Drawings, type Generators } from './generatedLevelCore';

/**
 * A GENERATED LEVEL in `/editor` (`docs/design/salmons-levels.md` §2 c–d): a screen's node marked
 * `generated` holds what an online generator made from a seed. The editor previews another seed by
 * running the very generator a room runs (`engine-mechanics` `ONLINE_GENERATORS`, with the config's
 * `levels`, so its overlays show) and redrawing the node with the room's drawing (`FIELD_DRAWINGS`).
 * The node is read-only; authored pieces go in the config's overlays, never in the node.
 */

export type GeneratedNode = ContainerNode & { generated: { generator: string; seed: number } };

/** What the previewed level has no place for (`salmonsMap.js` `orphans`): an overlay entry, or a
 *  biome's density over its stretch's columns (`rows`, first and last). */
export type LevelOrphan =
	| { op: 'add' | 'remove' | 'set'; cell: LevelCell; kind?: string }
	| {
			op: 'biome';
			biome: string;
			kind: string;
			rows: [number, number];
			reason: 'no-room' | 'capped';
	  };

/** An orphan as a person reads it. */
export function orphanText(o: LevelOrphan): string {
	if (o.op !== 'biome')
		return `${o.op} ${o.kind ?? ''} ${o.cell[0]}, ${o.cell[1]}`.replace(/\s+/g, ' ');
	const where = `${o.biome} (columns ${o.rows[0]}–${o.rows[1]})`;
	return o.reason === 'no-room'
		? `${where}: no ${o.kind}s are placed there`
		: `${where}: more ${o.kind}s than every place there, held to all`;
}

/** The overlay scope: one seed's own (its decimal string), or `'*'` for every level. */
export type OverlayScope = string;

/** The screen's generated node, if it has one at its top level. */
export function generatedNodeOf(scene: Scene): GeneratedNode | undefined {
	return scene.nodes.find(
		(n): n is GeneratedNode =>
			n.kind === 'container' && !!(n as Partial<GeneratedNode>).generated?.generator,
	);
}

/** Whether the editor knows how to make and draw this node's generator. */
export function canGenerate(node: GeneratedNode): boolean {
	const id = node.generated.generator;
	return id in ONLINE_GENERATORS && id in FIELD_DRAWINGS;
}

/**
 * Redraw `node` as the level `seed` makes with `levels`' overlays, and size the screen's world to
 * it, exactly as a room's device does (`apps/lines` `online.ts`). Returns the overlay entries this
 * level could not place.
 */
export function regenerate(
	scene: Scene,
	node: GeneratedNode,
	seed: number,
	levels: ArcadeOnlineLevels | undefined,
): LevelOrphan[] {
	const id = node.generated.generator;
	const { made, node: drawn } = drawGeneratedLevel(
		ONLINE_GENERATORS as unknown as Generators,
		FIELD_DRAWINGS as unknown as Drawings,
		id,
		seed,
		levels,
	);
	node.children = (drawn as LayoutNode & { children?: LayoutNode[] }).children ?? [];
	node.generated = { generator: id, seed };
	if (scene.world) scene.world = { ...scene.world, w: made.world.w, h: made.world.h };
	return ((made as { orphans?: LevelOrphan[] }).orphans ?? []).map((o) => ({ ...o }));
}

/** The levels' generator settings (`undefined` or none left: every default again). */
export function setGenerator(
	levels: ArcadeOnlineLevels | undefined,
	generator: LevelsGenerator | undefined,
): ArcadeOnlineLevels {
	const kept = generator && Object.keys(generator).length ? generator : undefined;
	const next = { ...levels, generator: kept };
	if (!kept) delete next.generator;
	return normalizeLevels(next) ?? {};
}

/** The levels' biomes (`undefined`: the original's forest again). */
export function setBiomes(
	levels: ArcadeOnlineLevels | undefined,
	biomes: LevelsBiomes | undefined,
): ArcadeOnlineLevels {
	const next = { ...levels, biomes };
	if (!biomes) delete next.biomes;
	return normalizeLevels(next) ?? {};
}

const sameCell = (a: LevelCell, b: LevelCell) => a[0] === b[0] && a[1] === b[1];

/** `levels` with `edit` applied to the overlay of `scope` (an emptied overlay is dropped). */
function withOverlay(
	levels: ArcadeOnlineLevels | undefined,
	scope: OverlayScope,
	edit: (o: LevelOverlay) => LevelOverlay,
): ArcadeOnlineLevels {
	const overlays = { ...(levels?.overlays ?? {}) };
	const next = edit({ ...(overlays[scope] ?? {}) });
	overlays[scope] = next;
	return normalizeLevels({ ...levels, overlays }) ?? {};
}

/** Add a piece on a cell of the overlay (replacing an addition on that cell). */
export function addPiece(
	levels: ArcadeOnlineLevels | undefined,
	scope: OverlayScope,
	kind: LevelOverlayKind,
	cell: LevelCell,
	height?: number,
): ArcadeOnlineLevels {
	return withOverlay(levels, scope, (o) => ({
		...o,
		add: [
			...(o.add ?? []).filter((a) => !sameCell(a.cell, cell)),
			{ cell, kind, ...(kind === 'waterfall' && height ? { height } : {}) },
		],
	}));
}

/** Remove the generated pieces on a cell of every level the overlay applies to. */
export function removeGenerated(
	levels: ArcadeOnlineLevels | undefined,
	scope: OverlayScope,
	cell: LevelCell,
): ArcadeOnlineLevels {
	return withOverlay(levels, scope, (o) => ({
		...o,
		remove: [...(o.remove ?? []).filter((c) => !sameCell(c, cell)), cell],
	}));
}

/** Drop one authored entry (`add`, `remove` or `set`, by index) from the overlay. */
export function dropEntry(
	levels: ArcadeOnlineLevels | undefined,
	scope: OverlayScope,
	op: 'add' | 'remove' | 'set',
	index: number,
): ArcadeOnlineLevels {
	return withOverlay(levels, scope, (o) => {
		const list = [...((o[op] as unknown[] | undefined) ?? [])];
		list.splice(index, 1);
		return { ...o, [op]: list };
	});
}

/** Pin `seed` (each new room takes the pinned seeds in turn) or unpin it. */
export function togglePinned(
	levels: ArcadeOnlineLevels | undefined,
	seed: number,
): ArcadeOnlineLevels {
	const seeds = levels?.seeds ?? [];
	const next = seeds.includes(seed) ? seeds.filter((s) => s !== seed) : [...seeds, seed];
	return normalizeLevels({ ...levels, seeds: next }) ?? {};
}

/** Shape the levels' river (`undefined`: the generator's own river again). */
export function setRiver(
	levels: ArcadeOnlineLevels | undefined,
	river: LevelsRiver | undefined,
): ArcadeOnlineLevels {
	return normalizeLevels({ ...levels, river }) ?? {};
}

/** Set the levels' waterfalls (`undefined`: the generator's own again). */
export function setWaterfalls(
	levels: ArcadeOnlineLevels | undefined,
	waterfalls: LevelsWaterfalls | undefined,
): ArcadeOnlineLevels {
	return normalizeLevels({ ...levels, waterfalls }) ?? {};
}

export type ConfigDoc = { arcade?: { online?: { levels?: unknown } } } & Record<string, unknown>;

/** The project's config as loaded: the doc, the ETag a save is conditional on, and its levels. */
export type LoadedConfig = {
	doc: ConfigDoc;
	etag: string | null;
	levels: ArcadeOnlineLevels | undefined;
};

const NO_CONFIG = 'This project has no Game Config with an online arcade block to hold levels yet.';

/** The project's config, or an error a person can act on (a project with no config has none). */
export async function loadConfig(projectKey: string): Promise<LoadedConfig> {
	const res = await fetch(`/api/game-config?project=${encodeURIComponent(projectKey)}`);
	if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
	const body = (await res.json()) as { doc: ConfigDoc | null; etag: string | null };
	if (!body.doc?.arcade?.online) throw new Error(NO_CONFIG);
	return { doc: body.doc, etag: body.etag, levels: normalizeLevels(body.doc.arcade.online.levels) };
}

/**
 * Write `levels` into the config as it was LOADED, conditional on the ETag it was loaded with: if
 * anyone saved the config since (another author's overlays, a `/config` edit), the write answers
 * 409 and nothing is lost (`docs/design/multi-user-concurrency.md`). Returns the config as saved,
 * to carry on from.
 */
export async function saveLevels(
	projectKey: string,
	loaded: LoadedConfig,
	levels: ArcadeOnlineLevels,
): Promise<LoadedConfig> {
	const online = loaded.doc.arcade?.online;
	if (!online) throw new Error(NO_CONFIG);
	const empty = !normalizeLevels(levels);
	const nextOnline: Record<string, unknown> = { ...online };
	if (empty) delete nextOnline.levels;
	else nextOnline.levels = levels;
	const doc = { ...loaded.doc, arcade: { ...loaded.doc.arcade, online: nextOnline } };
	const res = await fetch(`/api/game-config?project=${encodeURIComponent(projectKey)}`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ doc, baseEtag: loaded.etag }),
	});
	if (res.status === 409)
		throw new Error(
			'Someone saved this config since it was loaded. Reload the card to see theirs.',
		);
	if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
	const saved = (await res.json()) as { doc: ConfigDoc; etag: string | null };
	return {
		doc: saved.doc,
		etag: saved.etag,
		levels: normalizeLevels(saved.doc.arcade?.online?.levels),
	};
}
