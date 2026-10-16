import {
	FREE_SPIN_INTRO_COUNT_SOURCE,
	FREE_SPIN_INTRO_HIDE_SIGNAL,
	FREE_SPIN_INTRO_SHOW_SIGNAL,
	FREE_SPIN_OUTRO_BIG_SIGNAL,
	FREE_SPIN_OUTRO_HIDE_SIGNAL,
	FREE_SPIN_OUTRO_SMALL_SIGNAL,
	freeSpinPresentationDefs,
	registerBoardBox,
	registerComponentSignals,
	registerComponentValues,
	registerComponents,
	type BoardBox,
	type ComponentDef,
	type SignalSource,
} from 'engine-layout';
import { SYMBOL_SIZE, eventSignal, retireCodedOverlay, textSource } from 'engine-game';

/**
 * THE AUTHORED FREE-SPIN INTRO / OUTRO, game side (Rive plan Phase 8c,
 * `docs/design/rive-style-editor.md` §13.7): what `apps/lines` feeds the built-in presentations —
 * the two defs generated for this boot's board and language, the intro count (the number the coded
 * visual took off `freeSpinIntroUpdate`, `0` until it arrives) and the show / hide signals. Everything
 * here is registered by `Game.svelte` (`startAuthoredFreeSpins`) only when the doc's flag resolves
 * `ready`, and torn down with the game.
 */

/** Subscribes `run` to one emitter event; returns the unsubscribe (the game passes the emitter). */
type On<T = void> = (run: (value: T) => void) => () => void;

const introCount = $state({ value: 0 });
/** The boot that started the path last: an older boot's teardown leaves the module state alone. */
let latestBoot = 0;

/** The two presentation defs for this boot: the coded sizes off the board, the sprites in `lang`. */
export function authoredFreeSpinDefs(boardColumns: number, lang: string): ComponentDef[] {
	const { intro, outro } = freeSpinPresentationDefs({
		symbolSize: SYMBOL_SIZE,
		boardColumns,
		lang,
	});
	return [intro, outro];
}

/**
 * Animation frames requested by a signal and not yet run. Each is cancelled when the subscription
 * that asked for it goes (an instance unmounting between the event and the next frame) and when
 * the path is disposed, so no fire lands on a torn-down instance.
 */
function frameDelay() {
	let pending: number[] = [];
	const later = (run: () => void): void => {
		const id = requestAnimationFrame(() => {
			pending = pending.filter((other) => other !== id);
			run();
		});
		pending.push(id);
	};
	const cancel = (): void => {
		for (const id of pending) cancelAnimationFrame(id);
		pending = [];
	};
	return { later, cancel };
}

/**
 * The presentations' show / hide signals, each fired one animation frame after the emitter event the
 * coded visual reacted to: its `FadeContainer` starts the tween (and mounts the rigs) on the tick
 * after, and so do these. The outro shows by the win level the driver's `freeSpinOutroCountUp`
 * carries — the event the coded visual mounted on. Every subscription's unsubscribe also cancels
 * the frame it requested and has not run.
 */
export function authoredFreeSpinSignals(on: {
	introShow: On;
	introHide: On;
	outroCountUp: On<boolean>;
	outroHide: On;
}): Record<string, SignalSource> {
	const delayed = <T>(subscribe: On<T>, when: (value: T) => boolean = () => true) =>
		eventSignal((run) => {
			const frames = frameDelay();
			const unsubscribe = subscribe((value) => {
				if (when(value)) frames.later(() => run());
			});
			return () => {
				unsubscribe();
				frames.cancel();
			};
		});
	return {
		[FREE_SPIN_INTRO_SHOW_SIGNAL]: delayed(on.introShow),
		[FREE_SPIN_INTRO_HIDE_SIGNAL]: delayed(on.introHide),
		[FREE_SPIN_OUTRO_BIG_SIGNAL]: delayed(on.outroCountUp, (big) => big),
		[FREE_SPIN_OUTRO_SMALL_SIGNAL]: delayed(on.outroCountUp, (big) => !big),
		[FREE_SPIN_OUTRO_HIDE_SIGNAL]: delayed(on.outroHide),
	};
}

/**
 * Turn the authored path on for this boot: retire the coded visuals, then register the show / hide
 * signals, the intro count (the number the coded visual took off `freeSpinIntroUpdate`, `0` until it
 * arrives), the live board the presentations sit on (`ComponentDef.boardAnchored` — the same
 * `boardLayout()` the coded `FreeSpinAnimation` centred on) and the two defs generated for this
 * board and language. Returns the teardown the game runs when it is destroyed: the emitter
 * subscription, every registration and the retire are undone, so a later boot (a project switch)
 * starts from nothing. The defs stay registered: an internal def nothing places is inert.
 */
export function startAuthoredFreeSpins(deps: {
	signals: Parameters<typeof authoredFreeSpinSignals>[0];
	onIntroUpdate: On<number>;
	board: () => BoardBox | undefined;
	boardColumns: number;
	lang: string;
}): () => void {
	const boot = ++latestBoot;
	retireCodedOverlay('freeSpins');
	introCount.value = 0;
	const unsubscribeCount = deps.onIntroUpdate((total) => {
		introCount.value = total;
	});
	const unregisterSignals = registerComponentSignals(authoredFreeSpinSignals(deps.signals));
	const unregisterValues = registerComponentValues({
		[FREE_SPIN_INTRO_COUNT_SOURCE]: textSource(() => String(introCount.value)),
	});
	const unregisterBoard = registerBoardBox(deps.board);
	registerComponents(
		Object.fromEntries(
			authoredFreeSpinDefs(deps.boardColumns, deps.lang).map((def) => [def.id, def]),
		),
	);
	return () => {
		unsubscribeCount();
		unregisterSignals();
		unregisterValues();
		unregisterBoard();
		if (boot !== latestBoot) return;
		retireCodedOverlay('freeSpins', false);
		introCount.value = 0;
	};
}
