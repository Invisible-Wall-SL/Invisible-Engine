import type { EffectParam, EffectParamValues } from 'engine-fx';
import {
	bindsFxParam,
	boundFxParamValues,
	drivableFxParam,
	evaluateBinding,
	foldBoundTransform,
	nodeFxParamValues,
	placedFxParamValues,
	resolveTransform,
	withNodeActorOutputs,
	type LayoutNode,
	type LayoutType,
	type ResolvedTransform,
	type ValueBinding,
} from 'engine-layout';
import type { OnionFrame, TimelineNodeDrive } from '$lib/timeline/screenTimeline';
import { previewTextShown } from '$lib/timeline/timelineRows';

/**
 * The editor's VALUE-BINDING PREVIEW (Hold and Win Phase 12b): a test input per binding, set by
 * scrubbing in the Properties panel's "Bind to value" section, that the canvas, the text overlay and
 * the rig overlay draw with — so an author sees what the number does before the game ever feeds
 * it. Editor-only and never saved. A binding with no test value draws as authored, exactly as the
 * game draws a node whose source has not reported yet.
 *
 * The inputs are a PLAIN object on purpose: `EditorCanvas.draw()` runs inside several redraw
 * effects, and a reactive read there would make each of them depend on every scrub. The one
 * reactive value is {@link previewVersion}, which the redraw effects read explicitly.
 *
 * Applied in the DRAW paths only — never in the drag / scale / rotate / snap math, which keep
 * reading the authored transform, so a scrubbed offset can never be written into the doc.
 *
 * The TIMELINE PREVIEW (Animate mode, Rive plan Phase 3) rides the same seam: the playhead's
 * sampled node-actor channels join a node's own bindings exactly as `<LayoutNodeView>` joins them
 * in game (`withNodeActorOutputs` + `foldBoundTransform`), so the stage shows what the game plays.
 * Null outside Animate mode ⇒ every node draws as before. A placed effect's parameters (Invisible
 * FX Step 2) come out of the same fold ({@link previewEffectParamValues}), so a test value or a
 * scrubbed `fx:` channel moves the live particles on the stage.
 */
const inputs: Record<string, number> = {};
let drives: Map<string, TimelineNodeDrive> | null = null;
const version = $state({ n: 0 });

const keyOf = (nodeId: string, index: number): string => `${nodeId}#${index}`;

/** Bumped on every preview change — read it in a redraw effect to repaint on a scrub. */
export function previewVersion(): number {
	return version.n;
}

/** The test input of binding `index` on node `nodeId`; `undefined` ⇒ not previewing it. */
export function previewInput(nodeId: string, index: number): number | undefined {
	return inputs[keyOf(nodeId, index)];
}

/** Set (or with `undefined`, clear) one binding's test input. */
export function setPreviewInput(nodeId: string, index: number, value: number | undefined): void {
	const key = keyOf(nodeId, index);
	if (value === undefined || !Number.isFinite(value)) delete inputs[key];
	else inputs[key] = value;
	version.n += 1;
}

/** Clear every test input of a node — its bindings were reordered or removed. */
export function clearNodePreview(nodeId: string): void {
	const prefix = `${nodeId}#`;
	for (const key of Object.keys(inputs)) if (key.startsWith(prefix)) delete inputs[key];
	version.n += 1;
}

let drivesOwner: symbol | null = null;

/**
 * Show (or with `null`, stop showing) a timeline's sampled channels, keyed by node id. `owner`
 * names the panel: a screen's and a component's Timeline panel can both be mounted, and one going
 * quiet must not clear what the other is showing.
 */
export function setTimelinePreview(
	next: Map<string, TimelineNodeDrive> | null,
	owner: symbol | null = null,
): void {
	if (!next && drivesOwner !== owner) return;
	if (!drives && !next) return;
	drives = next;
	drivesOwner = next ? owner : null;
	version.n += 1;
}

/** `node`'s own bindings plus whatever the previewed timeline keys on it. */
export function previewBindings(node: LayoutNode): ValueBinding[] | undefined {
	const drive = drives?.get(node.id);
	return drive?.bindings.length
		? [...(node.valueBindings ?? []), ...drive.bindings]
		: node.valueBindings;
}

/** The previewed timeline's tint for `node` — it wins over a param-bound tint, as in game. */
export function previewTint(node: LayoutNode): number | undefined {
	return drives?.get(node.id)?.sample.tint;
}

/** What the previewed timeline's `text` track makes `node` show; undefined ⇒ its own text. */
export function previewText(node: LayoutNode): string | undefined {
	const drive = drives?.get(node.id);
	return drive ? previewTextShown(node, drive.sample.text, drive.textTo) : undefined;
}

