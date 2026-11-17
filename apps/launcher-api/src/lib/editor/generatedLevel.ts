import { FIELD_DRAWINGS, type ContainerNode, type LayoutNode, type Scene } from 'engine-layout';
import { ONLINE_GENERATORS } from 'engine-mechanics';
import {
	normalizeLevels,
	type ArcadeOnlineLevels,
	type LevelCell,
	type LevelOverlay,
	type LevelOverlayKind,
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

/** An overlay entry the previewed level has no place for (`salmonsMap.js` `orphans`). */
export type LevelOrphan = { op: 'add' | 'remove' | 'set'; cell: LevelCell; kind?: string };

/** The overlay scope: one seed's own (its decimal string), or `'*'` for every level. */
export type OverlayScope = string;

export const MAX_SEED = 0xffffffff;

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

/** A seed the editor accepts: a whole number in the room state's uint32 range. */
export function validSeed(v: number): boolean {
	return Number.isInteger(v) && v >= 0 && v <= MAX_SEED;
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

type ConfigDoc = { arcade?: { online?: { levels?: unknown } } } & Record<string, unknown>;

/** The project's config's `arcade.online.levels`, and the ETag a save is conditional on. */
export async function loadLevels(
	projectKey: string,
): Promise<{ levels: ArcadeOnlineLevels | undefined; etag: string | null }> {
	const res = await fetch(`/api/game-config?project=${encodeURIComponent(projectKey)}`);
	if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
	const body = (await res.json()) as { doc: ConfigDoc; etag: string | null };
	return { levels: normalizeLevels(body.doc.arcade?.online?.levels), etag: body.etag };
}

/**
 * Write `levels` into the project's config, conditional on the config being unchanged since it was
 * read (a fresh read, so only this one field is ours): a concurrent save answers 409, never a lost
 * update (`docs/design/multi-user-concurrency.md`). Returns the new ETag.
 */
export async function saveLevels(
	projectKey: string,
	levels: ArcadeOnlineLevels,
): Promise<string | null> {
	const q = `project=${encodeURIComponent(projectKey)}`;
	const read = await fetch(`/api/game-config?${q}`);
	if (!read.ok) throw new Error((await read.text()) || `HTTP ${read.status}`);
	const { doc, etag } = (await read.json()) as { doc: ConfigDoc; etag: string | null };
	const online = doc.arcade?.online;
	if (!online) throw new Error('This project’s config has no online arcade block to hold levels.');
	const empty = !levels.seeds?.length && !Object.keys(levels.overlays ?? {}).length;
	const nextOnline: Record<string, unknown> = { ...online };
	if (empty) delete nextOnline.levels;
	else nextOnline.levels = levels;
	const next = { ...doc, arcade: { ...doc.arcade, online: nextOnline } };
	const res = await fetch(`/api/game-config?${q}`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ doc: next, baseEtag: etag }),
	});
	if (res.status === 409)
		throw new Error('Someone saved this config meanwhile — reload and retry.');
	if (!res.ok) {
		const text = await res.text();
		throw new Error(text || `HTTP ${res.status}`);
	}
	return ((await res.json()) as { etag: string | null }).etag;
}
