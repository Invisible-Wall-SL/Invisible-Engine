/**
 * Invisible Engine — THE WIN WALK, as a pure conductor (Rive plan Phase 8b, §13.6.5).
 *
 * The tier walk `WinAnimation.svelte` keeps in runes — intro → one idle → next tier … → the final
 * tier's looping idle; `countUpComplete` flips the final tier to its outro (or collapses a mid-walk
 * chain to it); `holdOutro` keeps the idle for the land-then-dismiss hold; a tap jumps the walk
 * forward — as `nextStep(walk, event)` over plain data. On the authored path the GATE runs it: each
 * step FIRES a per-tier signal the placed `winPresentation` instance plays a timeline on, and the
 * hold that timeline registers (`cueHolds`) is the clock the coded rig `complete` was. Dependency-
 * light, so `packages/engine-game/fixtures/*.fixture.ts` replay it step for step.
 */

export type WinWalkPhase = 'idle' | 'walk' | 'loop' | 'outro' | 'plain' | 'done';

export interface WinWalkTier {
	alias: string;
	/** Whether the tier has a distinct exit clip (`tierHasExit`). */
	hasExit: boolean;
	/** The count-up amount (book units) the tier begins at — what a tap seeks the count to. */
	boundaryAmount: number;
}

/** The signal each phase fires — `engine-layout`'s `winTierSignal` & co., handed in so this module
 *  stays dependency-free for the fixtures (Node's strip-only TypeScript cannot load that package's
 *  index); the names themselves have one home, beside the timelines they start. */
export interface WinWalkSignals {
	tier(alias: string): string;
	loop(alias: string): string;
	outro(alias: string): string;
	plain: string;
}

export interface WinWalk {
	signals: WinWalkSignals;
	/** The chain (escalating), the single tier, or `[]` for a plain small / medium number. */
	tiers: readonly WinWalkTier[];
	escalating: boolean;
	index: number;
	phase: WinWalkPhase;
	countUpComplete: boolean;
	holdOutro: boolean;
	concluded: boolean;
	/** Bumped on every fire; a hold's end counts only when it carries the step it was fired at. */
	step: number;
}

export type WinWalkEvent =
	| { type: 'start' }
	| { type: 'holdEnd'; step: number }
	| { type: 'countUpComplete' }
	| { type: 'tap'; toTier: number }
	| { type: 'holdOutro'; on: boolean };

export type WinWalkEffect =
	/** Fire `signal`; when `holds`, await the hold it opens and report `holdEnd` with `step`. */
	| { kind: 'fire'; signal: string; step: number; holds: boolean }
	| { kind: 'stepIndex'; index: number }
	| { kind: 'outroComplete' };

export function createWinWalk(
	tiers: readonly WinWalkTier[],
	escalating: boolean,
	signals: WinWalkSignals,
): WinWalk {
	return {
		signals,
		tiers,
		escalating,
		index: 0,
		phase: 'idle',
		countUpComplete: false,
		holdOutro: false,
		concluded: false,
		step: 0,
	};
}

const fire = (
	walk: WinWalk,
	signal: string,
	holds: boolean,
): { walk: WinWalk; effect: WinWalkEffect } => {
	const step = walk.step + 1;
	return { walk: { ...walk, step }, effect: { kind: 'fire', signal, step, holds } };
};

const walkTo = (walk: WinWalk, index: number): { walk: WinWalk; effects: WinWalkEffect[] } => {
	const fired = fire(
		{ ...walk, index, phase: 'walk' },
		walk.signals.tier(walk.tiers[index].alias),
		true,
	);
	return { walk: fired.walk, effects: [{ kind: 'stepIndex', index }, fired.effect] };
};

/** Conclude the chain on the final tier: its outro when it has one, else done at once. */
const conclude = (walk: WinWalk): { walk: WinWalk; effects: WinWalkEffect[] } => {
	const last = walk.tiers.length - 1;
	const effects: WinWalkEffect[] = [];
	let next: WinWalk = { ...walk, concluded: true };
	if (next.index !== last) {
		next = { ...next, index: last };
		effects.push({ kind: 'stepIndex', index: last });
	}
	if (!walk.tiers[last].hasExit) {
		effects.push({ kind: 'outroComplete' });
		return { walk: { ...next, phase: 'done' }, effects };
	}
	const fired = fire({ ...next, phase: 'outro' }, walk.signals.outro(walk.tiers[last].alias), true);
	return { walk: fired.walk, effects: [...effects, fired.effect] };
};

export function nextStep(
	walk: WinWalk,
	event: WinWalkEvent,
): { walk: WinWalk; effects: WinWalkEffect[] } {
	const none = { walk, effects: [] as WinWalkEffect[] };
	const last = walk.tiers.length - 1;
	switch (event.type) {
		case 'start': {
			if (!walk.tiers.length) {
				const fired = fire({ ...walk, phase: 'plain' }, walk.signals.plain, false);
				return { walk: fired.walk, effects: [fired.effect] };
			}
			return walkTo(walk, 0);
		}
		case 'holdEnd': {
			// A stale hold (a tap or the collapse fired past it) is ignored by its step.
			if (event.step !== walk.step) return none;
			if (walk.phase === 'walk') {
				if (walk.index < last) return walkTo(walk, walk.index + 1);
				// The final tier's idle loops until the overlay hides (the single-tier path exactly).
				const fired = fire(
					{ ...walk, phase: 'loop' },
					walk.signals.loop(walk.tiers[last].alias),
					false,
				);
				return { walk: fired.walk, effects: [fired.effect] };
			}
			if (walk.phase === 'outro') {
				return { walk: { ...walk, phase: 'done' }, effects: [{ kind: 'outroComplete' }] };
			}
			return none;
		}
		case 'countUpComplete': {
			const next = { ...walk, countUpComplete: true };
			// Un-escalating ⇒ nothing: the idle keeps looping and the gate concludes on its own.
			if (!walk.escalating || !walk.tiers.length || walk.concluded)
				return { walk: next, effects: [] };
			// The landing tap is holding the total on screen — stay on the idle; the collapse below
			// still runs if the hold lapses (`holdOutro` off while the count is complete).
			if (walk.holdOutro) return { walk: next, effects: [] };
			return conclude(next);
		}
		case 'tap': {
			if (!walk.escalating || walk.concluded || walk.phase === 'outro') return none;
			const target = Math.min(event.toTier, last);
			if (target <= walk.index) return none;
			return walkTo(walk, target);
		}
		case 'holdOutro': {
			const next = { ...walk, holdOutro: event.on };
			if (!event.on && walk.countUpComplete && walk.escalating && !walk.concluded) {
				return conclude(next);
			}
			return { walk: next, effects: [] };
		}
	}
}

/**
 * What a fire's hold resolves to, read the way the gate reads it: the holds registered
 * SYNCHRONOUSLY in the bus callback are read right after the fire; when there are none — the
 * instance mounted a frame late, or is not on screen — ONE deferred re-read follows (a late instance
 * that subscribes while the phase is current is seeded and registers its hold then), and when that
 * is empty too the step falls through at once, as the coded gate concludes without a mounted
 * visual. Never hangs: a hold settles when its timeline ends or its instance is destroyed.
 */
export async function awaitFireHolds(
	read: () => Promise<void>[],
	defer: () => Promise<void>,
): Promise<'held' | 'empty'> {
	let holds = read();
	if (!holds.length) {
		await defer();
		holds = read();
	}
	if (!holds.length) return 'empty';
	await Promise.all(holds);
	return 'held';
}
