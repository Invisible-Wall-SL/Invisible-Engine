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

/** One registered hold: the promise a reader awaits, and the release that settles it early. */
interface Hold {
	promise: Promise<void>;
	release: () => void;
}

const holds = new Map<string, Set<Hold>>();

/**
 * Hold `cue` until `until` settles — or until {@link releaseCueHolds} releases it (Rive plan Phase
 * 8b: a presentation that ends early, on `winHide`, must not leave its tier walk's hold in the map
 * for the next win to read). The hold is dropped once it settles, however it does. Engine-wide but
 * inert unless released: with no release the race settles exactly as `until` does, one microtask
 * later, and nothing but the win's `winHide` releases a hold.
 */
export function holdCue(cue: string, until: Promise<void>): void {
	if (!cue) return;
	const set = holds.get(cue) ?? new Set<Hold>();
	let release = (): void => {};
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	const hold: Hold = { promise: Promise.race([until, released]), release };
	set.add(hold);
	holds.set(cue, set);
	const drop = (): void => {
		set.delete(hold);
		if (set.size === 0 && holds.get(cue) === set) holds.delete(cue);
	};
	hold.promise.then(drop, drop);
}

/** The holds pending on `cue` right now — empty for a cue no instance holds. */
export function cueHolds(cue: string): Promise<void>[] {
	const set = holds.get(cue);
	return set ? [...set].map((hold) => hold.promise) : [];
}

/** Settle and drop every hold pending on `cue` now (its awaiters resolve); none ⇒ a no-op. */
export function releaseCueHolds(cue: string): void {
	const set = holds.get(cue);
	if (!set) return;
	holds.delete(cue);
	for (const hold of set) hold.release();
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
	private readonly holdsOn: (signal: string) => string[];

	// An explicit field, not a parameter property: the root gates load this module under Node's
	// strip-only TypeScript, which rejects parameter properties.
	constructor(holdsOn: (signal: string) => string[]) {
		this.holdsOn = holdsOn;
	}

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
