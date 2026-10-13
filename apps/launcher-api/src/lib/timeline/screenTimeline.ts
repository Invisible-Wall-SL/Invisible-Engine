import { sampleChannel, sampleNodeActor, sampleTint, type CinematicTrack } from 'engine-cinematic';
import {
	findNodeByName,
	keyedNodeChannels,
	nodeActorBindings,
	nodeActorChannelsForKind,
	resolveNodeActors,
	type CinematicDoc,
	type LayoutNode,
	type NodeActorChannel,
	type NodeActorSample,
	type Scene,
	type ValueBinding,
} from 'engine-layout';
import { PROP_CHANNELS, type TimelineChannel } from './timeline';

/**
 * SCREEN TIMELINES — a timeline whose host is a Scene Editor screen (`host: {kind:'screen'}`),
 * authored in `/editor`'s Animate mode and played in game by Flow's `playCinematic`. Plan:
 * `docs/design/rive-style-editor.md` Phase 3.
 *
 * The pure half, shared by the editor, the `/flow-v2` picker and the gates: creating a document,
 * turning a selected node into a node actor (by NAME, never by id), the values Animate mode keys,
 * the sampled preview the editor canvas draws, and the picker labels. Svelte-free.
 */

/** A node actor's channels are RELATIVE to the node's authored pose: this is "unchanged". */
export const NODE_IDENTITY: Record<KeyedChannel, number> = {
	x: 0,
	y: 0,
	scale: 1,
	rotation: 0,
	alpha: 1,
	tint: 0xffffff,
};

/** What Animate mode keys from the stage, in Timeline row order. */
export type KeyedChannel = 'x' | 'y' | 'scale' | 'rotation' | 'alpha' | 'tint';

/** The Timeline's rows for a screen timeline: the cinematic channels, plus `tint` as a colour. */
export const SCREEN_CHANNELS: TimelineChannel[] = [
	...PROP_CHANNELS,
	{ key: 'tint', label: 'tint', color: '#ff9fd0', input: 'color' },
];

export const KEYED_CHANNELS: KeyedChannel[] = ['x', 'y', 'scale', 'rotation', 'alpha', 'tint'];

/** The channels Animate mode offers for a node of `kind` (tint only where the node draws one). */
export function keyableChannels(kind: LayoutNode['kind']): KeyedChannel[] {
	const allowed = new Set<NodeActorChannel>(nodeActorChannelsForKind(kind));
	return KEYED_CHANNELS.filter((c) => allowed.has(c));
}

const slug = (s: string): string =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 40);

/**
 * A fresh id for a timeline on `sceneId` named `name`, unique among `taken`. Already in the storage
 * slug's alphabet, so the id the editor holds is the id the server stores it under.
 */
