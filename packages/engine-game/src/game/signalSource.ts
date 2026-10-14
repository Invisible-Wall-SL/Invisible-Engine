import type { SignalSource } from 'engine-layout';
import type { EventScope } from 'utils-event-emitter';

/**
 * Wrap a bare subscribe fn as a {@link SignalSource} — the EVENT sibling of
 * {@link valueSource}/{@link boolSource}/{@link textSource}. Where those push a
 * current value SYNCHRONOUSLY on subscribe (store contract), a signal source is an
 * event notifier: `run` is invoked each time the signal fires (the game maps a
 * book/presentation event → this), so there is no first-paint value to seed. The
 * passed `subscribe` wires the emitter event(s) and returns the unsubscribe, which
 * we forward verbatim. So a registered signal replays the live game event to a
 * rig cue named for that signal on whichever `componentInstance` binds it. A fire
 * about one part of a repeated feature passes its scope to `run` (Phase 12a), and
 * only the instances scoped to it react.
 */
export function eventSignal(
	subscribe: (run: (scope?: EventScope) => void) => () => void,
): SignalSource {
	return { subscribe };
}

/**
 * A signal the GAME fires by hand (Rive plan Phase 8b: the win conductor's per-tier signals), with
 * an optional SEED: a subscriber that arrives while `seeded()` is true is run at once, so an
 * instance that mounts a frame after the fire still plays the current phase (the emitter has no
 * replay; the `winCountUpComplete` latch is the precedent).
 */
export interface ManualSignal extends SignalSource {
	fire(scope?: EventScope): void;
}

export function manualSignal(seeded: () => boolean = () => false): ManualSignal {
	const runs = new Set<(scope?: EventScope) => void>();
	return {
		subscribe(run) {
			runs.add(run);
			if (seeded()) run();
			return () => {
				runs.delete(run);
			};
		},
		fire(scope) {
			for (const run of [...runs]) run(scope);
		},
	};
}
