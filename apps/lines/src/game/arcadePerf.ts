/**
 * ARCADE COUNTERS for the `?perf=1` probe (`PerfHud.svelte`, `perfStats.ts`): where an arcade frame
 * was — `play` while the field plays (the local loop moved a body, the online room is `running`),
 * else `menu` (a title, a lobby, a countdown, a win screen) — and what it did: its fixed steps, the
 * time in them, its bodies, the collision pairs tested, the spawns, the looks animated and, online,
 * the room's messages. The arcade runtime (`arcade.ts`, `online.ts`, `ArcadeStage*.svelte`) writes
 * it only while {@link arcadePerf} `.on`, which only the probe sets, so a player without `?perf=1`
 * pays one boolean test a site. It imports nothing: a runtime built without the arcade family never
 * writes it, and the probe reads it the same way in every runtime.
 *
 * Read once a frame, after the frame ({@link takeArcadeFrame}): the counts are what ran since the
 * last read, the levels (`bodies`) what the last tick left. Room messages are handled in their own
 * WebSocket task between frames, so a frame's `netMs` is the time spent on them since the frame
 * before — inside the interval that ends at this frame.
 */

export type ArcadePhase = 'menu' | 'play';

/** What an arcade frame did, as `perfStats.ts` buckets it beside the renderer's own counts. */
export interface ArcadeFrameWork {
	/** Fixed sim steps run (the local loop's, or the online client's prediction steps). */
	simSteps: number;
	/** 1 when the frame ran more than one step: the sim catching up on a long frame. Set on read. */
	simCatchUp: number;
	/** Frame time the sim dropped, ms: past the loop's step cap, or cut by the ticker's clamp. */
	simDroppedMs: number;
	/** ms inside the steps. */
	simMs: number;
	/** ms handling the room's messages (decode, state callbacks, reconcile) since the last frame. */
	netMs: number;
	/** Live bodies after the frame (local), or the room's players drawn (online). A level. */
	bodies: number;
	/** Collision pairs the narrow phase tested (the local loop's `overlaps`). */
	pairs: number;
	/** Bodies spawned and despawned. */
	spawns: number;
	despawns: number;
	/** Characters decided or looks animated. */
	looks: number;
	/** Online: room state messages (patches and full states) received, and their bytes. */
	patches: number;
	patchBytes: number;
	/** How far the world camera moved since the last frame, px. */
	cameraPx: number;
}

export const ARCADE_WORK_KEYS = [
	'simSteps',
	'simCatchUp',
	'simDroppedMs',
	'simMs',
	'netMs',
	'bodies',
	'pairs',
	'spawns',
	'despawns',
	'looks',
	'patches',
	'patchBytes',
	'cameraPx',
] as const satisfies readonly (keyof ArcadeFrameWork)[];

/** What the game's sim runs at: the fixed rate, and online the room's step and patch rates. */
export interface ArcadeInfo {
	online: boolean;
	/** Fixed steps a second (the local loop's `fixedHz`, or the room's `tickHz` online). */
	fixedHz: number;
	/** Online: room patches a second. */
	patchHz?: number;
}

/** Per frame, at most this many patch timings are kept (a burst after a stall). */
const LATES_KEPT = 16;

const zero = (): ArcadeFrameWork => ({
	simSteps: 0,
	simCatchUp: 0,
	simDroppedMs: 0,
	simMs: 0,
	netMs: 0,
	bodies: 0,
	pairs: 0,
	spawns: 0,
	despawns: 0,
	looks: 0,
	patches: 0,
	patchBytes: 0,
	cameraPx: 0,
});

export const arcadePerf = {
	/** The probe is reading: the runtime counts. */
	on: false,
	/** Set by each tick; none since the last read is `menu` (the field is not ticking). */
	phase: undefined as ArcadePhase | undefined,
	/** Counted in place: a writer may hold this object. */
	counts: zero(),
	/**
	 * Online: for each room state received since the last read, how much later it arrived than the
	 * room's own clock says it should have after the one before (the gap minus the patch periods
	 * its steps span: `online.ts` `noteLate`), ms. Steady patches read ~0; network jitter reads as
	 * a spread.
	 */
	lates: [] as number[],
	info: undefined as ArcadeInfo | undefined,
	/** Record one state's lateness (online). */
	late(ms: number): void {
		if (this.lates.length < LATES_KEPT) this.lates.push(ms);
	},
};

export interface ArcadeFrame {
	phase: ArcadePhase;
	work: ArcadeFrameWork;
	lates: number[];
}

/** The frame just over: its phase, what it counted, and the room states' lateness. Clears them. */
export function takeArcadeFrame(): ArcadeFrame {
	const frame: ArcadeFrame = {
		phase: arcadePerf.phase ?? 'menu',
		work: { ...arcadePerf.counts },
		lates: arcadePerf.lates.splice(0),
	};
	frame.work.simCatchUp = frame.work.simSteps > 1 ? 1 : 0;
	Object.assign(arcadePerf.counts, zero());
	arcadePerf.phase = undefined;
	return frame;
}
