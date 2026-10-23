import {
	cuesCrossed,
	pingPongCuesCrossed,
	sampleChannel,
	sampleNodeActor,
	sampleTint,
	trackLayout,
	type CinematicElementFxChannel,
	type CinematicFxParamChannel,
	type CinematicNodeSample,
	type CinematicStrip,
	type CinematicTrack,
} from 'engine-cinematic';
import {
	ELEMENT_FX_CHANNEL_PREFIX,
	ELEMENT_FX_LIMITS,
	elementFxChannels,
	elementFxOfChannel,
	elementFxSpec,
	type ElementFxEntry,
} from 'constants-shared/elementFx';
import type { EffectParam, EffectParamValues } from 'engine-fx';
import {
	componentTriggers,
	drivableFxParams,
	findNodeByName,
	fxParamChannel,
	fxParamOfChannel,
	fxParamRest,
	keyableElementFxEntries,
	keyedNodeChannels,
	nodeActorBindings,
	nodeActorChannelsForKind,
	resolveNodeActors,
	screenCueSignal,
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

/**
 * A copy of a screen or component timeline (the Animations list's *Duplicate*, Phase 9c): every
 * track, key and setting, under a fresh id on the same host and the name "<name> copy" (" copy 2",
 * … when taken by another timeline of `names`).
 */
export function duplicateTimeline(
	doc: CinematicDoc,
	taken: Iterable<string>,
	names: Iterable<string> = [],
): CinematicDoc {
	const usedNames = new Set(names);
	let name = `${doc.name || doc.id} copy`;
	for (let i = 2; usedNames.has(name); i++) name = `${doc.name || doc.id} copy ${i}`;
	const host = doc.host;
	const id =
		host?.kind === 'component'
			? componentTimelineId(host.componentId, name, taken)
			: screenTimelineId(host?.kind === 'screen' ? host.sceneId : doc.id, name, taken);
	const copy = JSON.parse(JSON.stringify(doc)) as CinematicDoc;
	return { ...copy, id, name };
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
 * `actorId`'s property tracks that key ratio `layout` (a screen ratio's own keys, `keysLayout`), or
 * the default keys when `layout` is absent: what that ratio plays, and what Animate edits there.
 */
const propertyTracksOf = (
	doc: CinematicDoc,
	actorId: string,
	layout: string | undefined,
): CinematicTrack[] =>
	tracksOf(doc, actorId).filter(
		(t) => t.kind === 'property' && !!t.channels && trackLayout(t) === layout,
	);

/** The default keys of `doc`'s node actors: the property tracks a ratio copies to key apart. */
export function defaultNodeKeyTracks(doc: CinematicDoc): CinematicDoc['tracks'] {
	const nodeActors = new Set(doc.stage.cast.filter((c) => c.kind === 'node').map((c) => c.actorId));
	return doc.tracks.filter(
		(t) =>
			t.kind === 'property' &&
			trackLayout(t) === undefined &&
			typeof t.actorId === 'string' &&
			nodeActors.has(t.actorId),
	);
}

/**
 * Give screen ratio `layout` keys of its own (per-ratio keys): a copy of every default property
 * track of a node actor, carrying `layout`, so the ratio starts from the moves it plays now and
 * every edit after changes that ratio alone. Returns the tracks to add, none when nothing is keyed.
 */
export function ratioKeyTracks(doc: CinematicDoc, layout: string): Record<string, unknown>[] {
	return defaultNodeKeyTracks(doc).map((t) => ({
		...structuredClone(t),
		id: `${String(t.id)}_${layout}`,
		layout,
	}));
}

/** `doc` without screen ratio `layout`'s own keys: that ratio plays the default keys again. */
export function withoutRatioKeys(doc: CinematicDoc, layout: string): CinematicDoc['tracks'] {
	return doc.tracks.filter((t) => !(t.kind === 'property' && trackLayout(t) === layout));
}

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
	layout?: string,
): number {
	let value: number | undefined;
	for (const track of propertyTracksOf(doc, actorId, layout)) {
		const keys = track.channels?.[channel];
		const v = channel === 'tint' ? sampleTint(keys, t) : sampleChannel(keys, t);
		if (v !== undefined) value = v;
	}
	return value ?? NODE_IDENTITY[channel];
}

/** Does `actorId` key `channel` (a {@link KeyedChannel}, or an effect's `fx:<id>`) in `layout`'s
 *  keys (absent ⇒ the default keys)? */
export function isChannelKeyed(
	doc: CinematicDoc,
	actorId: string,
	channel: string,
	layout?: string,
): boolean {
	return propertyTracksOf(doc, actorId, layout).some((t) => !!t.channels?.[channel]?.length);
}

