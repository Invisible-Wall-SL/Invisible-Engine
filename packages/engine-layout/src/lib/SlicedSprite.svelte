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
	 */
	import * as PIXI from 'pixi.js';
	import { getContextApp, getContextParent } from 'pixi-svelte';
	import { buildSliceViews, sliceArt } from './slicedSpriteViews';

	const props: Props = $props();
	const app = getContextApp();
	const root = new PIXI.Container({ label: 'SlicedSprite' });
	getContextParent().addToParent(root);

	const art = $derived.by(() => {
		const key = props.key;
		const fallback = props.fallbackKey;
		const t =
			(key ? app.stateApp.loadedAssets?.[key] : undefined) ??
			(fallback ? app.stateApp.loadedAssets?.[fallback] : undefined);
		return t instanceof PIXI.Texture && t !== PIXI.Texture.EMPTY ? sliceArt(t) : undefined;
	});

	$effect(() => {
		const a = art;
		if (!a) return;
		const w = props.width ?? a.w * (props.scale?.x ?? 1);
		const h = props.height ?? a.h * (props.scale?.y ?? 1);
		if (!(w > 0) || !(h > 0)) return;
		const { views, textures } = buildSliceViews(a, w, h, props.mode);
		const ax = props.anchor?.x ?? 0;
		const ay = props.anchor?.y ?? 0;
		for (const view of views) {
			view.position.set(view.position.x - w * ax, view.position.y - h * ay);
			root.addChild(view);
		}
		return () => {
			for (const child of root.removeChildren()) child.destroy();
			for (const t of textures) t.destroy(false);
		};
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
		// Re-applied whenever the views are rebuilt.
		void art;
		void props.width;
		void props.height;
		void props.scale;
		void props.mode;
		void props.anchor;
		for (const child of root.children) {
			const view = child as PIXI.Sprite;
			view.tint = tint;
			view.blendMode = blendMode;
		}
	});
</script>
