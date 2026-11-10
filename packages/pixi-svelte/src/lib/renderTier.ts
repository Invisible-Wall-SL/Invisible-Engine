/**
 * The level the renderer STARTS at, and the `?render=` pin.
 *
 * Every device starts at `full`: the device's pixel ratio up to 2, with a multisampled back buffer
 * (the canvas itself is never antialiased while the back buffer is on). A game then lowers it only
 * where frames measurably fall behind, and only as far as that helps (`renderQuality.ts`).
 *
 * How much memory a device reports decides nothing here: browsers hide the figure (Safari, Firefox)
 * or alter it (Brave: a 16 GB Pixel 9 Pro drew `reduced` in Brave and `full` in Chrome on the same
 * build, 2026-11-10), so it cannot decide what a player sees. It decides only whether textures stay
 * resident (`textureResidency.ts`), which changes no pixel.
 *
 * `?render=full` pins the full level (no adaptation). `?render=reduced` pins the reduced one from
 * init: the pixel ratio capped at 1.5 (about 44% fewer pixels than 2) and no MSAA, which on a
 * phone's tiled GPU also drops the back buffer's resolve. Sprites and rigs are textured quads and
 * lose nothing visible without MSAA; only the edges of untextured `Graphics` shapes get harder.
 * Independent of `?quality`, which picks the texture format.
 */

export type RenderTier = 'full' | 'reduced';

export interface RenderSettings {
	tier: RenderTier;
	maxResolution: number;
	antialias: boolean;
}

/** The `?render=` pin in a query string (`location.search`), if it names a tier. */
export function readRenderPin(search: string): RenderTier | undefined {
	const pin = new URLSearchParams(search).get('render');
	return pin === 'full' || pin === 'reduced' ? pin : undefined;
}

/** This page's `?render=` pin (none outside a browser). */
export const renderPin = (): RenderTier | undefined =>
	typeof window === 'undefined' ? undefined : readRenderPin(window.location.search);

/** The tier the renderer is created at: `reduced` only when pinned. */
export const renderTier = (): RenderTier => renderPin() ?? 'full';

export function renderSettings(tier: RenderTier = renderTier()): RenderSettings {
	return tier === 'reduced'
		? { tier, maxResolution: 1.5, antialias: false }
		: { tier, maxResolution: 2, antialias: true };
}