/**
 * A key button's state (Rive plan Phase 9b): `none` — the channel is not animated (grey); `animated`
 * — it has keys, none at the playhead (blue outline); `key` — a key sits on the playhead's frame
 * (blue fill), so typing a value there edits that key.
 */
export type KeyState = 'none' | 'animated' | 'key';

/** `channel`'s key-button state on `actorId` at `t` (a key within half a frame of `t` is "at" it). */
export function channelKeyState(
	doc: CinematicDoc,
	actorId: string | null,
	channel: string,
	t: number,
	layout?: string,
): KeyState {
	if (!actorId) return 'none';
	const near = 0.5 / (doc.fps || 30);
	let keyed = false;
	for (const track of propertyTracksOf(doc, actorId, layout)) {
		const keys = track.channels?.[channel];
		if (!keys?.length) continue;
		keyed = true;
		if (keys.some((k) => Math.abs(k.time - t) < near)) return 'key';
	}
	return keyed ? 'animated' : 'none';
}

/** A node's Design pose, in the units Properties shows (rotation in degrees). */
export interface DesignPose {
	x: number;
	y: number;
	rotation: number;
	alpha: number;
	tint: number;
}

/**
 * What Properties shows for a node channel in Animate: the ANIMATED value — the Design pose with
 * the timeline's relative channel folded on, as the game draws it. `scale` stays the multiplier
 * (a node's own scale may differ per axis), and `tint` is the keyed colour, else the node's own.
 */
export function shownChannelValue(
	channel: KeyedChannel,
	relative: number,
	pose: DesignPose,
	keyed: boolean,
): number {
	switch (channel) {
		case 'x':
			return pose.x + relative;
		case 'y':
			return pose.y + relative;
		case 'rotation':
			return pose.rotation + relative;
		case 'alpha':
			return pose.alpha * relative;
		case 'tint':
			return keyed ? relative : pose.tint;
		default:
			return relative;
	}
}

/** The relative channel value a value typed into Properties keys — {@link shownChannelValue}'s inverse. */
export function relativeChannelValue(
	channel: KeyedChannel,
	shown: number,
	pose: DesignPose,
): number {
	switch (channel) {
		case 'x':
			return shown - pose.x;
		case 'y':
			return shown - pose.y;
		case 'rotation':
			return shown - pose.rotation;
		case 'alpha':
			// A node authored invisible has no multiplier that shows it; key the value itself.
			return pose.alpha !== 0 ? shown / pose.alpha : shown;
		default:
			return shown;
	}
}

/** A stage drag in Animate, as the canvas measured it on the Design pose: what to key. */
export interface StageTransformDelta {
	nodeId: string;
	/** Design px moved. */
	dx?: number;
	dy?: number;
	/** The scale ratio (new ÷ start). */
	scale?: number;
	/** Degrees turned. */
	rotation?: number;
}

/**
 * The relative values a stage drag keys on a node actor at `t`: each channel the drag changed, on
 * top of what the timeline already sets there — so dragging a node that is mid-move keys where it
 * now draws.
 */
export function stageDragKeys(
	doc: CinematicDoc,
	actorId: string | null,
	delta: StageTransformDelta,
	t: number,
	channels: readonly KeyedChannel[],
	layout?: string,
): Partial<Record<KeyedChannel, number>> {
	const at = (c: KeyedChannel): number =>
		actorId ? nodeChannelValue(doc, actorId, c, t, layout) : NODE_IDENTITY[c];
	const out: Partial<Record<KeyedChannel, number>> = {};
	const allowed = new Set(channels);
	const tiny = 1e-6;
	if (delta.dx !== undefined && Math.abs(delta.dx) > tiny && allowed.has('x'))
		out.x = at('x') + delta.dx;
	if (delta.dy !== undefined && Math.abs(delta.dy) > tiny && allowed.has('y'))
		out.y = at('y') + delta.dy;
	if (
		delta.scale !== undefined &&
		Number.isFinite(delta.scale) &&
		Math.abs(delta.scale - 1) > tiny &&
		allowed.has('scale')
	)
		out.scale = at('scale') * delta.scale;
	if (delta.rotation !== undefined && Math.abs(delta.rotation) > tiny && allowed.has('rotation'))
		out.rotation = at('rotation') + delta.rotation;
	return out;
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
	layout?: string,
): CinematicFxParamChannel[] {
	const offered = new Set(drivableFxParams(params).map((p) => fxParamChannel(p.id)));
	const out: CinematicFxParamChannel[] = [];
	for (const track of propertyTracksOf(doc, actorId, layout)) {
		for (const [name, keys] of Object.entries(track.channels ?? {})) {
			if (fxParamOfChannel(name) === undefined || !keys?.length) continue;
			const channel = name as CinematicFxParamChannel;
			if (!offered.has(channel) && !out.includes(channel)) out.push(channel);
		}
	}
	return out;
}

