import type { CinematicFxParamChannel } from 'engine-cinematic';
import type { EffectParam } from 'engine-fx';

import { drivableFxParams, fxParamChannel, fxParamOfChannel } from './fxNodeParams';
import type { CinematicCast, CinematicDoc, LayoutNode, Scene, ValueBinding } from './types';

/**
 * Timeline NODE ACTORS (Rive plan §3.1–3.2, `docs/design/rive-style-editor.md`) — the pure half:
 * which Scene a timeline animates, which node each actor drives, what each node kind can take, and
 * the switch-key strings a timeline uses. Svelte-free, so the launcher (harvest, validation) and
 * the `<Cinematic>` player read the same answers. Sampling lives in `engine-cinematic`.
 */

/** A track, as loosely as the document stores it. */
type LooseTrack = Record<string, unknown> & { actorId?: unknown; kind?: unknown };

/** The fixed channels a node actor can key: the `property` channels, the text track, visibility
 *  and — on a rig node — the clip an `animation` strip holds it at (`animTime`, Rive plan Phase 8a).
 *  The one list every allowlist below derives from. */
export const NODE_ACTOR_CHANNELS = [
	'x',
	'y',
	'scale',
	'scaleX',
	'scaleY',
	'rotation',
	'alpha',
	'tint',
	'frame',
	'fill',
	'text',
	'visible',
	'animTime',
] as const;

/** A node actor channel: a fixed one, or `fx:<param id>` on an effect node (Invisible FX Step 2). */
export type NodeActorChannel = (typeof NODE_ACTOR_CHANNELS)[number] | CinematicFxParamChannel;

const TRANSFORM = NODE_ACTOR_CHANNELS.filter(
	(c) => c !== 'tint' && c !== 'frame' && c !== 'fill' && c !== 'text' && c !== 'animTime',
);

/**
 * The channels a node of `kind` honours — the same reach as its value bindings: `tint` where the
 * node draws a tinted texture, `frame` on a flipbook's own clip, `fill` where a reveal mask exists,
 * `text` on a text node, and on an effect node one `fx:<id>` per number or bool parameter of the
 * placed effect (`fxParams`, its `EffectDoc.params`).
 */
export function nodeActorChannelsForKind(
	kind: LayoutNode['kind'],
	fxParams?: readonly EffectParam[],
): NodeActorChannel[] {
	if (kind === 'sprite') return [...TRANSFORM, 'tint', 'fill'];
	if (kind === 'flipbook') return [...TRANSFORM, 'tint', 'frame', 'fill'];
	if (kind === 'rect') return [...TRANSFORM, 'fill'];
	if (kind === 'text') return [...TRANSFORM, 'text'];
	if (kind === 'spine') return [...TRANSFORM, 'animTime'];
	if (kind === 'effect')
		return [...TRANSFORM, ...drivableFxParams(fxParams).map((p) => fxParamChannel(p.id))];
	return [...TRANSFORM];
}

export const isNodeActorCast = (cast: CinematicCast | undefined): boolean => cast?.kind === 'node';

/**
 * The Scene a cinematic mounts as its set: a `screen` host's scene, else the cast stage's bound
 * `sceneId` (every document before hosts). One answer for the game and the tools.
 */
export function cinematicSetSceneId(doc: CinematicDoc): string | null {
	const host = doc.host;
	if (host?.kind === 'screen' && typeof host.sceneId === 'string' && host.sceneId) {
		return host.sceneId;
	}
	return doc.stage?.sceneId ?? null;
}

const childrenOf = (node: LayoutNode): LayoutNode[] => {
	const children = (node as { children?: LayoutNode[] }).children;
	return Array.isArray(children) ? children : [];
};

/**
 * The node a node actor targets: the first node (depth-first, in paint order) whose `label` is
 * `name`, else the first whose `id` is. Names are what make a timeline reusable across hosts;
 * the id fallback covers nodes nobody named. Nodes inside a placed component's definition are not
 * the screen's and are never matched.
 */
