import {
	ComponentStateMachineRunner,
	componentInputs,
	foldBoundTransform,
	nodeActorOutputs,
	type CinematicDoc,
	type ComponentDef,
	type LayoutNode,
	type NodeOverride,
} from 'engine-layout';

import type { TimelineNodeDrive } from './screenTimeline';
import { playerDrives, previewPlayer } from './stateMachinePreview';

/**
 * A count-mode repeater's SEGMENT PREVIEW: each segment drawn at the pose its state machine settles
 * on for that segment's inputs (`value` vs its `index`), so the canvas shows which segments are lit.
 * It runs the game's own interpreter and timeline player, as the State machine panel's stage does,
 * then folds the settled drives into a copy of the def's nodes — node ids repeat across segments, so
 * a pose cannot ride the canvas's per-id timeline preview.
 */

/** One settle step: long enough for any blend or non-looping state to finish. */
const SETTLE_STEP_SECONDS = 600;
/** Bounds a machine whose transitions chain (or cycle) forever. */
const SETTLE_MAX_STEPS = 32;

/**
 * The drives of `def`'s state machine settled at `inputs` and `params`: the runner starts (`enter`
 * fired, as in game), takes the inputs and advances until a step fires no transition; each layer is
 * then sampled at the END frame of the timeline its state plays. `docs`: the def's timelines. `null`
 * when the def has no state machine or none of its timelines is loaded (draw the base pose).
 */
export function settledSegmentPose(
	def: ComponentDef,
	docs: readonly CinematicDoc[],
	inputs: Readonly<Record<string, number | boolean>>,
	params: Readonly<Record<string, unknown>>,
): Map<string, TimelineNodeDrive> | null {
	const machine = def.stateMachine;
	if (!machine?.layers?.length || !docs.length) return null;
	const durations = new Map(docs.map((d) => [d.id, Math.max(d.duration || 0, 0)]));
	const runner = new ComponentStateMachineRunner(
		machine,
		componentInputs(def),
		durations,
		(key) => params[key],
		() => 0,
	);
	for (const [id, value] of Object.entries(inputs)) runner.setInput(id, value);
	runner.fire('enter');
	runner.advance(0);
	for (let i = 0; i < SETTLE_MAX_STEPS; i++) {
		if (!runner.advance(SETTLE_STEP_SECONDS).fired.length) break;
	}
	const player = previewPlayer(docs, def.root.children, () => params);
	runner.plays().forEach((play, layer) => {
		const end = play.timeline ? durations.get(play.timeline) : undefined;
		const time = end ?? play.time;
		player.drive(play.layer, layer, {
			layer: play.layer,
			state: play.state,
			timeline: play.timeline,
			time,
			prevTime: time,
			wrapped: false,
			entered: true,
		});
	});
	return playerDrives(player);
}

const IDENTITY = { x: 0, y: 0, scale: { x: 1, y: 1 }, rotation: 0, alpha: 1, visible: true };

/** `node` with its drive folded into its own transform (and every per-layout override's), as the
 *  canvas folds a drive (`foldBoundTransform`); `null` when the drive hides it. */
function posedNode(
	node: LayoutNode,
	drives: ReadonlyMap<string, TimelineNodeDrive>,
): LayoutNode | null {
	let out = node;
	if (out.kind === 'container') {
		const children = posedNodes(out.children, drives);
		if (children !== out.children) out = { ...out, children };
	}
	const drive = drives.get(node.id);
	if (!drive) return out;
	const delta = foldBoundTransform(
		IDENTITY,
		drive.bindings,
		nodeActorOutputs(drive.bindings, drive.sample),
	);
	if (!delta.visible) return null;
	const sx = delta.scale?.x ?? 1;
	const sy = delta.scale?.y ?? 1;
	const rot = delta.rotation ?? 0;
	const alpha = delta.alpha ?? 1;
	type Placement = Pick<NodeOverride, 'x' | 'y' | 'scale' | 'rotation' | 'alpha'>;
	const fold = <T extends Placement>(o: T, own: boolean): T => {
		const patch: Placement = {};
		if (own || o.x !== undefined) patch.x = (o.x ?? 0) + delta.x;
		if (own || o.y !== undefined) patch.y = (o.y ?? 0) + delta.y;
		if ((own || o.scale) && (sx !== 1 || sy !== 1))
			patch.scale = { x: (o.scale?.x ?? 1) * sx, y: (o.scale?.y ?? 1) * sy };
		if ((own || o.rotation !== undefined) && rot) patch.rotation = (o.rotation ?? 0) + rot;
		if ((own || o.alpha !== undefined) && alpha !== 1) patch.alpha = (o.alpha ?? 1) * alpha;
		return { ...o, ...patch };
	};
	out = fold(out, true);
	if (out.overrides) {
		const overrides: NonNullable<LayoutNode['overrides']> = {};
		for (const [layoutType, o] of Object.entries(out.overrides) as [
			keyof NonNullable<LayoutNode['overrides']>,
			NodeOverride,
		][]) {
			const folded = fold(o, false);
			if (drive.sample.tint !== undefined) delete folded.tint;
			overrides[layoutType] = folded;
		}
		out = { ...out, overrides };
	}
	const tint = drive.sample.tint;
	if (tint !== undefined && (out.kind === 'sprite' || out.kind === 'flipbook'))
		out = { ...out, tint };
	return out;
}

