import {
	sampleChannel,
	sampleNodeActor,
	sampleTint,
	type CinematicFxParamChannel,
	type CinematicNodeSample,
	type CinematicStrip,
	type CinematicTrack,
} from 'engine-cinematic';
import type { EffectParam } from 'engine-fx';
import {
	componentTriggers,
	drivableFxParams,
	findNodeByName,
	fxParamChannel,
	fxParamOfChannel,
	fxParamRest,
	keyedNodeChannels,
	nodeActorBindings,
	nodeActorChannelsForKind,
	resolveNodeActors,
	type CinematicDoc,
	type ComponentDef,
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

/** A fresh id for a timeline on component `componentId` named `name`, unique among `taken`. */
export function componentTimelineId(
	componentId: string,
	name: string,
	taken: Iterable<string>,
): string {
	return screenTimelineId(`c_${componentId}`, name, taken);
}

/**
 * A new, empty timeline animating component `componentId` — played on every placed instance when
 * `playOn` fires there (Rive plan Phase 4).
 */
export function newComponentTimeline(opts: {
	id: string;
	name: string;
	componentId: string;
	playOn?: string;
	duration?: number;
	fps?: number;
}): CinematicDoc {
	return {
		...newScreenTimeline({ ...opts, sceneId: '' }),
		host: { kind: 'component', componentId: opts.componentId },
		...(opts.playOn ? { playOn: opts.playOn } : {}),
	};
}

/** The rows of a cinematic listing hosted on component `componentId`. */
export function componentTimelinesOf<T extends { host?: CinematicDoc['host'] }>(
	rows: T[],
	componentId: string | undefined,
): T[] {
	if (!componentId) return [];
	return rows.filter(
		(row) => row.host?.kind === 'component' && row.host.componentId === componentId,
	);
}

/**
 * The signals a component timeline can start on: `enter` (the instance appears), then the def's
 * own trigger inputs (its declared signals fold in — `componentTriggers`), then the names its rig
 * cues complete with — each once, in that order.
 */
export function componentTimelineSignals(def: {
	inputs?: ComponentDef['inputs'];
	signals?: ComponentDef['signals'];
	root: LayoutNode;
}): string[] {
	const out = new Set<string>(['enter', ...componentTriggers(def)]);
	const walk = (node: LayoutNode): void => {
		const cues = (node as { cues?: { completeSignal?: string }[] }).cues;
		for (const cue of cues ?? []) if (cue.completeSignal) out.add(cue.completeSignal);
		for (const child of (node as { children?: LayoutNode[] }).children ?? []) walk(child);
	};
	walk(def.root);
	return [...out];
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
export function nodeActorTarget(scene: Scene, nodeId: string, where = 'screen'): NodeTarget {
	const node = findById(scene.nodes, nodeId);
	if (!node) {
		return { ok: false, reason: 'not-found', message: `That node is not on this ${where}.` };
	}
	const label = node.label ?? '';
	if (!label.trim()) {
		return {
			ok: false,
			reason: 'unnamed',
			message: `Name this node first (Properties → Name). A timeline drives a node by its name, so it plays on any ${where} that has a node with that name.`,
		};
	}
	if (countLabel(scene.nodes, label) > 1 || findNodeByName(scene.nodes, label)?.id !== node.id) {
		return {
			ok: false,
			reason: 'duplicate',
			message: `Another node on this ${where} is also named "${label}". Give this one a unique name so the timeline drives the right node.`,
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

/** A rig animation a strip can hold, and its length in seconds. */
export interface RigClip {
	name: string;
	duration: number;
}

/**
 * Play `clip` on the rig node actor `actorId` from `at` (Rive plan Phase 8a's `animation` strip,
 * authored from the editor): the actor's animation track, created when it has none, gains a strip
 * that holds the clip for its own length, with `clipLength` recorded so the game can loop it
 * without the skeleton. The timeline grows to end no earlier than the strip; it never shrinks.
 */
export function addRigClipStrip(
	doc: CinematicDoc,
	actorId: string,
	clip: RigClip,
	at: number,
): void {
	let track = doc.tracks.find((t) => t.actorId === actorId && t.kind === 'animation');
	if (!track) {
		track = { id: `anim_${actorId}`, actorId, kind: 'animation', layer: 0, strips: [] };
		doc.tracks.push(track);
	}
	const strips = (
		Array.isArray(track.strips) ? track.strips : (track.strips = [])
	) as CinematicStrip[];
	const taken = new Set(strips.map((s) => s.id));
	let id = `strip_${actorId}_${strips.length + 1}`;
	for (let i = 2; taken.has(id); i++) id = `strip_${actorId}_${strips.length + i}`;
	const start = Math.max(0, at);
	const length = clip.duration > 0 ? clip.duration : 1;
	strips.push({
		id,
		clip: { src: 'rig', name: clip.name },
		start,
		length,
		clipLength: length,
		clipIn: 0,
		speed: 1,
		loop: { mode: 'once' },
		alpha: 1,
		blend: 'replace',
		blendIn: 0,
		blendOut: 0,
	});
	doc.duration = Math.max(doc.duration, Math.round((start + length) * 1000) / 1000);
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

/** Does `actorId` key `channel` (a {@link KeyedChannel}, or an effect's `fx:<id>`)? */
export function isChannelKeyed(doc: CinematicDoc, actorId: string, channel: string): boolean {
	return tracksOf(doc, actorId).some(
		(t) => t.kind === 'property' && !!t.channels?.[channel]?.length,
	);
}

/** One exposed parameter of a placed effect, as Animate mode keys it: its `fx:<id>` channel. */
export interface FxChannelRow {
	channel: CinematicFxParamChannel;
	param: EffectParam;
}

/**
 * The effect parameters Animate mode offers on a node (Invisible FX Step 2): on an effect node, one
 * `fx:<id>` channel per number or on/off parameter of the placed effect (`params`, its
 * `EffectDoc.params`), in the effect's order. A colour parameter is not keyed. Empty on any other
 * node, or while the effect is not loaded.
 */
export function keyableFxChannels(
	node: LayoutNode,
	params: readonly EffectParam[] | undefined,
): FxChannelRow[] {
	if (node.kind !== 'effect') return [];
	return drivableFxParams(params).map((param) => ({ channel: fxParamChannel(param.id), param }));
}

/** The `fx:` channels `actorId` keys whose parameter `params` does not declare as drivable — rows
 *  the Timeline still lists so their keys can be found and removed. */
export function staleFxChannels(
	doc: CinematicDoc,
	actorId: string,
	params: readonly EffectParam[] | undefined,
): CinematicFxParamChannel[] {
	const offered = new Set(drivableFxParams(params).map((p) => fxParamChannel(p.id)));
	const out: CinematicFxParamChannel[] = [];
	for (const track of tracksOf(doc, actorId)) {
		if (track.kind !== 'property' || !track.channels) continue;
		for (const [name, keys] of Object.entries(track.channels)) {
			if (fxParamOfChannel(name) === undefined || !keys?.length) continue;
			const channel = name as CinematicFxParamChannel;
			if (!offered.has(channel) && !out.includes(channel)) out.push(channel);
		}
	}
	return out;
}

/**
 * An `fx:` channel of a node actor at `t`: the keyed value, or where the channel rests while it has
 * no keys — the parameter's default (a bool reads 1 / 0). What the Animate field shows and ◆ keys.
 */
export function fxChannelValue(
	doc: CinematicDoc,
	actorId: string,
	row: FxChannelRow,
	t: number,
): number {
	let value: number | undefined;
	for (const track of tracksOf(doc, actorId)) {
		if (track.kind !== 'property' || !track.channels) continue;
		const v = sampleChannel(track.channels[row.channel], t);
		if (v !== undefined) value = v;
	}
	return value ?? fxParamRest([row.param], row.channel) ?? 0;
}

/** How a timeline drives one node of the screen at time `t` — the player's own inputs. */
export interface TimelineNodeDrive {
	/** The value bindings the keyed channels stand for (`nodeActorBindings`). */
	bindings: ValueBinding[];
	/** The node's channels at `t` (`sampleNodeActor`), and the clip an `animation` strip holds a
	 *  rig node at. */
	sample: NodeActorSample & Pick<CinematicNodeSample, 'animTime'>;
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
		if (bindings.length || sample.tint !== undefined || sample.animTime)
			out.set(nodeId, { bindings, sample });
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
 * Component timelines are left out: their instances play them (`playOn`).
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
		} else if (row.host?.kind === 'component') {
			// A component timeline plays on its instances (`playOn`), not from Flow: a
			// `playCinematic` would mount it with no component to drive.
			continue;
		} else {
			cinematics.push({ id: row.id, label: `Cinematic · ${name}` });
		}
	}
	const byLabel = (a: CinematicPickerOption, b: CinematicPickerOption) =>
		a.label.localeCompare(b.label);
	return [...timelines.sort(byLabel), ...cinematics.sort(byLabel)];
}