export function findNodeByName(nodes: LayoutNode[], name: string): LayoutNode | undefined {
	if (!name) return undefined;
	let byId: LayoutNode | undefined;
	const walk = (list: LayoutNode[]): LayoutNode | undefined => {
		for (const node of list) {
			if (node.label === name) return node;
			if (!byId && node.id === name) byId = node;
			const hit = walk(childrenOf(node));
			if (hit) return hit;
		}
		return undefined;
	};
	return walk(nodes) ?? byId;
}

/**
 * The node `doc`'s actor targeting `name` drives in `nodes`. A COMPONENT timeline binds by name
 * only, never by id: it is reused on other components and screens (plan §3.3), where a node id
 * means nothing, so an unnamed node is never bound. A screen timeline keeps
 * {@link findNodeByName}'s id fallback, which the screens authored before names relied on.
 */
export function findActorNode(
	doc: CinematicDoc,
	nodes: LayoutNode[],
	name: string,
): LayoutNode | undefined {
	if (doc.host?.kind !== 'component') return findNodeByName(nodes, name);
	const hit = findNodeByName(nodes, name);
	return hit?.label === name ? hit : undefined;
}

/** The tracks one actor owns. */
function tracksOf(doc: CinematicDoc, actorId: string): LooseTrack[] {
	return (doc.tracks as LooseTrack[]).filter((t) => t && t.actorId === actorId);
}

export interface ResolvedNodeActor {
	actorId: string;
	node: LayoutNode;
	tracks: LooseTrack[];
}

/**
 * Every node actor of `doc` bound to its node in `scene`, keyed by NODE ID. An actor whose node is
 * missing is left out: the player skips it, and {@link validateNodeActors} reports it.
 *
 * A `screen`-hosted timeline binds only on its own screen. A `component`-hosted one binds by name
 * on whatever node list it is handed — its own def's root, another component's (`playOnComponents`)
 * or a screen — which is what makes it reusable (plan §3.3). A `cast` host binds none.
 */
export function resolveNodeActors(
	doc: CinematicDoc,
	scene: Scene | undefined,
): Map<string, ResolvedNodeActor> {
	const out = new Map<string, ResolvedNodeActor>();
	if (!scene) return out;
	const host = doc.host;
	const binds =
		(host?.kind === 'screen' && host.sceneId === scene.id) || host?.kind === 'component';
	if (!binds) return out;
	for (const cast of doc.stage?.cast ?? []) {
		if (!isNodeActorCast(cast) || typeof cast.target !== 'string') continue;
		const node = findActorNode(doc, scene.nodes, cast.target);
		if (!node || out.has(node.id)) continue;
		out.set(node.id, { actorId: cast.actorId, node, tracks: tracksOf(doc, cast.actorId) });
	}
	return out;
}

/** The node channels a set of tracks keys (property channels, a text track, visibility keys). */
export function keyedNodeChannels(tracks: LooseTrack[]): Set<NodeActorChannel> {
	const out = new Set<NodeActorChannel>();
	for (const track of tracks) {
		if (track.kind === 'property' && track.channels && typeof track.channels === 'object') {
			for (const [name, keys] of Object.entries(track.channels as Record<string, unknown>)) {
				if (Array.isArray(keys) && keys.length) out.add(name as NodeActorChannel);
			}
		} else if (track.kind === 'text' && Array.isArray(track.keys) && track.keys.length) {
			out.add('text');
		} else if (track.kind === 'visibility' && Array.isArray(track.keys) && track.keys.length) {
			out.add('visible');
		} else if (track.kind === 'animation' && Array.isArray(track.strips)) {
			// A strip with a clip holds the rig node's clip; an empty strip keys nothing.
			const strips = track.strips as { clip?: { name?: unknown } | null }[];
			if (strips.some((strip) => typeof strip?.clip?.name === 'string' && strip.clip.name)) {
				out.add('animTime');
			}
		}
	}
	return out;
}