/** One Timeline row a node actor gets beyond the shared channels, on a placed effect. */
export interface FxTimelineRow {
	channel: CinematicFxParamChannel;
	label: string;
	/** Keyed, but not a number or on/off parameter the effect declares: its keys do nothing. */
	stale: boolean;
}

/**
 * The Timeline rows of a node actor targeting `node`, beyond the shared channels. On a placed
 * effect (`effect`: its doc, `undefined` while it is not loaded): one per number or on/off
 * parameter, then every `fx:` channel the actor keys that is not one of them — also when the effect
 * declares no parameters at all — so stale keys can always be found and removed. While the effect
 * is not loaded, every keyed `fx:` channel is listed as it is. Nothing on any other node.
 */
export function fxTimelineRows(
	doc: CinematicDoc,
	actorId: string,
	node: LayoutNode,
	effect: { params?: readonly EffectParam[] } | undefined,
	layout?: string,
): FxTimelineRow[] {
	if (node.kind !== 'effect') return [];
	if (!effect) {
		return staleFxChannels(doc, actorId, [], layout).map((channel) => ({
			channel,
			label: `⚡ ${fxParamOfChannel(channel)}`,
			stale: false,
		}));
	}
	const params = effect.params ?? [];
	return [
		...keyableFxChannels(node, params).map((row) => ({
			channel: row.channel,
			label: `⚡ ${row.param.id}`,
			stale: false,
		})),
		...staleFxChannels(doc, actorId, params, layout).map((channel) => ({
			channel,
			label: `⚠ ${channel}`,
			stale: true,
		})),
	];
}

/**
 * An `fx:` channel of a node actor at `t`: the keyed value, or where the channel rests while it has
 * no keys — the value the node sets itself (`placed`), else the parameter's default (a bool reads
 * 1 / 0), as the game's blend rests it. What the Animate field shows and ◆ keys.
 */
export function fxChannelValue(
	doc: CinematicDoc,
	actorId: string,
	row: FxChannelRow,
	t: number,
	placed?: EffectParamValues,
	layout?: string,
): number {
	let value: number | undefined;
	for (const track of propertyTracksOf(doc, actorId, layout)) {
		const v = sampleChannel(track.channels?.[row.channel], t);
		if (v !== undefined) value = v;
	}
	return value ?? fxParamRest([row.param], row.channel, placed) ?? 0;
}

/** One channel of a node's `keyed` Element FX entry, as Animate mode keys it. */
export interface ElementFxChannelRow {
	channel: CinematicElementFxChannel;
	entry: ElementFxEntry;
	/** `progress` (`efx:<id>`): 0 = at rest … 1 = the effect's end. `intensity`
	 *  (`efx:<id>:intensity`): a multiplier of the entry's strength. */
	value: 'progress' | 'intensity';
	label: string;
	min: number;
	max: number;
	/** Where the channel rests while it has no keys, as the game's blend rests it. */
	rest: number;
}

/**
 * The Element FX channels Animate mode offers on a node the game draws itself (any kind but the
 * reel grid, whose effects play on the reel stack, which nothing poses): the two
 * `elementFxChannels` of each enabled `keyed` entry of its own — how far through the effect it is,
 * then its strength — labelled by the effect's kind. A strength row names its entry when two keyed
 * entries share a kind.
 */
export function keyableElementFxChannels(node: LayoutNode): ElementFxChannelRow[] {
	const keyed = keyableElementFxEntries(node);
	return keyed.flatMap((entry) => {
		const kind = elementFxSpec(entry.kind).label;
		const shared = keyed.some((other) => other !== entry && other.kind === entry.kind);
		return elementFxChannels([entry]).map((name): ElementFxChannelRow => {
			const channel = name as CinematicElementFxChannel;
			return elementFxOfChannel(name)?.value === 'progress'
				? {
						channel,
						entry,
						value: 'progress',
						label: `✦ ${kind} (${entry.id})`,
						min: 0,
						max: 1,
						rest: 0,
					}
				: {
						channel,
						entry,
						value: 'intensity',
						label: shared ? `✦ ${kind} strength (${entry.id})` : `✦ ${kind} strength`,
						min: ELEMENT_FX_LIMITS.intensity.min,
						max: ELEMENT_FX_LIMITS.intensity.max,
						rest: 1,
					};
		});
	});
}

