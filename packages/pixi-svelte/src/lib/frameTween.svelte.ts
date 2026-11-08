import { FrameTweenCore, type FrameSetOptions } from './frameClock';

/**
 * A Svelte `Tween<number>` plus where to DRAW it (`frameClock.ts`). `current`, `target` and the
 * promise `set` returns are the tween's own, so the motion logic and everything awaiting it run
 * exactly as with a plain `Tween`; `drawn` is the value sampled at each frame's timestamp before
 * Pixi draws that frame. Read `drawn` for where something is on screen, `current` for logic.
 */
export class FrameTween {
	#drawn: number;
	readonly #core: FrameTweenCore;

	constructor(value: number) {
		this.#drawn = $state(value);
		this.#core = new FrameTweenCore(value, (drawn) => (this.#drawn = drawn));
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

	set(value: number, options?: FrameSetOptions): Promise<void> {
		return this.#core.set(value, options);
	}
}
