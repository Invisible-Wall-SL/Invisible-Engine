import {
	BUILTIN_COMPONENTS,
	COMPLETE_ON_LOADED_PARAM,
	TAP_ARM_AFTER_SIGNAL_PARAM,
	TAP_TO_CONTINUE_PARAM,
	type LayoutNode,
	type Scene,
} from 'engine-layout';

/**
 * CAN THIS CONTAINER EVER BE COMPLETED? — the launcher-side half of the Flow validator's hold-safety
 * checks (`hold-without-release` / `tap-without-hold`).
 *
 * A `showContainer{awaitComplete}` node blocks the exec chain — and the book pump awaiting it — until
 * the container completes, and the engine deliberately has NO timeout (a player who walks away
 * mid-outro should find the screen still up). The release that authors reach for almost always lives
 * on the SCENE, not in the graph: a `tapToContinue` overlay, or the loading bar's `completeOnLoaded`
 * auto-advance. Both call the game's `completeActiveScreen` → `mount.complete(id)`.
 *
 * The FlowDoc alone cannot see either, so the validator can't either — unless the LayoutDoc is
 * projected in. This is that projection, and it mirrors `sceneCues.ts`: a pure read off the scenes
 * the `/flow-v2` loader already has, handed to `validateFlowDoc` as `containerTaps`.
 */

/** The params a placed instance resolves for THIS read: its own, plus any per-layoutType patch. */
const instanceParamValues = (node: LayoutNode, key: string): unknown[] => {
	if (node.kind !== 'componentInstance') return [];
	const values: unknown[] = [node.params?.[key]];
	for (const override of Object.values(node.overrides ?? {})) {
		values.push(override?.params?.[key]);
	}
	return values;
};

/**
 * Does this node mount a surface that COMPLETES its container?
 *
 * Reads the two release params (`tapToContinue`, `completeOnLoaded`) the way the runtime resolves
 * them, in the one direction that matters here — TOWARDS a release, so a doc that works is never
 * flagged:
 *  - an explicit `true` on the instance, or on ANY per-layoutType `params` patch (a tap authored for
 *    portrait alone still releases the hold in portrait);
 *  - else the def's `defaultInstanceParams` seed, which `resolveComponentParams` applies at RUNTIME —
 *    `LOADING_BAR_DEF` seeds `tapToContinue: true`, so a hand-authored splash has a tap nobody wrote
 *    down. An explicit `false` on the instance beats the seed (clearing the toggle writes `false`).
 *
 * LIMIT: only BUILT-IN defs are resolved. A CUSTOM (R2) component's def lives in component storage
 * this pure helper does not read, so its `defaultInstanceParams` seed is invisible — the same limit
 * the loader's container-event projection already carries. Its explicit instance params still count.
 */
const nodeSwitchesOn = (
	node: Extract<LayoutNode, { kind: 'componentInstance' }>,
	key: string,
): boolean => {
	const values = instanceParamValues(node, key);
	if (values.some((v) => v === true)) return true;
	if (values.some((v) => v === false)) return false; // an explicit clear beats the def seed.
	const def = BUILTIN_COMPONENTS.find((d) => d.id === node.componentId);
	return def?.defaultInstanceParams?.[key] === true;
};

const nodeCompletesContainer = (node: LayoutNode): boolean =>
	node.kind === 'componentInstance' &&
	[TAP_TO_CONTINUE_PARAM, COMPLETE_ON_LOADED_PARAM].some((key) => nodeSwitchesOn(node, key));

/** Walks RECURSIVELY — `container` is the only layout node kind with `children`, and an overlay's
 *  tap instance is routinely nested inside one. */
const sceneCompletesItself = (nodes: readonly LayoutNode[]): boolean => {
	for (const node of nodes) {
		if (node.kind === 'container') {
			if (sceneCompletesItself(node.children ?? [])) return true;
			continue;
		}
		if (nodeCompletesContainer(node)) return true;
	}
	return false;
};

/**
 * ContainerId → does its backing scene carry a release surface?
 *
 * NEVER GUESS (`scope.ts`): a container is keyed ONLY when its `sceneId` resolves to a real scene. A
 * container whose scene is missing — and every container of an unsaved or standalone project, which
 * has no scenes at all — is simply ABSENT, and the validator skips it. An empty map therefore means
 * "nothing is known", not "nothing has a tap": it must produce no issues, never a false error on
 * every flow.
 */
export function collectContainerTaps(
	containers: readonly { id: string; sceneId: string }[],
	scenes: readonly Scene[],
): Record<string, boolean> {
	const scenesById = new Map(scenes.map((s) => [s.id, s]));
	const taps: Record<string, boolean> = {};
	for (const container of containers) {
		const scene = scenesById.get(container.sceneId);
		if (!scene) continue;
		taps[container.id] = sceneCompletesItself(scene.nodes ?? []);
	}
	return taps;
}

/**
 * A tap surface ARMED ON MOUNT: `tapToContinue` on (read as {@link nodeCompletesContainer} reads it)
 * and no `tapArmAfterSignal` on the instance or on any per-layoutType patch. Read in the direction
 * that never flags a working doc — an arm signal in any variant counts as armed-later.
 */
const tapArmedOnMount = (node: LayoutNode): boolean =>
	node.kind === 'componentInstance' &&
	nodeSwitchesOn(node, TAP_TO_CONTINUE_PARAM) &&
	!instanceParamValues(node, TAP_ARM_AFTER_SIGNAL_PARAM).some(
		(v) => typeof v === 'string' && v.trim() !== '',
	);

const armedTapIds = (nodes: readonly LayoutNode[], into: string[]): string[] => {
	for (const node of nodes) {
		if (node.kind === 'container') armedTapIds(node.children ?? [], into);
		else if (tapArmedOnMount(node)) into.push(node.id);
	}
	return into;
};

/**
 * ContainerId → the placed ids of its scene's tap surfaces armed on mount — the scene half of the
 * Flow validator's `startup-tap-surface` check (`startupTapIssues`). A screen a driven flow shows at
 * start-up and never hides must not carry one, or a dimmed tap surface covers the idle game and the
 * Space spin hotkey is dead. Keyed like {@link collectContainerTaps}: only containers whose scene
 * resolves, and only when it has such a tap.
 */
export function collectArmedOnMountTaps(
	containers: readonly { id: string; sceneId: string }[],
	scenes: readonly Scene[],
): Record<string, string[]> {
	const scenesById = new Map(scenes.map((s) => [s.id, s]));
	const taps: Record<string, string[]> = {};
	for (const container of containers) {
		const scene = scenesById.get(container.sceneId);
		const ids = scene ? armedTapIds(scene.nodes ?? [], []) : [];
		if (ids.length) taps[container.id] = ids;
	}
	return taps;
}
