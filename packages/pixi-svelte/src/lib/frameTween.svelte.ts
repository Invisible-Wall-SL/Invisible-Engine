import { FrameTweenCore, type FrameDrawnListener, type FrameSetOptions } from './frameClock';

/**
 * A Svelte `Tween<number>` plus where to DRAW it (`frameClock.ts`). `current`, `target` and the
 * promise `set` returns are the tween's own, so the motion logic and everything awaiting it run
 * exactly as with a plain `Tween`; `drawn` is the value sampled at each frame's timestamp before
 * Pixi draws that frame. Read `drawn` for where something is on screen, `current` for logic.
 *
 * `drawn` is reactive, for the few readers that place art through Svelte. A board that draws many
 * cells reads {@link drawnNow} and {@link listen} instead and writes their positions itself, so a
 * moving strip costs Svelte nothing per frame.
 */
export class FrameTween {
	#drawn: number;
	readonly #core: FrameTweenCore;

	constructor(value: number) {
		this.#drawn = $state(value);
		this.#core = new FrameTweenCore(value);
		this.#core.motion.listen((drawn) => (this.#drawn = drawn));
	}

	get current(): number {
		return this.#core.tween.current;
	}

	get target(): number {
		return this.#core.tween.target;
	}

	get drawn(): number {
		return this.#drawn;
	}

	/** Where this frame draws it, read without subscribing. */
	get drawnNow(): number {
		return this.#core.motion.drawn;
	}

	/** Tell `listener` each new drawn value, as it is made; returns the release. */
	listen(listener: FrameDrawnListener): () => void {
		return this.#core.motion.listen(listener);
	}

	set(value: number, options?: FrameSetOptions): Promise<void> {
		return this.#core.set(value, options);
	}
}
