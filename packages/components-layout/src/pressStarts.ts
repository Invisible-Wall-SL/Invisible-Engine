/**
 * The presses that STARTED on one press surface, so the surface acts only on a press that began on
 * it — never on the release of a press that was already in progress when it mounted.
 *
 * A surface that acts on pointer-UP and mounts mid-press otherwise takes that press as its own: the
 * free-spin outro's tap-to-skip lands the count on pointer-DOWN, the count-up completing arms the
 * outro's tap-to-continue, and the same press's pointer-UP dismissed the outro the player tapped to
 * read. Pixi reports the release to whatever is on top at the time, so the only way to tell a fresh
 * press from a straddling one is to have seen its DOWN.
 *
 * Keyed by `pointerId` so two fingers are two presses. A press released off the surface
 * (`pointerupoutside`) is forgotten. Import-free, so fixtures can load it headlessly.
 */
export type PressStarts<T> = {
	/** Pointer-DOWN on the surface: the press starts here, on `startedOn`. */
	down(pointerId: number, startedOn: T): void;
	/** Pointer-UP on the surface: what the press started on, or `null` when it started before the
	 *  surface existed (or elsewhere) — the caller must then do nothing. */
	up(pointerId: number): { startedOn: T } | null;
	/** The press ended off the surface. */
	cancel(pointerId: number): void;
};

export const createPressStarts = <T>(): PressStarts<T> => {
	const started = new Map<number, T>();
	return {
		down: (pointerId, startedOn) => {
			started.set(pointerId, startedOn);
		},
		up: (pointerId) => {
			if (!started.has(pointerId)) return null;
			const startedOn = started.get(pointerId) as T;
			started.delete(pointerId);
			return { startedOn };
		},
		cancel: (pointerId) => {
			started.delete(pointerId);
		},
	};
};
