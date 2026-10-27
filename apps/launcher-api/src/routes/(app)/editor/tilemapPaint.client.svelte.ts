/**
 * The Scene Editor's tilemap paint mode (game-families §4.4, P10.13): the active tool and the brush
 * (a tileset index). ONE module-scoped store: Properties picks them, the canvas paints with them
 * and repaints when they change. A `.svelte.ts` module because the state is a rune.
 */
import type { TilemapTool } from '$lib/editor/tilemapEdit';

export const tilemapPaint = $state<{ tool: TilemapTool; brush: number }>({
	tool: 'move',
	brush: 0,
});