export function screenTimelineId(sceneId: string, name: string, taken: Iterable<string>): string {
	const used = new Set(taken);
	const base = `${slug(sceneId) || 'screen'}_${slug(name) || 'timeline'}`.slice(0, 56);
	if (!used.has(base)) return base;
	for (let i = 2; ; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`;
}

/** A new, empty timeline animating screen `sceneId`. */
export function newScreenTimeline(opts: {
	id: string;
	name: string;
	sceneId: string;
	duration?: number;
	fps?: number;
}): CinematicDoc {
	return {
		schemaVersion: 1,
		id: opts.id,
		name: opts.name,
		duration: opts.duration ?? 1,
		fps: opts.fps ?? 30,
		stage: { sceneId: null, cast: [] },
		host: { kind: 'screen', sceneId: opts.sceneId },
		tracks: [],
		markers: [],
	};
}

/** The rows of a cinematic listing that are timelines of screen `sceneId`. */
export function screenTimelinesOf<T extends { host?: CinematicDoc['host'] }>(
	rows: T[],
	sceneId: string | undefined,
): T[] {
	if (!sceneId) return [];
	return rows.filter((row) => row.host?.kind === 'screen' && row.host.sceneId === sceneId);
}

function findById(nodes: LayoutNode[], id: string): LayoutNode | undefined {
	for (const node of nodes) {
		if (node.id === id) return node;
		const children = (node as { children?: LayoutNode[] }).children;
		const hit = Array.isArray(children) ? findById(children, id) : undefined;
		if (hit) return hit;
	}
	return undefined;
}

function countLabel(nodes: LayoutNode[], label: string): number {
	let n = 0;
	for (const node of nodes) {
		if (node.label === label) n++;
		const children = (node as { children?: LayoutNode[] }).children;
		if (Array.isArray(children)) n += countLabel(children, label);
	}
	return n;
}

export type NodeTarget =
	| { ok: true; target: string; node: LayoutNode }
	| { ok: false; reason: 'not-found' | 'unnamed' | 'duplicate'; message: string };

/**
 * The name a node actor for `nodeId` targets. A timeline binds by NAME so it plays on any screen
 * with that name (plan §3.3), and the game's lookup (`findNodeByName`) falls back to an id only
 * for nodes nobody named — so Animate mode refuses an unnamed node or a shared name rather than
 * silently binding to an id or to the wrong node.
 */
export function nodeActorTarget(scene: Scene, nodeId: string): NodeTarget {
	const node = findById(scene.nodes, nodeId);
	if (!node) {
		return { ok: false, reason: 'not-found', message: 'That node is not on this screen.' };
	}
	const label = node.label ?? '';
	if (!label.trim()) {
		return {
			ok: false,
			reason: 'unnamed',
			message:
				'Name this node first (Properties → Name). A timeline drives a node by its name, so it plays on any screen that has a node with that name.',
		};
	}
	if (countLabel(scene.nodes, label) > 1 || findNodeByName(scene.nodes, label)?.id !== node.id) {
		return {
			ok: false,
			reason: 'duplicate',
			message: `Another node on this screen is also named "${label}". Give this one a unique name so the timeline drives the right node.`,
		};
	}
	return { ok: true, target: label, node };
}

/** The node actor targeting `target`, if the timeline has one. */
export function nodeActorOf(doc: CinematicDoc, target: string): string | null {
	const cast = doc.stage.cast.find((c) => c.kind === 'node' && c.target === target);
	return cast ? cast.actorId : null;
}

/** The node actor targeting `target`, created (mutating `doc`) when the timeline has none yet. */
export function ensureNodeActor(doc: CinematicDoc, target: string): string {
	const existing = nodeActorOf(doc, target);
	if (existing) return existing;
	const taken = new Set(doc.stage.cast.map((c) => c.actorId));
	const base = `node_${slug(target) || 'actor'}`;
	let actorId = base;
	for (let i = 2; taken.has(actorId); i++) actorId = `${base}_${i}`;
	doc.stage.cast.push({
		actorId,
		kind: 'node',
		target,
		place: { x: 0, y: 0, scale: 1, rotation: 0, alpha: 1 },
		z: doc.stage.cast.length,
	});
	return actorId;
}

const tracksOf = (doc: CinematicDoc, actorId: string): CinematicTrack[] =>
	doc.tracks.filter((t) => t.actorId === actorId) as unknown as CinematicTrack[];

/**
 * One channel of a node actor at `t`, relative to the authored pose: the keyed value, or the
 * identity (`NODE_IDENTITY`) while the channel has no keys. What the Animate fields show, and what
 * ◆ keys.
 */
export function nodeChannelValue(
	doc: CinematicDoc,
	actorId: string,
	channel: KeyedChannel,
	t: number,
): number {
	let value: number | undefined;
	for (const track of tracksOf(doc, actorId)) {
		if (track.kind !== 'property' || !track.channels) continue;
		const keys = track.channels[channel];
		const v = channel === 'tint' ? sampleTint(keys, t) : sampleChannel(keys, t);
		if (v !== undefined) value = v;
	}
	return value ?? NODE_IDENTITY[channel];
}

/** Does `actorId` key `channel`? */
export function isChannelKeyed(doc: CinematicDoc, actorId: string, channel: KeyedChannel): boolean {
	return tracksOf(doc, actorId).some(
		(t) => t.kind === 'property' && !!t.channels?.[channel]?.length,
	);
}

/** How a timeline drives one node of the screen at time `t` — the player's own inputs. */
export interface TimelineNodeDrive {
	/** The value bindings the keyed channels stand for (`nodeActorBindings`). */
	bindings: ValueBinding[];
	/** The node's channels at `t` (`sampleNodeActor`). */
	sample: NodeActorSample;
}

/**
 * Every node `doc` drives on `scene` at `t`, keyed by node id: exactly the inputs
 * `<LayoutNodeView>` folds in game (`resolveNodeActors` → `keyedNodeChannels` →
 * `nodeActorBindings`, sampled by `sampleNodeActor`), so the editor previews what the game plays.
 */
export function timelineDrives(
	doc: CinematicDoc,
	scene: Scene | undefined,
	t: number,
): Map<string, TimelineNodeDrive> {
	const out = new Map<string, TimelineNodeDrive>();
	for (const [nodeId, actor] of resolveNodeActors(doc, scene)) {
		const bindings = nodeActorBindings(keyedNodeChannels(actor.tracks));
		const sample = sampleNodeActor(actor.tracks as unknown as CinematicTrack[], t);
		if (bindings.length || sample.tint !== undefined) out.set(nodeId, { bindings, sample });
	}
	return out;
}

export interface CinematicPickerOption {
	id: string;
	label: string;
}

/**
 * The `/flow-v2` cinematic picker's options: screen timelines as "Timeline · <screen> · <name>",
 * then the Rigger's cinematics by name, each group alphabetical. A timeline whose screen is gone
 * keeps its id as the screen label, so it stays pickable and visibly broken.
 */
export function cinematicPickerOptions(
	rows: { id: string; name: string; host?: CinematicDoc['host'] }[],
	sceneNames: Record<string, string>,
): CinematicPickerOption[] {
	const timelines: CinematicPickerOption[] = [];
	const cinematics: CinematicPickerOption[] = [];
	for (const row of rows) {
		const name = row.name || row.id;
		if (row.host?.kind === 'screen') {
			const screen = sceneNames[row.host.sceneId] ?? row.host.sceneId;
			timelines.push({ id: row.id, label: `Timeline · ${screen} · ${name}` });
		} else {
			cinematics.push({ id: row.id, label: `Cinematic · ${name}` });
		}
	}
	const byLabel = (a: CinematicPickerOption, b: CinematicPickerOption) =>
		a.label.localeCompare(b.label);
	return [...timelines.sort(byLabel), ...cinematics.sort(byLabel)];
}
