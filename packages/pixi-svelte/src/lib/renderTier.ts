/**
 * The RENDER tier: how many pixels a frame draws, decided once when the app starts (antialiasing
 * is a property of the WebGL context and cannot change after it is made).
 *
 * `full` is what every device drew before this existed: the device's pixel ratio up to 2, with
 * antialiasing on both the back buffer and the canvas. `reduced` is for devices that cannot fill
 * that many pixels in a frame: the pixel ratio capped at 1.5 (about 44% fewer pixels than 2) and
 * no antialiasing, which on a phone's tiled GPU also drops the multisampled back buffer's resolve.
 * Sprites and rigs are textured quads and lose nothing visible without MSAA; only the edges of
 * untextured `Graphics` shapes get harder.
 *
 * Auto-detected only where a device says how much memory it has (Chromium's `deviceMemory`,
 * reported rounded down to a power of two): 2 GB or less is `reduced`. Safari reports nothing,
 * so an iPhone stays `full` unless told. `?render=reduced` forces the reduced tier on any device,
 * `?render=full` keeps the full one. Independent of `?quality`, which picks the texture format.
 */

export type RenderTier = 'full' | 'reduced';

/** The most memory, in GB, a device reports and still counts as low-end. */
const LOW_END_MEMORY_GB = 2;

export interface RenderSettings {
	tier: RenderTier;
	maxResolution: number;
	antialias: boolean;
}

export function renderTier(): RenderTier {
	if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'full';
	const forced = new URLSearchParams(window.location.search).get('render');
	if (forced === 'reduced' || forced === 'full') return forced;
	const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
	return typeof memory === 'number' && memory <= LOW_END_MEMORY_GB ? 'reduced' : 'full';
}

export function renderSettings(tier: RenderTier = renderTier()): RenderSettings {
	return tier === 'reduced'
		? { tier, maxResolution: 1.5, antialias: false }
		: { tier, maxResolution: 2, antialias: true };
}
