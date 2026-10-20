<script lang="ts" module>
	import { type Props as BaseProps } from './BaseRigProvider.svelte';
	import type { PixiPoint } from '../types';
	import type { RigAnchor } from '../rigBox';

	export type Props = Omit<BaseProps, 'rigData' | 'pivot' | 'scale' | 'anchorFallback'> & {
		debug?: boolean;
		key: string;
		/**
		 * The point of the rig's authored box (`skeleton.{x,y,width,height}` — the Rigger's Bounds
		 * frame) that lands on (x, y), read like a sprite's anchor: y down, `0` the top-left, `0.5`
		 * the centre — so `anchor={0.5}` with `width`/`height` and `fit="contain"` fits that frame
		 * into the box centred, wherever the skeleton origin sits inside it. The pivot is in the
		 * rig's own (load-scaled) units, independent of the size fit. A rig with no header box is
		 * anchored on its live bounds instead (`BaseRigProvider`).
		 *
		 * Absent ⇒ the skeleton ORIGIN lands on (x, y): what a placed scene rig (the Scene Editor's
		 * convention), a cinematic actor and every stock coded rig authored around its origin rely
		 * on. Several stock rigs have setup boxes far off their origin, so centring is opt-in.
		 */
		anchor?: RigAnchor;
		scale?: PixiPoint;
		/**
		 * Render this rig as if its skeleton had been read at THIS load scale, whatever
		 * `parser.scale` its bundle was actually loaded with (`setRigLoadScale`).
		 *
		 * The rig readers scale the skeleton geometry but leave `skeleton.data.width/height`
		 * un-scaled, so the load scale is a bare multiplier that NO sizing path cancels — a
		 * bundle read at 2 is twice the size of the same bundle read at 1, both at natural size
		 * and at any requested `width`. A surface that must be pixel-identical with an authoring
		 * tool (which loads every rig at its own fixed scale) passes that scale here and stops
		 * caring what the game's asset index happens to say. Absent ⇒ factor 1 ⇒ unchanged.
		 */
		loadScaleBase?: number;
	};
</script>

