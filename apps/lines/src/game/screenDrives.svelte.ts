import { untrack } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import type { CinematicNodeDriver, ScreenNodeDrive } from 'engine-layout/svelte';

/**
 * SCREEN TIMELINES on the screens their own mount draws (Rive plan Phase 3): a screen a flow Show
 * put up, or one the game mounts itself (the add-on's Pots screen a driven flow never shows,
 * `enginePotsScreen`). A playing screen-hosted timeline hands its node driver over (`driveScreen`)
 * and that screen's mount remounts with it (`drive`), so the timeline moves the screen the player
 * sees. `<Cinematic>` draws its own copy only of a screen no mount draws (`onStage`). A drive lasts
 * while its timeline plays or its screen is up (`isUp`), so the screen holds the last frame until
 * it goes down, and the next mount of it is undriven.
 */
export interface ScreenDrives {
	/**
	 * Does a mount of screen `sceneId` take its timeline, so `<Cinematic>` draws no copy? A shown
	 * flow screen, or a screen the game mounts itself — also while that one is down, when the
	 * timeline then draws nothing, as the screen does. Reactive.
	 */
	onStage: (sceneId: string) => boolean;
	/** Is screen `sceneId` up right now, shown by the flow or mounted by the game? Reactive. */
	isUp: (sceneId: string) => boolean;
	/** The screen timeline moving screen `sceneId`, for its mount. Reactive. */
	drive: (sceneId: string) => ScreenNodeDrive | undefined;
	/** A playing screen timeline's node driver, handed over once, at mount. */
	driveScreen: (sceneId: string, cinematicId: string, driver: CinematicNodeDriver) => void;
	/** The flow's shown containers changed: these scenes are now the flow's up screens. */
	setFlowScreens: (sceneIds: readonly string[]) => void;
	/** The game mounted (`up`) or unmounted a screen of its own. */
	setEngineScreen: (sceneId: string, up: boolean) => void;
	/** Drop the drives whose timeline stopped and whose screen is down (a timeline just ended). */
	dropIdle: () => void;
}

/**
 * `playing`: is this cinematic still playing (the flow's `playingCinematics`)? `engineScreens`: the
 * screens the game mounts itself under this flow.
 */
export function createScreenDrives(
	playing: (cinematicId: string) => boolean,
	engineScreens: readonly string[] = [],
): ScreenDrives {
	const flowUp = new SvelteSet<string>();
	const engineUp = new SvelteSet<string>();
	const drives = new SvelteMap<string, ScreenNodeDrive & { cinematicId: string }>();
	let plays = 0;
	const isUp = (sceneId: string): boolean => flowUp.has(sceneId) || engineUp.has(sceneId);
	// Untracked: a show/hide can run inside an effect (a dispatch an effect started), which must not
	// come to depend on these maps.
	const dropIdle = (): void =>
		untrack(() => {
			for (const [sceneId, drive] of drives) {
				if (!isUp(sceneId) && !playing(drive.cinematicId)) drives.delete(sceneId);
			}
		});
	return {
		onStage: (sceneId) => flowUp.has(sceneId) || engineScreens.includes(sceneId),
		isUp,
		drive: (sceneId) => drives.get(sceneId),
		driveScreen: (sceneId, cinematicId, driver) =>
			untrack(() => {
				drives.set(sceneId, { key: `${cinematicId}#${++plays}`, driver, cinematicId });
			}),
		setFlowScreens: (sceneIds) => {
			untrack(() => {
				for (const sceneId of flowUp) if (!sceneIds.includes(sceneId)) flowUp.delete(sceneId);
				for (const sceneId of sceneIds) flowUp.add(sceneId);
			});
			dropIdle();
		},
		setEngineScreen: (sceneId, up) => {
			untrack(() => {
				if (up) engineUp.add(sceneId);
				else engineUp.delete(sceneId);
			});
			dropIdle();
		},
		dropIdle,
	};
}
