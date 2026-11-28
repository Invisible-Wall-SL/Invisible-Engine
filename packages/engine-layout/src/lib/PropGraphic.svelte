<script lang="ts">
	import { Graphics } from 'pixi-svelte';
	import type { Graphics as PixiGraphics } from 'pixi.js';

	import { getComponentParams } from './componentParamsContext';
	import { ISO_PROJECTOR } from './projection';
	import { drawPropGraphic, propScalar, type PropGraphicProps } from './propGraphic';
	import { worldProjection } from './worldCameraView.svelte';

	/**
	 * A prop's vector art (`propGraphic.ts`), behind a `bind: { component: 'PropGraphic' }` node:
	 * drawn by the screen's projector (the isometric one off a projected screen, as in the editor),
	 * reading the placed instance's params.
	 */
	const { ops, x = 0, y = 0 }: PropGraphicProps = $props();
	const params = getComponentParams();
	const projection = worldProjection();
	const scope = {
		project: (px: number, py: number) => (projection?.projector ?? ISO_PROJECTOR).project(px, py),
		param: (key: string) => params[key],
	};
	const draw = (g: PixiGraphics) => drawPropGraphic(g, ops, scope);
</script>

<Graphics x={propScalar(x, scope)} y={propScalar(y, scope)} {draw} />