/** The `efx:` channels `actorId` keys that are not one of `node`'s keyed entries' any more (the
 *  entry was removed, turned off or given another trigger) — rows the Timeline still lists so their
 *  keys can be found and removed. */
export function staleElementFxChannels(
	doc: CinematicDoc,
	actorId: string,
	node: LayoutNode,
	layout?: string,
): CinematicElementFxChannel[] {
	const offered = new Set(elementFxChannels(keyableElementFxEntries(node)));
	const out: CinematicElementFxChannel[] = [];
	for (const track of propertyTracksOf(doc, actorId, layout)) {
		for (const [name, keys] of Object.entries(track.channels ?? {})) {
			if (!name.startsWith(ELEMENT_FX_CHANNEL_PREFIX) || !keys?.length) continue;
			const channel = name as CinematicElementFxChannel;
			if (!offered.has(channel) && !out.includes(channel)) out.push(channel);
		}
	}
	return out;
}

/** One Timeline row a node actor gets for its Element FX. */
export interface ElementFxTimelineRow {
	channel: CinematicElementFxChannel;
	label: string;
	/** Keyed, but no keyed entry of the node's: its keys do nothing. */
	stale: boolean;
}

/** The Timeline rows of a node actor targeting `node` for its Element FX: each keyable channel, then
 *  every `efx:` channel the actor keys that is not one of them (⚠). */
export function elementFxTimelineRows(
	doc: CinematicDoc,
	actorId: string,
	node: LayoutNode,
	layout?: string,
): ElementFxTimelineRow[] {
	return [
		...keyableElementFxChannels(node).map((row) => ({
			channel: row.channel,
			label: row.label,
			stale: false,
		})),
		...staleElementFxChannels(doc, actorId, node, layout).map((channel) => ({
			channel,
			label: `⚠ ${channel}`,
			stale: true,
		})),
	];
}

/** An Element FX channel of a node actor at `t`: the keyed value, else where it rests. */
export function elementFxChannelValue(
	doc: CinematicDoc,
	actorId: string,
	row: ElementFxChannelRow,
	t: number,
	layout?: string,
): number {
	let value: number | undefined;
	for (const track of propertyTracksOf(doc, actorId, layout)) {
		const v = sampleChannel(track.channels?.[row.channel], t);
		if (v !== undefined) value = v;
	}
	return value ?? row.rest;
}

/** Whether a node sample poses a keyed Element FX (carries an `efx:` channel). */
export function posesElementFx(sample: object): boolean {
	return Object.keys(sample).some((key) => key.startsWith(ELEMENT_FX_CHANNEL_PREFIX));
}

/** How a timeline drives one node of the screen at time `t` — the player's own inputs. */
export interface TimelineNodeDrive {
	/** The value bindings the keyed channels stand for (`nodeActorBindings`). */
	bindings: ValueBinding[];
	/** The node's channels at `t` (`sampleNodeActor`), and the clip an `animation` strip holds a
	 *  rig node at. */
	sample: NodeActorSample & Pick<CinematicNodeSample, 'animTime' | 'text'>;
	/** The value source a count-up's keys are shares of (its text track's `to`). */
	textTo?: string;
}

/**
 * Every node `doc` drives on `scene` at `t`, keyed by node id: exactly the inputs
 * `<LayoutNodeView>` folds in game (`resolveNodeActors` → `keyedNodeChannels` →
 * `nodeActorBindings`, sampled by `sampleNodeActor`), so the editor previews what the game plays.
 * `layout` picks the property keys as the game does (`keysLayout`); absent ⇒ the default keys.
 */
