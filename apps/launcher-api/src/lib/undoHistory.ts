/**
 * Bounded snapshot undo/redo over a JSON-serialisable document.
 *
 * Snapshots are stored as JSON TEXT, not objects: a string can't be mutated in place by a later
 * edit, needs no `$state.snapshot`/`structuredClone` dance (both trip on Svelte proxies), and an
 * equality check against the present is a string compare. That compare is load-bearing — the
 * caller re-reports the doc after every edit AND after it applies an undo/redo, and a snapshot
 * equal to the present is ignored, so applying history never records history.
 *
 * COALESCING. A drag or a burst of typing reports many edits; each carries a `key` naming what is
 * being edited (`inspector:<nodeId>`, `comment:<id>`). Consecutive commits with the SAME key inside
 * {@link UndoHistoryOptions.coalesceMs} of each other collapse into one step: the entry pushed at
 * the start of the burst still holds the pre-burst state, only the present moves. A structural
 * edit (add/delete/connect) passes no key and is always its own step. Undo/redo end any burst.
 */
export interface UndoHistoryOptions {
	/** Max undo steps kept; the oldest drop off first. */
	limit?: number;
	/** How close together two same-key commits must be to merge into one step. */
	coalesceMs?: number;
	/** Clock, injectable for tests. */
	now?: () => number;
}

export class UndoHistory {
	#past: string[] = [];
	#future: string[] = [];
	#present: string;
	#burstKey: string | null = null;
	#burstAt = 0;
	readonly #limit: number;
	readonly #coalesceMs: number;
	readonly #now: () => number;

	constructor(initial: string, opts: UndoHistoryOptions = {}) {
		this.#present = initial;
		this.#limit = opts.limit ?? 100;
		this.#coalesceMs = opts.coalesceMs ?? 800;
		this.#now = opts.now ?? Date.now;
	}

	get canUndo(): boolean {
		return this.#past.length > 0;
	}

	get canRedo(): boolean {
		return this.#future.length > 0;
	}

	get undoDepth(): number {
		return this.#past.length;
	}

	get present(): string {
		return this.#present;
	}

	/** Record the doc as it is AFTER an edit. Returns whether a new undo step was opened. */
	commit(next: string, key?: string): boolean {
		if (next === this.#present) return false;
		const at = this.#now();
		const merge =
			key !== undefined && key === this.#burstKey && at - this.#burstAt <= this.#coalesceMs;
		this.#burstKey = key ?? null;
		this.#burstAt = at;
		this.#future = [];
		if (merge) {
			this.#present = next;
			return false;
		}
		this.#past.push(this.#present);
		if (this.#past.length > this.#limit) this.#past.splice(0, this.#past.length - this.#limit);
		this.#present = next;
		return true;
	}

	/** Step back; returns the snapshot to apply, or `null` when there is nothing to undo. */
	undo(): string | null {
		const prev = this.#past.pop();
		if (prev === undefined) return null;
		this.#future.push(this.#present);
		this.#present = prev;
		this.#burstKey = null;
		return prev;
	}

	/** Step forward; returns the snapshot to apply, or `null` when there is nothing to redo. */
	redo(): string | null {
		const next = this.#future.pop();
		if (next === undefined) return null;
		this.#past.push(this.#present);
		this.#present = next;
		this.#burstKey = null;
		return next;
	}

	/** Forget every step and adopt `baseline` (after a load that replaces the doc wholesale). */
	reset(baseline: string): void {
		this.#past = [];
		this.#future = [];
		this.#present = baseline;
		this.#burstKey = null;
	}
}
