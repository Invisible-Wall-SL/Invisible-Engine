/**
 * Whether the loader pins every texture on the GPU (`gpuWarmup.ts` `keepResident`): the one thing
 * a device's reported memory still decides.
 *
 * Pinned, a page is never dropped by Pixi's collector, so a big-win sheet shown once every few
 * minutes never stalls on its re-upload. A device that reports 4 GB or less (Chromium's
 * `navigator.deviceMemory`, rounded to a power of two) leaves its textures to the collector
 * instead: every page held on the GPU at once risks the browser killing the tab. Residency changes
 * no pixel, so a figure a browser hides (Safari, Firefox: pinned) or alters (Brave) costs at most a
 * re-upload stall or some memory, never what the player sees. What a frame draws is decided by
 * measured frame times instead (`renderQuality.ts`).
 */

/** The most memory, in GB, a device reports and still counts as low on memory. */
export const LOW_MEMORY_GB = 4;

export type MemoryReport = { deviceMemory?: unknown };

export function lowMemoryDevice(
	nav: MemoryReport | undefined = typeof navigator === 'undefined'
		? undefined
		: (navigator as Navigator & MemoryReport),
): boolean {
	const memory = nav?.deviceMemory;
	return typeof memory === 'number' && memory <= LOW_MEMORY_GB;
}