<script lang="ts">
	import * as RIG from 'engine-rig/pixi';

	import { authoredRigBox } from 'constants-shared/rig';

	import BaseRigProvider from './BaseRigProvider.svelte';
	import RiggedEffect from './RiggedEffect.svelte';
	import RiggedFlipbook from './RiggedFlipbook.svelte';
	import { rigAnchorPoint, rigFramePivot } from '../rigBox';
	import { getContextApp, setContextRigLoadScale } from '../context.svelte';
	import { getRigLoadScale } from '../rigLoadScale';
	import { EMPTY_RIG_BOUND_CONTENT, resolveRigBoundContent } from '../rigBoundContent';
	import { hasAssetKey, warnMissingAsset } from '../missingAsset';

	const {
		debug,
		key,
		anchor,
		children,
		scale: scaleProp,
		loadScaleBase,
		...baseRigProps
	}: Props = $props();
	const context = getContextApp();
	// Resolved bundle + the key it is REGISTERED under (they differ for a doc-stored R2
	// prefix), so the load scale is read under the same key `assetLoad` recorded it with.
	const resolved = $derived.by(() => {
		const assets = context.stateApp.loadedAssets;
		const direct = assets?.[key] as RIG.SkeletonData | undefined;
		if (direct) return { data: direct, assetKey: key };
		// Editor scene docs store a rig key as its R2 bundle PREFIX
		// (`<client>/<project>/spines/<bundle>/`) so the editor can preview it from
		// R2; games register the rig under the plain `<bundle>` key. Fall back to
		// that so doc-driven rig nodes resolve in-game.
		const bundle = key.match(/(?:^|\/)spines\/(.+?)\/?$/)?.[1];
		const data = bundle ? (assets?.[bundle] as RIG.SkeletonData | undefined) : undefined;
		return data && bundle ? { data, assetKey: bundle } : undefined;
	});
	const rigData = $derived(resolved?.data);

	// Content bound into this rig (`<RiggedFlipbook>`, `<RiggedEffect>`) is authored in RIG units and
	// sizes itself by this — see `setContextRigLoadScale`. A getter, so it follows `resolved`.
	setContextRigLoadScale(() => (resolved ? getRigLoadScale(resolved.assetKey) : 1));

	// `width`/`height` → scale is resolved in `BaseRigProvider` (it sizes against the
	// pose-independent authored bounds, robust to animation/skin-driven art whose setup
	// pose is empty). Here we only forward the caller's raw `scale`; BaseRigProvider
	// folds the size scale into it — plus, when the caller asked for one, the load-scale
	// correction (see `loadScaleBase`). Absent ⇒ 1 ⇒ byte-identical to before.
	const loadScaleFix = $derived(
		loadScaleBase === undefined || !resolved
			? 1
			: loadScaleBase / getRigLoadScale(resolved.assetKey),
	);
	const scale = $derived.by(() => {
		const base =
			typeof scaleProp === 'number'
				? { x: scaleProp, y: scaleProp }
				: { x: scaleProp?.x ?? 1, y: scaleProp?.y ?? 1 };
		return { x: base.x * loadScaleFix, y: base.y * loadScaleFix };
	});

	const pivot = $derived.by(() => {
		if (!resolved) return undefined;
		if (anchor === undefined) return { x: 0, y: 0 };
		// No header box (a degenerate export) → `undefined`, so BaseRigProvider anchors on the LIVE
		// bounds once the art appears; a pivot set here would overwrite that one on every prop sync.
		const box = authoredRigBox(resolved.data);
		if (!box) return undefined;
		// The box is read from the UNSCALED header while the geometry (and so local space) carries
		// the bundle's load scale — `rigFramePivot` scales the point up and flips its y to match.
		return rigFramePivot(box, rigAnchorPoint(anchor), getRigLoadScale(resolved.assetKey));
	});

	/**
	 * Content the Rigger bound DIRECTLY on this rig's animation event keyframes — effects
	 * (`event.fx`) and flipbook clips (`event.flipbook`) — mounted for EVERY rig, whatever mounted
	 * the rig. This is the single join that used to be hand-copied into `LayoutNodeView`'s rig
	 * branch and `SymbolRigMain`, which is why a rig mounted by anything else (the big-win rig, a
	 * backdrop, a transition, a cinematic actor) played nothing. See `rigBoundContent.ts`.
	 *
	 * Keyed by `resolved.assetKey` — the key the bundle is actually REGISTERED under, which is
	 * already the plain bundle folder the manifests are keyed by, even when the caller passed the
	 * full R2 prefix an editor doc stores. (`resolveRigFx` is folder-tolerant anyway; this just
	 * hands it the resolved key rather than relying on that fallback.)
	 *
	 * A rig with no bindings — nearly all of them — gets the shared frozen empty, so this costs one
	 * map lookup per rig mount and changes nothing about how it renders.
	 */
	const bound = $derived(
		resolved ? resolveRigBoundContent(resolved.assetKey) : EMPTY_RIG_BOUND_CONTENT,
	);
</script>

<!-- Load-aware diagnostic: a rig mounted by the (now generically mounted) game tree
	 during the asset-load window has no `rigData` yet and resolves once its bundle
	 arrives — only flag it as missing once loading is done. See Sprite.svelte. -->
{#if !rigData && context.stateApp.loaded && hasAssetKey(key)}
	{warnMissingAsset(`SRig: key "{key}" is not found in loadedAssets`)}
{/if}

{#if debug}
	{console.log('loadedAssets', $state.snapshot(context.stateApp).loadedAssets)}
{/if}

{#key rigData}
	{#if rigData}
		<BaseRigProvider {...baseRigProps} {scale} {pivot} {rigData} anchorFallback={anchor}>
			{@render children()}
			<!-- Rig-timeline bound content, mounted AFTER the caller's children so it draws over them
				 by default — the on-top mount a binding with no `slot` asks for. A binding that names a
				 slot is re-parented into the skeleton's own draw order by `<RiggedEffect>` /
				 `<RiggedFlipbook>` regardless of this order. -->
			{#each bound.effects as b (b.key)}
				<RiggedEffect
					doc={b.doc}
					event={b.event}
					animation={b.animation}
					time={b.time}
					bone={b.bone}
					drawSlot={b.drawSlot}
					alpha={b.alpha}
					scale={b.scale}
					delay={b.delay}
					duration={b.duration}
					speed={b.speed}
					continuous={b.continuous}
				/>
			{/each}
			{#each bound.flipbooks as b (b.key)}
				<RiggedFlipbook
					clip={b.clip}
					event={b.event}
					animation={b.animation}
					time={b.time}
					bone={b.bone}
					drawSlot={b.drawSlot}
					alpha={b.alpha}
					scale={b.scale}
					delay={b.delay}
					duration={b.duration}
					continuous={b.continuous}
				/>
			{/each}
		</BaseRigProvider>
	{/if}
{/key}