/** The clip and clip-local seconds the previewed timeline's `animation` strip holds `node` at. */
export function previewAnimTime(node: LayoutNode): { animation: string; time: number } | undefined {
	return drives?.get(node.id)?.sample.animTime;
}

/** Each binding's preview output for `node` (`undefined` where nothing is being previewed), in
 *  {@link previewBindings} order. `fxParams` is a placed effect's parameters, which an `fxParam`
 *  binding maps onto. */
export function previewOutputs(
	node: LayoutNode,
	frameCount?: number,
	fxParams?: readonly EffectParam[],
): (number | undefined)[] {
	const bindings = node.valueBindings;
	const own = (bindings ?? []).map((binding, i) => {
		const input = inputs[keyOf(node.id, i)];
		if (input === undefined) return undefined;
		const fxParam =
			binding.target === 'fxParam' ? drivableFxParam(fxParams, binding.fxParam) : undefined;
		return evaluateBinding(binding, input, frameCount, fxParam);
	});
	const drive = drives?.get(node.id);
	return drive?.bindings.length
		? withNodeActorOutputs(bindings, own, drive.bindings, drive.sample)
		: own;
}

/**
 * The parameter values the preview sets on a placed effect (`params`: its declared parameters) —
 * the node's own values (`componentParams`: the enclosing instance's params, which a `params.<id>`
 * binding reads), then its bindings' test values and the previewed timeline's `fx:` channels,
 * through the game's fold (`placedFxParamValues`, `boundFxParamValues`). `undefined` when nothing
 * sets one: the effect draws its defaults.
 */
export function previewEffectParamValues(
	node: LayoutNode,
	params: readonly EffectParam[] | undefined,
	componentParams: Readonly<Record<string, unknown>>,
): EffectParamValues | undefined {
	if (node.kind !== 'effect' || !params?.length) return undefined;
	const placed = placedFxParamValues(node, componentParams, params);
	const bindings = previewBindings(node);
	if (!bindsFxParam(bindings)) return placed;
	return nodeFxParamValues(
		placed,
		boundFxParamValues(bindings, previewOutputs(node, undefined, params), params),
	);
}

let viewHidden: ReadonlySet<string> = new Set();

/**
 * The Outline's Hide / Isolate (Rive plan Phase 9a): the ids the stage skips, from
 * `effectiveHiddenIds`. Editor view state on the same never-saved seam: the draw paths read it
 * through {@link previewResolveTransform}, the doc's own `visible` is never touched. The Screens and
 * Components sides each set theirs while they are on the stage.
 */
export function setViewHidden(ids: ReadonlySet<string>): void {
	if (ids.size === viewHidden.size && [...ids].every((id) => viewHidden.has(id))) return;
	viewHidden = ids;
	version.n += 1;
}

/** The Outline hides (or isolates away) `nodeId` on the stage. */
export function isViewHidden(nodeId: string): boolean {
	return viewHidden.has(nodeId);
}

/** `resolveTransform` with the previewed transform targets folded on — for the draw paths. */
export function previewResolveTransform(
	node: LayoutNode,
	layoutType: LayoutType,
): ResolvedTransform {
	if (viewHidden.has(node.id)) return { ...resolveTransform(node, layoutType), visible: false };
	const folded = foldBoundTransform(
		resolveTransform(node, layoutType),
		previewBindings(node),
		previewOutputs(node),
	);
	const tint = previewTint(node);
	return tint === undefined ? folded : { ...folded, tint };
}

/**
 * The ONION SKIN (Rive plan Phase 9b, editor-only): the timeline sampled a few frames either side
 * of the playhead, which the canvas outlines on the stage. Null ⇒ no ghosts. Owned per panel, as
 * the timeline preview is.
 */
let onion: OnionFrame[] | null = null;
let onionOwner: symbol | null = null;

export function setOnionPreview(next: OnionFrame[] | null, owner: symbol | null = null): void {
	if (!next && onionOwner !== owner) return;
	if (!onion && !next) return;
	onion = next;
	onionOwner = next ? owner : null;
	version.n += 1;
}

/** The ghost frames to outline, nearest first; empty when the onion skin is off. */
export function onionPreview(): readonly OnionFrame[] {
	return onion ?? [];
}

/** `resolveTransform` with ONE ghost frame's drive folded on (only that timeline, no test inputs). */
export function onionResolveTransform(
	node: LayoutNode,
	layoutType: LayoutType,
	drive: TimelineNodeDrive | undefined,
): ResolvedTransform {
	const own = node.valueBindings ?? [];
	if (!drive?.bindings.length) return resolveTransform(node, layoutType);
	return foldBoundTransform(
		resolveTransform(node, layoutType),
		[...own, ...drive.bindings],
		withNodeActorOutputs(
			node.valueBindings,
			own.map(() => undefined),
			drive.bindings,
			drive.sample,
		),
	);
}
