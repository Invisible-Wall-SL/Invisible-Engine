import {
	FREE_SPIN_INTRO_COUNT_SOURCE,
	FREE_SPIN_INTRO_HIDE_SIGNAL,
	FREE_SPIN_OUTRO_HIDE_SIGNAL,
	freeSpinPresentationDefs,
	type ComponentDef,
	type SignalSource,
	type ValueSource,
} from 'engine-layout';
import { SYMBOL_SIZE, eventSignal, textSource } from 'engine-game';

/**
 * THE AUTHORED FREE-SPIN INTRO / OUTRO, game side (Rive plan Phase 8c,
 * `docs/design/rive-style-editor.md` §13.7): what `apps/lines` feeds the built-in presentations —
 * the two defs generated for this boot's board and language, the intro count (the number the coded
 * visual took off `freeSpinIntroUpdate`, `0` until it arrives) and the two hide signals. Everything
 * here is registered by `Game.svelte` only when the doc's flag resolves `ready`.
 */

/** Subscribes `run` to one emitter event; returns the unsubscribe (the game passes the emitter). */
type On<T = void> = (run: (value: T) => void) => () => void;

const introCount = $state({ value: 0 });

/** The two presentation defs for this boot: the coded sizes off the board, the sprites in `lang`. */
export function authoredFreeSpinDefs(boardColumns: number, lang: string): ComponentDef[] {
	const { intro, outro } = freeSpinPresentationDefs({
		symbolSize: SYMBOL_SIZE,
		boardColumns,
		lang,
	});
	return [intro, outro];
}

/** The intro count source — a text, as the coded `BitmapText` drew the raw number. */
export function authoredFreeSpinValues(onIntroUpdate: On<number>): Record<string, ValueSource> {
	introCount.value = 0;
	onIntroUpdate((total) => {
		introCount.value = total;
	});
	return { [FREE_SPIN_INTRO_COUNT_SOURCE]: textSource(() => String(introCount.value)) };
}

/** The presentations' hide signals, off the emitter events the coded visuals hid on. */
export function authoredFreeSpinSignals(
	onIntroHide: On,
	onOutroHide: On,
): Record<string, SignalSource> {
	return {
		[FREE_SPIN_INTRO_HIDE_SIGNAL]: eventSignal((run) => onIntroHide(() => run())),
		[FREE_SPIN_OUTRO_HIDE_SIGNAL]: eventSignal((run) => onOutroHide(() => run())),
	};
}