/** The strings a text node offers a `switchKey` track: its own `text`, then its `switchKeys`. */
export function textNodeStrings(node: LayoutNode): string[] {
	if (node.kind !== 'text') return [];
	return [node.text, ...(node.switchKeys ?? [])].filter((s) => typeof s === 'string');
}

/** Resolves a placed effect's doc by id — enough of it to read its exposed parameters. */
export type EffectResolver = (effectId: string) => { params?: readonly EffectParam[] } | undefined;

export interface NodeActorIssue {
	actorId: string;
	code:
		| 'node-missing'
		| 'channel-unsupported'
		| 'switch-key-undeclared'
		| 'no-target'
		| 'target-duplicate'
		| 'text-track-duplicate'
		| 'fx-param-unknown';
	message: string;
}

/**
 * What would silently do nothing at runtime: an actor with no target, a target no node in the host
 * carries, a channel the node's kind cannot take, a switch-key naming a string the text node does
 * not declare, and an `fx:<id>` channel naming a parameter the placed effect does not declare as a
 * number or bool. The player skips all of these rather than failing, so this is where they show.
 * `effects` resolves a placed effect, for the caller's own project (the editor passes the effects
 * it loaded); an effect it does not know leaves its `fx:` channels unchecked. The default knows
 * none: validation never reads a process-wide registry, which on a server holds no one project.
 */
export function validateNodeActors(
	doc: CinematicDoc,
	scene: Scene | undefined,
	effects: EffectResolver = () => undefined,
): NodeActorIssue[] {
	const issues: NodeActorIssue[] = [];
	const driven = new Map<string, string>();
	for (const cast of doc.stage?.cast ?? []) {
		if (!isNodeActorCast(cast)) continue;
		const actorId = cast.actorId;
		if (typeof cast.target !== 'string' || !cast.target) {
			issues.push({ actorId, code: 'no-target', message: `Actor "${actorId}" names no node.` });
			continue;
		}
		const node = scene ? findActorNode(doc, scene.nodes, cast.target) : undefined;
		if (!node) {
			issues.push({
				actorId,
				code: 'node-missing',
				message: `No node named "${cast.target}" in ${scene ? `"${scene.name || scene.id}"` : 'the host'}.`,
			});
			continue;
		}
		const owner = driven.get(node.id);
		if (owner) {
			issues.push({
				actorId,
				code: 'target-duplicate',
				message: `"${cast.target}" is already driven by actor "${owner}"; this actor is skipped.`,
			});
			continue;
		}
		driven.set(node.id, actorId);
		const tracks = tracksOf(doc, actorId);
		if (tracks.filter((t) => t.kind === 'text').length > 1) {
			issues.push({
				actorId,
				code: 'text-track-duplicate',
				message: `"${cast.target}" has more than one text track; only the last one plays.`,
			});
		}
		const effect = node.kind === 'effect' ? effects(node.effectId) : undefined;
		const allowed = new Set(nodeActorChannelsForKind(node.kind, effect?.params));
		for (const channel of keyedNodeChannels(tracks)) {
			if (allowed.has(channel)) continue;
			const fxParam = fxParamOfChannel(channel);
			if (node.kind === 'effect' && fxParam !== undefined) {
				if (!effect) continue;
				issues.push({
					actorId,
					code: 'fx-param-unknown',
					message: `"${cast.target}" plays effect "${node.effectId}", which has no number or on/off parameter "${fxParam}"; its "${channel}" keys do nothing.`,
				});
				continue;
			}
			issues.push({
				actorId,
				code: 'channel-unsupported',
				message: `"${cast.target}" is a ${node.kind} node and cannot take the "${channel}" channel.`,
			});
		}
		const offered = new Set(textNodeStrings(node));
		for (const key of switchKeysOf(tracks)) {
			if (offered.has(key)) continue;
			issues.push({
				actorId,
				code: 'switch-key-undeclared',
				message: `"${cast.target}" does not declare the string "${key}".`,
			});
		}
	}
	return issues;
}

