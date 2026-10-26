<script lang="ts" module>
	import type { SliceMode } from './nineSlice';

	export type Props = {
		key: string | undefined;
		fallbackKey?: string;
		mode: SliceMode;
		x?: number;
		y?: number;
		anchor?: { x: number; y: number };
		/** The displayed box, node scale already folded in (LayoutNodeView's `sized*`). Absent ⇒
		 * the art's own size times `scale`. */
		width?: number;
		height?: number;
		scale?: { x: number; y: number };
		rotation?: number;
		alpha?: number;
		zIndex?: number;
		tint?: number;
		blendMode?: 'add' | 'multiply' | 'screen' | 'overlay' | 'lighten';
	};
</script>

<script lang="ts">
	/**
	 * A sprite drawn as a 9-slice (`SpriteNode.slice`): the texture's `defaultBorders` — the frame's
	 * `borders` in the shipped sheet — sliced into the node's box by `buildSliceViews`, the views
	 * the editor-parity check renders too.
	 *
	 * `root` carries the placement (and a negative scale's flip, about the anchor as a sprite
	 * flips); `body` the anchor offset. Stretch resizes its one `NineSliceSprite` in place, so a
	 * tweened bar allocates nothing; tile rebuilds its pieces when the box changes.
	 */
	import * as PIXI from 'pixi.js';
	import { onDestroy, untrack } from 'svelte';
	import { getContextApp, getContextParent, hasAssetKey, warnMissingAsset } from 'pixi-svelte';
	import { buildSliceViews, sliceArt } from './slicedSpriteViews';

	const props: Props = $props();
	const app = getContextApp();
	const root = new PIXI.Container({ label: 'SlicedSprite' });
	const body = new PIXI.Container();
	root.addChild(body);
	getContextParent().addToParent(root);

	const texture = $derived.by(() => {
		const key = props.key;
		const fallback = props.fallbackKey;
		const t =
			(key ? app.stateApp.loadedAssets?.[key] : undefined) ??
			(fallback ? app.stateApp.loadedAssets?.[fallback] : undefined);
		return t instanceof PIXI.Texture && t !== PIXI.Texture.EMPTY ? t : undefined;
	});
	const art = $derived(texture ? sliceArt(texture) : undefined);

	/** The signed displayed box: a negative scale flips, it never empties the slice. */
	const box = $derived.by(() => {
		if (!art) return undefined;
		return {
			w: props.width ?? art.w * (props.scale?.x ?? 1),
			h: props.height ?? art.h * (props.scale?.y ?? 1),
		};
	});

	let views = $state.raw<PIXI.ViewContainer[]>([]);

	$effect(() => {
		const a = art;
		const mode = props.mode;
		// Stretch is resized in place below; only tile's pieces depend on the box.
		const b = mode === 'tile' ? box : untrack(() => box);
		if (!a || !b) return;
		const built = buildSliceViews(a, Math.abs(b.w) || 1, Math.abs(b.h) || 1, mode);
		for (const view of built.views) body.addChild(view);
		views = built.views;
		return () => {
			views = [];
			for (const view of built.views) view.destroy();
			for (const t of built.textures) t.destroy(false);
		};
	});
	onDestroy(() => body.destroy());

	$effect(() => {
		const b = box;
		if (!b) return;
		const w = Math.abs(b.w);
		const h = Math.abs(b.h);
		if (props.mode === 'stretch') {
			for (const view of views) {
				if (view instanceof PIXI.NineSliceSprite) view.setSize(w, h);
			}
		}
		body.visible = w > 0 && h > 0;
		body.position.set(-w * (props.anchor?.x ?? 0), -h * (props.anchor?.y ?? 0));
		root.scale.set(Math.sign(b.w) || 1, Math.sign(b.h) || 1);
	});

	$effect(() => {
		root.position.set(props.x ?? 0, props.y ?? 0);
		root.rotation = props.rotation ?? 0;
		root.alpha = props.alpha ?? 1;
		root.zIndex = props.zIndex ?? 0;
	});

	$effect(() => {
		const tint = props.tint ?? 0xffffff;
		const blendMode = props.blendMode ?? 'normal';
		for (const view of views) {
			view.tint = tint;
			view.blendMode = blendMode;
		}
	});

	// As `Sprite` reports it: only once loading is over, and only for a key that was assigned.
	$effect(() => {
		if (texture || !app.stateApp.loaded) return;
		if (!hasAssetKey(props.key) && !hasAssetKey(props.fallbackKey)) return;
		warnMissingAsset(`SlicedSprite: key "${props.key}" is not found in the loadedAssets`);
	});
</script>
