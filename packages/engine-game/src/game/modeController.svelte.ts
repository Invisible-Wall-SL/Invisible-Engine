import { modeOpOf, type ModeOp } from './modeEvents';
import {
	activeModeId,
	emptyModeStack,
	enterMode,
	exitMode,
	restoreModes,
	type ModeStackState,
	type ModeStep,
	type ModeTransition,
} from './modeStack';

export type ModeControllerDeps = {
	/** The `stateGame.gameType` a mode sets while it is on top (`game-config` `gameTypeForMode`). */
	gameTypeOf: (modeId: string) => string;
	/** Write `stateGame.gameType`. */
	setGameType: (gameType: string) => void;
	/**
	 * Present one transition — the flow's mode events and the coded defaults. Awaited in order, so an
	 * authored intro finishes before the mode's first book event plays.
	 */
	present?: (transition: ModeTransition) => void | Promise<void>;
};

/**
 * The game's MODE STACK as reactive state, driven from the play pipeline's seam (`playBook.ts`) so
 * every dispatch path — coded, v1 flow, v2 flow — moves it the same way. The rules live in
 * `modeStack.ts`; this holder applies them, keeps `stateGame.gameType` in step, and presents each
 * transition.
 *
 * Inert for a book with no mode events: no transition, no write, so a base-game round is untouched.
 */
export function createModeController(deps: ModeControllerDeps) {
	const state = $state<{ current: ModeStackState }>({ current: emptyModeStack() });

	/**
	 * Stack ops asked for WHILE a transition is being presented (an Enter / Exit mode flow node inside a
	 * Mode trigger chain). They run once that step has finished presenting, in order, so a nested op
	 * never moves the stack under a step that is still presenting — and the caller is not made to wait
	 * for the presentation it is part of, which would deadlock.
	 */
	let presenting = 0;
	const deferred: (() => Promise<void>)[] = [];
	const whenSettled = (run: () => Promise<void>): Promise<void> => {
		if (presenting === 0) return run();
		deferred.push(run);
		return Promise.resolve();
	};

	const apply = async (step: ModeStep, op: ModeOp | undefined): Promise<void> => {
		presenting++;
		try {
			await present(step, op);
		} finally {
			presenting--;
		}
		while (presenting === 0 && deferred.length) await deferred.shift()!();
	};

	const present = async (step: ModeStep, op: ModeOp | undefined): Promise<void> => {
		state.current = step.state;
		for (const transition of step.transitions) {
			// The free-spin aliases' own handlers write the game type, each at its own moment (the
			// coded trigger, or the flow's `setFreeGameType` after an intro). Writing it here too would
			// move that moment, so the mode layer stays out of exactly those two transitions.
			const ownWrite =
				op?.legacyGameType &&
				(transition.kind === 'allFinished' ||
					(transition.kind === 'exit' && op.op === 'exit') ||
					(transition.kind === 'enter' && op.op === 'enter'));
			if (!ownWrite && transition.kind !== 'merge' && transition.kind !== 'queued') {
				deps.setGameType(deps.gameTypeOf(activeModeId(step.state)));
			}
			await deps.present?.(transition);
		}
	};

	// The step is computed when the op RUNS (not when it was asked for), so a deferred op sees the
	// stack the presentation before it left.
	const run = (op: ModeOp): Promise<void> =>
		apply(
			op.op === 'enter'
				? enterMode(state.current, op.id, op)
				: exitMode(state.current, op.id, { total: op.total }),
			op,
		);

	return {
		/** The current stack + queue (reactive). */
		get state(): ModeStackState {
			return state.current;
		},
		/** The mode on screen (reactive): the top of the stack, else `basegame`. */
		active: (): string => activeModeId(state.current),
		/** Before an event is presented: open the mode it enters. */
		before: async (bookEvent: { type: string }): Promise<void> => {
			const op = modeOpOf(bookEvent);
			if (op?.op === 'enter') await run(op);
		},
		/** After an event is presented: close the mode it exits. */
		after: async (bookEvent: { type: string }): Promise<void> => {
			const op = modeOpOf(bookEvent);
			if (op?.op === 'exit') await run(op);
		},
		/** Enter a mode on the engine's own initiative (the flow's Enter mode node). */
		enter: (op: Omit<Extract<ModeOp, { op: 'enter' }>, 'op' | 'legacyGameType'>) =>
			whenSettled(() => run({ ...op, op: 'enter', legacyGameType: false })),
		/** Exit a mode on the engine's own initiative (the flow's Exit mode node). */
		exit: (id?: string, total?: number) =>
			whenSettled(() => apply(exitMode(state.current, id, { total }), undefined)),
		/** A round starts at the base game. Silent: the game type is the round's own business. */
		reset: (): void => {
			state.current = emptyModeStack();
			deferred.length = 0;
		},
		/**
		 * Rebuild the stack from the mode events a resume snapshot kept, with NO transitions — a reload
		 * re-enters every mode in order without replaying an intro. The game type follows the restored
		 * top unless a free-spin alias put it there, whose replayed trigger writes it as before.
		 */
		restore: (bookEvents: readonly { type: string }[]): void => {
			const ops = bookEvents.map(modeOpOf).filter((op): op is ModeOp => op !== undefined);
			state.current = restoreModes(ops);
			const top = activeModeId(state.current);
			const lastEnter = [...ops].reverse().find((op) => op.op === 'enter' && op.id === top);
			if (lastEnter && !lastEnter.legacyGameType) deps.setGameType(deps.gameTypeOf(top));
		},
	};
}

export type ModeController = ReturnType<typeof createModeController>;
