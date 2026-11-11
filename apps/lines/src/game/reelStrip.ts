/**
 * ONE REEL'S STRIP, AS ONE BOARD LAYER DRAWS IT — the plain half of `reelStripView.svelte.ts`: where
 * each cell is placed, which cells the window holds and each watched cell's answer, as plain code
 * over the reel's DRAWN position (`createReelForSpinning`'s `strip`), so a fixture runs them without
 * a canvas or Svelte.
 *
 * Every test here is `SymbolWrap`'s or `ReelPaddingPool`'s own comparison, evaluated per strip index
 * at the `y` they computed (`cellY`, `symbolY`'s expression): an index threshold is only where that
 * comparison flips, so it decides exactly what the per-cell test decided.
 */

/** What the board needs from a reel (`createReelForSpinning`'s `strip`). */
export type StripSource = {
	drawnY(): number;
	listen(listener: (drawnY: number) => void): () => void;
	cellY(symbolIndex: number, drawnY: number): number;
};

/** The window a layer culls a reel's cells against: `SymbolWrap`'s `top`, `bottom` and margin. */
export type StripWindow = {
	top: number;
	bottom: number;
	/** Half a row: how far past the window a rolling cell on the masked layer is drawn. */
	halfRow: number;
	/** The reel is rolling (`reelState.rolling`). */
	rolling: boolean;
};

/** Where the window's edges fall on the strip, in strip indices. */
export type StripMeasure = {
	/** The cull's margin: half a row on the masked layer while rolling, else 0. */
	margin: number;
	/** Cells `lo`..`hi` are in the window. */
	lo: number;
	hi: number;
	/** Below this index a cell's centre is above the top edge: drawn there, it is held. */
	heldFrom: number;
	/** From this index on, a cell's row has touched the top edge (`ReelPaddingPool`'s entry). */
	enteredFrom: number;
};

/** The first integer `i` for which `test(i)` holds, for a test false below some `i` and true above. */
function firstTrue(test: (i: number) => boolean, guess: number): number {
	let i = Number.isFinite(guess) ? Math.floor(guess) : 0;
	// The guess is within a row or two of the answer; this many steps means the test never flips.
	for (let steps = 0; steps < 64; steps++) {
		if (test(i)) {
			if (!test(i - 1)) return i;
			i--;
		} else i++;
	}
	return test(i) ? -Infinity : Infinity;
}

/**
 * The window's edges on a strip drawn at `drawnY`. `animate`: the unmasked layer, which culls on the
 * centre alone.
 */
export function measureStrip(
	cellY: StripSource['cellY'],
	drawnY: number,
	{ top, bottom, halfRow, rolling }: StripWindow,
	animate: boolean,
): StripMeasure {
	const y = (i: number) => cellY(i, drawnY);
	const y0 = y(0);
	const pitch = y(1) - y0;
	const rowOf = (at: number) => (pitch > 0 ? (at - y0) / pitch : 0);
	const margin = rolling && !animate ? halfRow : 0;
	// `SymbolWrap`'s cull, both forms: the centre inside the window, or, rolling on the masked layer,
	// any part of the row overlapping it.
	const lo =
		margin === 0
			? firstTrue((i) => y(i) >= top, rowOf(top))
			: firstTrue((i) => y(i) + margin > top, rowOf(top - margin));
	const hi =
		(margin === 0
			? firstTrue((i) => !(y(i) <= bottom), rowOf(bottom))
			: firstTrue((i) => !(y(i) - margin < bottom), rowOf(bottom + margin))) - 1;
	const enterAt = top - halfRow;
	return {
		margin,
		lo,
		hi,
		heldFrom: firstTrue((i) => !(y(i) < top), rowOf(top)),
		enteredFrom: firstTrue((i) => !(y(i) <= enterAt), rowOf(enterAt)),
	};
}

/** A cell container a placer positions, and the strip cell it draws. */
type Placed = { container: { y: number }; cell: { symbolIndex: number } };

/** Writes attached cell containers' `y` from the strip's drawn position: no Svelte in the loop. */
export class StripPlacer {
	readonly #cellY: StripSource['cellY'];
	readonly #placed = new Set<Placed>();

	constructor(cellY: StripSource['cellY']) {
		this.#cellY = cellY;
	}

	/** Place `container` as `cell` at `drawnY` now and on every `place` after; returns the release. */
	attach(container: { y: number }, cell: { symbolIndex: number }, drawnY: number): () => void {
		const placed: Placed = { container, cell };
		this.#placed.add(placed);
		container.y = this.#cellY(cell.symbolIndex, drawnY);
		return () => this.#placed.delete(placed);
	}

	/** Place every attached container for a strip drawn at `drawnY`. */
	place(drawnY: number): void {
		for (const { container, cell } of this.#placed)
			container.y = this.#cellY(cell.symbolIndex, drawnY);
	}
}

/** Where a watched cell's cull is written: `ReelStripView`'s `$state` holder. */
export type CullTarget = { inFrame: boolean; held: boolean };

type Watched = { target: CullTarget; cell: { symbolIndex: number } };

/**
 * Answers each watched cell's cull from the strip's thresholds — in the window (`lo`..`hi`) and
 * held (drawn above the window, its centre not yet in) — writing a field only when it changes, so a
 * crossing writes to the cells that crossed and to no other.
 */
export class StripCuller {
	#measured: StripMeasure = { margin: 0, lo: 0, hi: -1, heldFrom: -Infinity, enteredFrom: 0 };
	readonly #watched = new Set<Watched>();

	/** Answer `cell`'s cull into `target` now and on every `measure`; returns the release. */
	watch(cell: { symbolIndex: number }, target: CullTarget): () => void {
		const watched: Watched = { target, cell };
		this.#watched.add(watched);
		this.#cull(watched);
		return () => this.#watched.delete(watched);
	}

	/** Take the strip's new thresholds, re-answering every watched cell if they moved. */
	measure(next: StripMeasure): void {
		const last = this.#measured;
		this.#measured = next;
		if (
			next.lo === last.lo &&
			next.hi === last.hi &&
			next.heldFrom === last.heldFrom &&
			next.margin === last.margin
		)
			return;
		for (const watched of this.#watched) this.#cull(watched);
	}

	#cull({ target, cell }: Watched): void {
		const { lo, hi, heldFrom, margin } = this.#measured;
		const index = cell.symbolIndex;
		const inFrame = index >= lo && index <= hi;
		const held = margin > 0 && index < heldFrom;
		if (target.inFrame !== inFrame) target.inFrame = inFrame;
		if (target.held !== held) target.held = held;
	}
}