function switchKeysOf(tracks: LooseTrack[]): string[] {
	const out: string[] = [];
	for (const track of tracks) {
		if (track.kind !== 'text' || track.mode !== 'switchKey' || !Array.isArray(track.keys)) continue;
		for (const k of track.keys as { key?: unknown }[]) {
			if (typeof k?.key === 'string' && !out.includes(k.key)) out.push(k.key);
		}
	}
	return out;
}

/**
 * Every string a cinematic's `switchKey` text tracks name, with the node it switches — what the
 * Localization harvest lists as `timeline` rows, so a key used only in an animation is never left
 * untranslated (Rive plan §8).
 */
export function collectTimelineSwitchKeys(
	doc: CinematicDoc,
): { key: string; actorId: string; target: string }[] {
	const out: { key: string; actorId: string; target: string }[] = [];
	for (const cast of doc.stage?.cast ?? []) {
		if (!isNodeActorCast(cast)) continue;
		for (const key of switchKeysOf(tracksOf(doc, cast.actorId))) {
			out.push({ key, actorId: cast.actorId, target: cast.target ?? cast.actorId });
		}
	}
	return out;
}

/** A node actor's sampled channels — structurally `engine-cinematic`'s `CinematicNodeSample`. */
export interface NodeActorSample {
	x?: number;
	y?: number;
	scaleX?: number;
	scaleY?: number;
	rotation?: number;
	alpha?: number;
	tint?: number;
	frame?: number;
	fill?: number;
	visible?: boolean;
	[fxParam: CinematicFxParamChannel]: number | undefined;
}

/**
 * The value bindings a node actor's keyed channels stand for. The timeline drives a node through
 * the SAME fold its own value bindings use (offsets add, scales and alpha multiply, rotation adds
 * degrees, `visible` hides, `fill` reveals, `frame` holds, an `fx:<id>` channel sets that effect
 * parameter), so the two can never disagree about what a number does to a node. `tint` and `text`
 * are not bindings; the node reads those directly.
 */
export function nodeActorBindings(channels: ReadonlySet<NodeActorChannel>): ValueBinding[] {
	const out: ValueBinding[] = [];
	for (const target of ['x', 'y', 'rotation', 'alpha', 'visible', 'fill', 'frame'] as const) {
		if (channels.has(target)) out.push({ target });
	}
	if (channels.has('scale') || channels.has('scaleX') || channels.has('scaleY')) {
		out.push({ target: 'scaleX' }, { target: 'scaleY' });
	}
	for (const channel of channels) {
		const fxParam = fxParamOfChannel(channel);
		if (fxParam !== undefined) out.push({ target: 'fxParam', fxParam });
	}
	return out;
}

/**
 * A driven node's outputs: its OWN bindings' outputs, padded by index to one per binding, then the
 * timeline's. Padding matters: a smoothed binding's outputs start empty and fill in an effect, and
 * without it the timeline's first-frame values would land on the node's own bindings.
 */
export function withNodeActorOutputs(
	own: readonly ValueBinding[] | undefined,
	ownOutputs: readonly (number | undefined)[],
	actorBindings: readonly ValueBinding[],
	sample: NodeActorSample | undefined,
): (number | undefined)[] {
	return [...(own ?? []).map((_, i) => ownOutputs[i]), ...nodeActorOutputs(actorBindings, sample)];
}

/** {@link nodeActorBindings}' outputs for one sample, in the same order. */
export function nodeActorOutputs(
	bindings: readonly ValueBinding[],
	sample: NodeActorSample | undefined,
): (number | undefined)[] {
	return bindings.map(({ target, fxParam }) => {
		if (!sample) return undefined;
		if (target === 'visible') return sample.visible === undefined ? undefined : +sample.visible;
		const value =
			target === 'fxParam'
				? fxParam
					? sample[fxParamChannel(fxParam)]
					: undefined
				: sample[target as keyof Omit<NodeActorSample, 'visible' | CinematicFxParamChannel>];
		return typeof value === 'number' ? value : undefined;
	});
}