/** `nodes` at a {@link settledSegmentPose} — the same array when nothing is driven. */
export function posedNodes(
	nodes: LayoutNode[],
	drives: ReadonlyMap<string, TimelineNodeDrive>,
): LayoutNode[] {
	if (!drives.size) return nodes;
	let changed = false;
	const out: LayoutNode[] = [];
	for (const n of nodes) {
		const posed = posedNode(n, drives);
		if (posed !== n) changed = true;
		if (posed) out.push(posed);
	}
	return changed ? out : nodes;
}

const driveCache = new WeakMap<
	readonly CinematicDoc[],
	Map<string, Map<string, TimelineNodeDrive> | null>
>();
const DRIVE_CACHE_LIMIT = 256;

/**
 * The drives of `def`'s state machine settled at `inputs` and `params` ({@link settledSegmentPose}),
 * memoised per timeline list (a new list is a new load) and per def machine + inputs + params, as
 * the canvas redraws at frame rate. `null` ⇒ no state machine, or none of its timelines loaded.
 */
export function settledDrives(
	def: ComponentDef,
	docs: readonly CinematicDoc[],
	inputs: Readonly<Record<string, number | boolean>>,
	params: Readonly<Record<string, unknown>>,
): Map<string, TimelineNodeDrive> | null {
	if (!def.stateMachine?.layers?.length || !docs.length) return null;
	let cache = driveCache.get(docs);
	if (!cache) {
		cache = new Map();
		driveCache.set(docs, cache);
	}
	const key = JSON.stringify([def.id, def.stateMachine, def.inputs, inputs, params]);
	let drives = cache.get(key);
	if (drives === undefined) {
		drives = settledSegmentPose(def, docs, inputs, params);
		if (cache.size >= DRIVE_CACHE_LIMIT) cache.clear();
		cache.set(key, drives);
	}
	return drives;
}

/**
 * `def`'s children at its settled pose for `inputs` — what a count-mode segment draws. The fold
 * onto the nodes is not memoised, so a moved node shows at once. `null` ⇒ the base pose.
 */
export function segmentPoseNodes(
	def: ComponentDef,
	docs: readonly CinematicDoc[],
	inputs: Readonly<Record<string, number | boolean>>,
	params: Readonly<Record<string, unknown>>,
): LayoutNode[] | null {
	const drives = settledDrives(def, docs, inputs, params);
	return drives ? posedNodes(def.root.children, drives) : null;
}

/**
 * The animation strip the rig `nodeId` of `def` rests on: what the state of `def`'s machine, settled
 * at its inputs' defaults, keys on it. The game layers that strip over the rig's own animation
 * (`withTimelineScrub`), so a jackpot frame whose entry state plays its `mini` tier shows `mini`
 * whatever its resting `defaultAnimation`. `undefined` ⇒ no state keys an animation on it.
 */
export function restingStateStrip(
	def: ComponentDef,
	docs: readonly CinematicDoc[],
	params: Readonly<Record<string, unknown>>,
	nodeId: string,
): { animation: string; time: number } | undefined {
	return settledDrives(def, docs, {}, params)?.get(nodeId)?.sample.animTime;
}
