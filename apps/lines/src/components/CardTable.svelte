<script lang="ts" module>
	import type { Scene } from 'engine-layout';

	export type Props = {
		/** The layout's screens: the table screen's hero portraits are the heroes a card can aim at. */
		scenes: readonly Scene[];
	};
</script>

<script lang="ts">
	import { getContextApp } from 'pixi-svelte';

	import { notePointer, startCards, tapTable, useCardScenes } from '../game/cards';
	import { getContext } from '../game/context';

	/**
	 * THE CARD TABLE (`docs/design/card-games.md` §5.1): mounted in the reel stack's place for a
	 * mechanic that is a card table. It draws nothing of its own — the cards are spawned instances of
	 * their frame, drawn by the table screen's spawn layers where the runtime puts them — and starts
	 * the match driver, hands it the screens, and follows the canvas pointer for the drop.
	 */

	const { scenes }: Props = $props();
	const context = getContext();
	const app = getContextApp();

	$effect(() => startCards());
	$effect(() => useCardScenes(scenes, context.stateLayoutDerived.layoutType()));

	$effect(() => {
		const pixi = app.stateApp.pixiApplication;
		if (!pixi) return;
		const canvas = pixi.canvas;
		const at = (e: PointerEvent) => {
			const point = { x: 0, y: 0 };
			pixi.renderer.events.mapPositionToPoint(point, e.clientX, e.clientY);
			return point;
		};
		const move = (e: PointerEvent) => notePointer(at(e));
		const up = (e: PointerEvent) => tapTable(at(e));
		canvas.addEventListener('pointerdown', move);
		window.addEventListener('pointermove', move);
		canvas.addEventListener('pointerup', up);
		return () => {
			canvas.removeEventListener('pointerdown', move);
			window.removeEventListener('pointermove', move);
			canvas.removeEventListener('pointerup', up);
		};
	});
</script>
