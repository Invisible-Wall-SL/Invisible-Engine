/**
 * ONE REEL'S STRIP, AS ONE BOARD LAYER DRAWS IT, kept off Svelte's per-frame path.
 *
 * A rolling cell used to read its reel's position reactively: every frame, every cell of both board
 * layers re-derived its `y`, its cull test and its hold, and synced its container's props. Here the
 * reel's DRAWN position (`createReelForSpinning`'s `strip`, stepped before the Pixi tick) is handed
 * to the view as it is made, and the view
 *  - writes each attached cell container's `y` itself (`StripPlacer`, `symbolY`'s expression), and
 *  - turns the position into index thresholds (`measureStrip`) and writes them to `$state` only when
 *    they change, so a cell's mount, cull and hold re-run on the frames a cell crosses an edge and
 *    on no other.
 * Flat boards only: under perspective a cell's seat is not the strip's lattice, and those cells keep
 * the reactive path (`symbolY()`).
 */

import { untrack } from 'svelte';

import {
	measureStrip,
	StripPlacer,
	type StripMeasure,
	type StripSource,
	type StripWindow,
} from './reelStrip';

export class ReelStripView {
	lo = $state(0);
	hi = $state(-1);
	heldFrom = $state(-Infinity);
	margin = $state(0);
	enteredFrom = $state(0);

	readonly #source: StripSource;
	readonly #animate: boolean;
	readonly #window: () => StripWindow;
	readonly #placer: StripPlacer;

	constructor(source: StripSource, animate: boolean, window: () => StripWindow) {
		this.#source = source;
		this.#animate = animate;
		this.#window = window;
		this.#placer = new StripPlacer(source.cellY);
		untrack(() => this.#measure(source.drawnY(), window()));
	}

	/** Strip index `index` is in the window. */
	contains(index: number): boolean {
		return index >= this.lo && index <= this.hi;
	}

	/** Strip index `index` is drawn before its centre reaches the window. */
	holds(index: number): boolean {
		return this.margin > 0 && index < this.heldFrom;
	}

	/**
	 * Re-read the window and the reel's lattice — tracked, so the caller's effect re-runs when either
	 * changes — then re-place every attached cell and re-measure.
	 */
	refresh(): void {
		const window = this.#window();
		this.#source.cellY(0, 0);
		this.#source.cellY(1, 0);
		untrack(() => this.#update(this.#source.drawnY(), window));
	}

	/** Follow the reel's drawn position; returns the release. */
	connect(): () => void {
		return this.#source.listen((drawnY) => untrack(() => this.#update(drawnY, this.#window())));
	}

	/** Position `container` as strip cell `cell`, now and from now on; returns the release. */
	attach(container: { y: number }, cell: { symbolIndex: number }): () => void {
		return untrack(() => this.#placer.attach(container, cell, this.#source.drawnY()));
	}

	#update(drawnY: number, window: StripWindow): void {
		this.#placer.place(drawnY);
		this.#measure(drawnY, window);
	}

	#measure(drawnY: number, window: StripWindow): void {
		const next: StripMeasure = measureStrip(this.#source.cellY, drawnY, window, this.#animate);
		if (this.margin !== next.margin) this.margin = next.margin;
		if (this.lo !== next.lo) this.lo = next.lo;
		if (this.hi !== next.hi) this.hi = next.hi;
		if (this.heldFrom !== next.heldFrom) this.heldFrom = next.heldFrom;
		if (this.enteredFrom !== next.enteredFrom) this.enteredFrom = next.enteredFrom;
	}
}