export function timelineDrives(
	doc: CinematicDoc,
	scene: Scene | undefined,
	t: number,
	layout?: string,
): Map<string, TimelineNodeDrive> {
	const out = new Map<string, TimelineNodeDrive>();
	for (const [nodeId, actor] of resolveNodeActors(doc, scene)) {
		const bindings = nodeActorBindings(keyedNodeChannels(actor.tracks));
		const sample = sampleNodeActor(actor.tracks as unknown as CinematicTrack[], t, layout);
		if (
			bindings.length ||
			sample.tint !== undefined ||
			sample.animTime ||
			sample.text ||
			posesElementFx(sample)
		) {
			const to = actor.tracks.filter((tr) => tr.kind === 'text').pop()?.to;
			out.set(
				nodeId,
				typeof to === 'string' ? { bindings, sample, textTo: to } : { bindings, sample },
			);
		}
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

/** One onion-skin ghost: `offset` frames from the playhead, and what the timeline drives there. */
export interface OnionFrame {
	offset: number;
	time: number;
	drives: Map<string, TimelineNodeDrive>;
}

/**
 * The onion skin's ghosts (Rive plan Phase 9b, editor-only): `count` frames before and after `t`,
 * each `step` frames apart, inside the timeline and never at `t` itself. Nearest first, so a
 * renderer can fade them by distance.
 */
export function onionFrames(
	doc: CinematicDoc,
	scene: Scene | undefined,
	t: number,
	count: number,
	step = 1,
	layout?: string,
): OnionFrame[] {
	const out: OnionFrame[] = [];
	const frame = 1 / (doc.fps || 30);
	const n = Math.max(0, Math.min(Math.floor(count), 10));
	for (let i = 1; i <= n; i++) {
		for (const sign of [-1, 1]) {
			const offset = sign * i * Math.max(1, Math.floor(step));
			const time = t + offset * frame;
			if (time < -1e-9 || time > doc.duration + 1e-9) continue;
			out.push({ offset, time, drives: timelineDrives(doc, scene, time, layout) });
		}
	}
	return out;
}

/** An _On cue_ Element FX entry on a screen, the screen's own or one of its nodes'. */
export interface ScreenCueFx {
	target: { kind: 'node'; id: string } | { kind: 'screen'; sceneId: string };
	entry: ElementFxEntry;
	/** Where it sits, for a label: the node's name, or `screen`. */
	where: string;
}

/** Every enabled _On cue_ Element FX entry with a cue on `scene`: the screen's, then its nodes'. */
export function screenOnCueFx(scene: Scene): ScreenCueFx[] {
	const out: ScreenCueFx[] = [];
	const add = (entries: ElementFxEntry[] | undefined, at: Omit<ScreenCueFx, 'entry'>): void => {
		for (const entry of entries ?? []) {
			if (!entry.disabled && entry.trigger === 'cue' && entry.cue) out.push({ ...at, entry });
		}
	};
	add(scene.elementFx, { target: { kind: 'screen', sceneId: scene.id }, where: 'screen' });
	const walk = (nodes: LayoutNode[]): void => {
		for (const node of nodes) {
			add(node.elementFx, { target: { kind: 'node', id: node.id }, where: node.label || node.id });
			const children = (node as { children?: LayoutNode[] }).children;
			if (Array.isArray(children)) walk(children);
		}
	};
	walk(scene.nodes);
	return out;
}

/** The _On cue_ Element FX a screen timeline's `cue` plays (`screenCueSignal`, as in game). */
export function screenCueFx(scene: Scene, cue: string): ScreenCueFx[] {
	const signal = screenCueSignal(cue);
	return signal ? screenOnCueFx(scene).filter((fx) => fx.entry.cue === signal) : [];
}

/** The cue inspector's suggestions: each _On cue_ Element FX name on `scene` as the `signal:` cue
 *  that plays it, with what it plays where. */
export function elementFxCueSuggestions(scene: Scene): { cue: string; label: string }[] {
	const byCue = new Map<string, string[]>();
	for (const fx of screenOnCueFx(scene)) {
		const name = elementFxSpec(fx.entry.kind)?.label ?? fx.entry.kind;
		const cue = `signal:${fx.entry.cue}`;
		byCue.set(cue, [...(byCue.get(cue) ?? []), `${name} on ${fx.where}`]);
	}
	return [...byCue].map(([cue, labels]) => ({ cue, label: labels.join(', ') }));
}

/**
 * The cue keys an editor playback crosses as its clock moves from `fromElapsed` to `toElapsed`
 * seconds since ▶, stepped as the game's `<Cinematic>` steps: a ping-pong on its lap clock
 * (`pingPongCuesCrossed`), anything else from the wrapped playhead (`cuesCrossed`), so a loop's
 * wrap and a stalled frame skip what they skip in game.
 */
export function playbackCuesCrossed<K extends { time: number }>(
	keys: K[],
	loop: CinematicDoc['loop'],
	fromElapsed: number,
	toElapsed: number,
	duration: number,
): K[] {
	if (!keys.length || !(duration > 0)) return [];
	const dt = toElapsed - fromElapsed;
	if (loop === 'pingPong') {
		const lap = fromElapsed % (2 * duration);
		return pingPongCuesCrossed(keys, lap, lap + dt, duration);
	}
	const from = loop === 'loop' ? fromElapsed % duration : fromElapsed;
	return cuesCrossed(keys, from, from + dt);
}
