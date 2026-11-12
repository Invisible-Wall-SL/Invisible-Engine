import type { MountedContainerRef } from 'engine-layout/svelte';

/**
 * THE START-UP SCREENS, MOUNTED AHEAD. The start screen's tap used to mount every screen the flow
 * shows from start-up on in one task (`overlay-buffaloduel`: `pots`, `jackpotBar`, `hudBar`, then
 * `hudCorners` and `freeSpinCounter`): 0.5–1 s of JavaScript in Chromium, 1–2.2 s in WebKitGTK,
 * the 183 ms an Android phone froze for as the game first appeared. They are mounted under the
 * loading bar instead, one a warm-up step, hidden and dormant, and each starts in place when the
 * flow shows it (`<FlowV2Mount ahead>`, `<LayoutScene dormant>`).
 *
 * Which: every container a start-up chain shows (`startupShownContainers`), less those the game
 * mounts itself (`exclude`: the base game, which interleaves with the reels) and those already
 * on screen, and only a screen that starts in place (`startsInPlace`): one no timeline drives, or
 * one its timelines drive in place. A screen a timeline remounts would be mounted again at its
 * show. Stacked by `z`, ties in the flow's order, as the flow would show them.
 */
export function startupAheadContainers({
	startup,
	containers,
	exclude,
	startsInPlace,
}: {
	/** The container ids the start-up chains show. */
	startup: Iterable<string>;
	/** Every container of the flow, with its stacking `z`. */
	containers: readonly MountedContainerRef[];
	/** Container ids never mounted ahead. */
	exclude: ReadonlySet<string>;
	/** Whether the screen with this scene id starts in place at its show. */
	startsInPlace: (sceneId: string) => boolean;
}): MountedContainerRef[] {
	const wanted = new Set(startup);
	return containers
		.filter((c) => wanted.has(c.id) && !exclude.has(c.id) && startsInPlace(c.sceneId))
		.sort((a, b) => a.z - b.z);
}

/**
 * Mount the screens ahead with `Math.random` answering a constant. A mount draws (a state machine
 * layer's random start), and each screen draws again when it starts at its show; a draw at the
 * mount would leave the sequence one ahead of a mount at the show, and in a seeded run (the
 * current-games harness) every later particle and lit symbol would move. `mount` must mount
 * synchronously (`flushSync`).
 */
export function mountWithoutRandomDraws(mount: () => void): void {
	const random = Math.random;
	Math.random = () => 0;
	try {
		mount();
	} finally {
		Math.random = random;
	}
}
