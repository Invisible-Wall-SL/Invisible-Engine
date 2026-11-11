/**
 * ONE REEL'S STRIP, AS ONE BOARD LAYER DRAWS IT, kept off Svelte's per-frame path.
 *
 * A rolling cell used to read its reel's position reactively: every frame, every cell of both board
 * layers re-derived its `y`, its cull test and its hold, and synced its container's props. Here the
 * reel's DRAWN position (`createReelForSpinning`'s `strip`, stepped before the Pixi tick) is handed
 * to the view as it is made, and the view
 *  - writes each attached cell container's `y` itself (`StripPlacer`, `symbolY`'s expression), and
 *  - turns the position into index thresholds (`measureStrip`) and, for each watched cell, writes
 *    its cull and hold to that cell's own `$state` ({@link StripCull}) only when they change, so a
 *    cell's mount, cull and hold re-run on the frames THAT cell crosses an edge and on no other: a
 *    crossing marks nothing in the cells that did not cross.
 * Flat boards only: under perspective a cell's seat is not the strip's lattice, and those cells keep
 * the reactive path (`symbolY()`).
 */

import { untrack } from 'svelte';

import {
	measureStrip,
	StripCuller,
	StripPlacer,
	type CullTarget,
	type StripSource,
	type StripWindow,
} from './reelStrip';

/** One cell's cull as its reel's strip view answers it (`StripCuller`), as `$state`. */
export class StripCull implements CullTarget {
	inFrame = $state(false);
	held = $state(false);
}

export class ReelStripView {
	/** From this index on, a cell's row has touched the top edge (`ReelPaddingPool`'s entry). */
	enteredFrom = $state(0);

	readonly #culler = new StripCuller();
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

	/** Answer `cell`'s cull into `cull`, now and on every drawn value; returns the release. */
	watch(cell: { symbolIndex: number }, cull: StripCull): () => void {
		return untrack(() => this.#culler.watch(cell, cull));
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
		const next = measureStrip(this.#source.cellY, drawnY, window, this.#animate);
		if (this.enteredFrom !== next.enteredFrom) this.enteredFrom = next.enteredFrom;
		this.#culler.measure(next);
	}
}
