/**
 * The seam that makes rig-timeline bindings UNIVERSAL: whatever mounts a rig, its authored
 * bound content plays.
 *
 * A rig can carry content bound directly on its own animation event keyframes — an Invisible FX
 * effect (`event.fx`) or an Invisible Flipbook clip (`event.flipbook`), authored in the Rigger and
 * baked into the `rigFx` / `rigFlipbooks` manifests. Playing one needs two halves: the RENDERERS
 * (`<RiggedEffect>` / `<RiggedFlipbook>`, here in `pixi-svelte`) and the LOOKUP that turns a rig's
 * assetKey into its bindings + their resolved docs (the registries in `engine-layout`).
 *
 * Those halves used to be joined at each MOUNT SITE — `LayoutNodeView`'s spine branch and
 * `SymbolSpineMain` each hand-copied the same ~25-line resolve-and-mount block. So a rig played its
 * bound FX only if it happened to be mounted by one of those two, and every other rig in the engine
 * — the big-win rig (`WinAnimation`), the backdrops (`Background`), transitions, free-spin visuals,
 * anticipation, the board frame, cinematic actors — silently rendered nothing, with no error and no
 * clue at the authoring end, because the binding was baked and correct and simply never read.
 *
 * So the join moves DOWN to `<SpineProvider>`, the one component every rig in the engine goes
 * through. `engine-layout` — which owns the registries and sits ABOVE this package — installs a
 * resolver here; `SpineProvider` asks it for whatever is bound to the rig it just resolved. The
 * dependency inversion is the same one `registerFxBehaviors(Emitter)` uses to keep `engine-fx`
 * PixiJS-free: the lower package declares the shape and the higher one fills it in.
 *
 * NO RESOLVER INSTALLED ⇒ every rig resolves to {@link EMPTY_RIG_BOUND_CONTENT} and nothing mounts,
 * which is exactly what a `pixi-svelte` consumer outside a game (Storybook, the rigger spike) wants.
 */
import { warnMissingAsset } from './missingAsset';

import type { Props as RiggedEffectProps } from './components/RiggedEffect.svelte';
import type { Props as RiggedFlipbookProps } from './components/RiggedFlipbook.svelte';

/**
 * One ready-to-mount bound effect: exactly `<RiggedEffect>`'s props plus the `{#each}` key.
 *
 * The resolver hands over MOUNT-READY props, not raw bindings, on purpose — resolving a binding's
 * `effectId` → doc, folding a clip's playback overrides and building a stable key all need the
 * registries, and doing them here would drag the lookup back down into this package (or, worse,
 * fork it). `pixi-svelte` stays the renderer.
 */
export type RigBoundEffect = RiggedEffectProps & { key: string };

/** One ready-to-mount bound flipbook clip: `<RiggedFlipbook>`'s props plus the `{#each}` key, with
 * the binding's playback overrides already folded into `clip`. */
export type RigBoundFlipbook = RiggedFlipbookProps & { key: string };

/** Everything bound to one rig's timeline. */
export type RigBoundContent = {
	effects: RigBoundEffect[];
	flipbooks: RigBoundFlipbook[];
};

// Frozen as a STATEMENT, not inline: `Object.freeze([])` types as `readonly never[]`, which no
// cast reaches `RigBoundEffect[]` from. Declaring first and freezing after keeps both the mutable
// element type the consumers need and the runtime guarantee that nobody pushes into the shared
// empty.
const NO_EFFECTS: RigBoundEffect[] = [];
const NO_FLIPBOOKS: RigBoundFlipbook[] = [];
Object.freeze(NO_EFFECTS);
Object.freeze(NO_FLIPBOOKS);

/** The shared "nothing is bound" result. A single frozen instance so the overwhelmingly common
 * case (a rig with no bindings) hands `SpineProvider` a STABLE reference and its `$derived` does
 * not invalidate its `{#each}` blocks on every recompute. */
export const EMPTY_RIG_BOUND_CONTENT: RigBoundContent = Object.freeze({
	effects: NO_EFFECTS,
	flipbooks: NO_FLIPBOOKS,
});

export type RigBoundContentResolver = (rigKey: string) => RigBoundContent | undefined;

let resolver: RigBoundContentResolver | undefined;

/**
 * Install the lookup that turns a rig's assetKey into its bound content. Called by `engine-layout`
 * the moment a game registers a rig-timeline manifest (`registerRigFx` / `registerRigFlipbooks`),
 * so a game that has bindings always has the resolver and one that has none never pays for it.
 *
 * Latest-wins, and `undefined` uninstalls — parity with the registries above it, and what lets a
 * test/story tear the seam back down.
 */
export function setRigBoundContentResolver(fn: RigBoundContentResolver | undefined): void {
	resolver = fn;
}

/**
 * Resolve a rig's bound content, or {@link EMPTY_RIG_BOUND_CONTENT} when there is no resolver, no
 * key, or nothing bound.
 *
 * NEVER THROWS: this runs inside every rig's render, so a fault in the layer above must degrade to
 * "this rig has no bound content" — the behaviour that always worked — rather than take down the
 * rig itself, and with it whatever the game was showing.
 *
 * But it does NOT fail silently. The bug this whole seam exists to fix was "the binding is baked,
 * correct, and read by nothing", which cost a debugging session precisely because nothing said so.
 * A resolver fault is reported once per rig key through the same one-shot channel the missing-asset
 * diagnostics use — this sits on every rig's render path, so a per-frame log would be its own bug.
 */
export function resolveRigBoundContent(rigKey: string | undefined): RigBoundContent {
	if (!resolver || !rigKey) return EMPTY_RIG_BOUND_CONTENT;
	try {
		return resolver(rigKey) ?? EMPTY_RIG_BOUND_CONTENT;
	} catch (error) {
		warnMissingAsset(
			`[rigBoundContent] resolver threw for rig "${rigKey}" — its bound effects/clips will not play: ${String(error)}`,
		);
		return EMPTY_RIG_BOUND_CONTENT;
	}
}
