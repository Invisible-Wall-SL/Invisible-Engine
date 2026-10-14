/**
 * CUE HOLDS (Rive plan Phase 8a, `docs/design/rive-style-editor.md` §13.2): what an awaited cue
 * waits for beyond its emitter subscribers. A placed component instance whose timeline carries
 * `holdsCue` registers, the moment the cue starts that timeline, a promise that settles when the
 * timeline ends (or the instance is destroyed); the game's awaited `fireCue` appends the holds of
 * that cue to the promises it already awaits — and ONLY when there are any, so a cue nobody holds
 * awaits exactly what it awaited before this module existed (parity).
 *
 * Svelte-free and Pixi-free: the instance registers, the Flow runtime reads, the gates drive both.
 */

const holds = new Map<string, Set<Promise<void>>>();

/** Hold `cue` until `until` settles. The hold is dropped once it does, however it does. */
export function holdCue(cue: string, until: Promise<void>): void {
	if (!cue) return;
	const set = holds.get(cue) ?? new Set<Promise<void>>();
	set.add(until);
	holds.set(cue, set);
	const drop = (): void => {
		set.delete(until);
		if (set.size === 0 && holds.get(cue) === set) holds.delete(cue);
	};
	until.then(drop, drop);
}

/** The holds pending on `cue` right now — empty for a cue no instance holds. */
export function cueHolds(cue: string): Promise<void>[] {
	const set = holds.get(cue);
	return set ? [...set] : [];
}

/** Every pending hold, for the gates. */
export function pendingCueHolds(): string[] {
	return [...holds.keys()];
}

/**
 * One instance's side of the holds: the timelines a fired signal holds, each released when the
 * player reports its end (or the instance goes). Plain bookkeeping, kept out of the Svelte file.
 */
export class InstanceCueHolds {
	private readonly releases = new Map<string, (() => void)[]>();

	constructor(private readonly holdsOn: (signal: string) => string[]) {}

	/** Register the holds `signal` opens — none when no timeline holds it. */
	open(signal: string): void {
		const held = this.holdsOn(signal);
		if (!held.length) return;
		holdCue(
			signal,
			Promise.all(
				held.map(
					(id) =>
						new Promise<void>((release) => {
							const releases = this.releases.get(id) ?? [];
							releases.push(release);
							this.releases.set(id, releases);
						}),
				),
			).then(() => undefined),
		);
	}

	/** Release every hold on the timelines in `ids` (the step's `completed`). */
	release(ids: Iterable<string>): void {
		for (const id of ids) {
			const releases = this.releases.get(id);
			if (!releases) continue;
			this.releases.delete(id);
			for (const release of releases) release();
		}
	}

	/** Release everything: the instance is gone, and a hold must never outlive what plays it. */
	releaseAll(): void {
		this.release([...this.releases.keys()]);
	}
}
