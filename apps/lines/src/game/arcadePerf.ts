/**
 * ARCADE COUNTERS for the `?perf=1` probe (`PerfHud.svelte`, `perfStats.ts`): where an arcade frame
 * was and what it did. The phase is one of:
 * - `loading`: from a level's mount ({@link arcadePerf} `.mount`: the room joined, its art landed,
 *   the local loop started) until its first ticked frame and {@link LOADING_TAIL_MS} after it, so
 *   the mount's one-frame build and the first second of settling do not count in `play`;
 * - `play`: the field plays (the local loop moved a body; the online room is `running` and the
 *   player is in it);
 * - `spectate`: the online room is `running` and the player is out of it, watching;
 * - `lobby`: anything else (a title, the lobby, a countdown, a win screen).
 * What it did: its fixed steps, the
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
 *
 * Online, every room message in and out is also tallied for the page's network block
 * ({@link arcadePerf} `socket`, `perfNetwork.ts`) by the same meter as the per-frame `patches` /
 * `patchBytes`, so a state patch is counted once and read two ways; the tally also splits the bytes
 * by kind of message and counts the fixed steps run, for sends per step.
 */

import { tallyCode, type SocketTally } from './perfNetwork';

/** The phases an arcade frame counts in (`perf: 10`; `perf: 8` and `9` readings had `menu` and `play`). */
export type ArcadePhase = 'loading' | 'lobby' | 'play' | 'spectate';

/** The phases a tick says it was in; `loading` is decided from the mount ({@link takeArcadeFrame}). */
export type ArcadeTickPhase = Exclude<ArcadePhase, 'loading'>;

/** How long after a level's first ticked frame it still counts as loading, ms. */
export const LOADING_TAIL_MS = 1000;

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
	/** Set by each tick; none since the last read is `lobby` (the field is not ticking). */
	phase: undefined as ArcadeTickPhase | undefined,
	/**
	 * The online room's phase (`lobby`, `countdown`, `running`, `over`) at the last tick: what a
	 * spike record's `state` says for an arcade game (the slot machine's state means nothing to it).
	 */
	room: undefined as string | undefined,
	/** ms (page clock) a level last mounted, until the loading window it opens has closed. */
	mountedAt: undefined as number | undefined,
	/** ms (page clock) of the first frame ticked since that mount. */
	tickedAt: undefined as number | undefined,
	/**
	 * A level mounted: the room joined, its art landed, the local loop started. Loading begins.
	 * Noted whether or not the probe is reading yet (one clock read a mount), since the game can
	 * mount before the probe does.
	 */
	mount(): void {
		this.mountedAt = performance.now();
		this.tickedAt = undefined;
	},
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
	/** Online: the room's messages since the probe began reading (never reset: the page's traffic). */
	socket: undefined as SocketTally | undefined,
	/** Record one state's lateness (online). */
	late(ms: number): void {
		if (this.lates.length < LATES_KEPT) this.lates.push(ms);
	},
	/** Fixed steps run, for the tally's sends per step. */
	steps(n: number): void {
		if (n <= 0) return;
		const s = this.socket;
		if (s) s.steps = (s.steps ?? 0) + n;
	},
	/**
	 * Tally one room message, in or out, of the kind `label` (`perfNetwork.ts` `messageLabel`); a
	 * state (full or patch) is a message in.
	 */
	message(out: boolean, bytes: number, state = false, label = 'message'): void {
		const now = performance.now();
		const s = (this.socket ??= {
			since: now,
			last: now,
			inMessages: 0,
			inBytes: 0,
			inLargest: 0,
			states: 0,
			stateBytes: 0,
			outMessages: 0,
			outBytes: 0,
			outLargest: 0,
		});
		s.last = now;
		if (out) {
			s.outMessages += 1;
			s.outBytes += bytes;
			s.outLargest = Math.max(s.outLargest, bytes);
			tallyCode((s.outByCode ??= {}), label, bytes);
			return;
		}
		tallyCode((s.inByCode ??= {}), label, bytes);
		s.inMessages += 1;
		s.inBytes += bytes;
		s.inLargest = Math.max(s.inLargest, bytes);
		if (state) {
			s.states += 1;
			s.stateBytes += bytes;
		}
	},
};

export interface ArcadeFrame {
	phase: ArcadePhase;
	/** The room's phase at the frame, for the spike records; undefined for a local game. */
	state: string | undefined;
	work: ArcadeFrameWork;
	lates: number[];
}

/**
 * The phase of the frame just over: `loading` from a mount until its first ticked frame and
 * {@link LOADING_TAIL_MS} after, then what the tick said.
 */
function phaseOf(now: number): ArcadePhase {
	const ticked = arcadePerf.phase;
	if (arcadePerf.mountedAt !== undefined) {
		if (arcadePerf.tickedAt === undefined && ticked !== undefined) arcadePerf.tickedAt = now;
		if (arcadePerf.tickedAt === undefined || now - arcadePerf.tickedAt < LOADING_TAIL_MS)
			return 'loading';
		arcadePerf.mountedAt = undefined;
		arcadePerf.tickedAt = undefined;
	}
	return ticked ?? 'lobby';
}

/** The frame just over: its phase, what it counted, and the room states' lateness. Clears them. */
export function takeArcadeFrame(now = performance.now()): ArcadeFrame {
	const frame: ArcadeFrame = {
		phase: phaseOf(now),
		state: arcadePerf.room,
		work: { ...arcadePerf.counts },
		lates: arcadePerf.lates.splice(0),
	};
	frame.work.simCatchUp = frame.work.simSteps > 1 ? 1 : 0;
	Object.assign(arcadePerf.counts, zero());
	arcadePerf.phase = undefined;
	return frame;
}
