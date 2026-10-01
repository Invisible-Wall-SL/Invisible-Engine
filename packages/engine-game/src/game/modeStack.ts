/**
 * THE MODE STACK — which game mode is playing, which are suspended under it, and which are waiting
 * (`docs/design/hold-and-win.md` §4.5). Pure data in, data out: no runes, no emitter, no config, so
 * the rules are pinned by a node fixture (`modeStack.fixture.ts`) and the reactive holder
 * (`modeController.svelte.ts`) only applies what this returns.
 *
 * - The base game is implicit: an empty stack IS the base game. It is never pushed.
 * - `enter` with policy `nest` plays now: push, and the mode underneath resumes when it exits.
 * - `enter` with policy `queue` plays after: append to the pending queue, and it starts when the
 *   stack is back at base. At base there is nothing to wait for, so a queued entry starts at once.
 * - Entering a mode that is already on the stack or in the queue MERGES into that entry (two causes
 *   of one feature on one spin are one feature) — its payload gains the new fields.
 * - `exit` pops the named mode (the top one when unnamed). Back at base with a queue, the next queued
 *   mode starts; with neither stack nor queue, every mode has finished.
 *
 * The server's book stays the source of truth: this never invents a mode, it only orders what the
 * book announced. A transition list says what changed, in the order a presentation should play it.
 */

export type ModePolicy = 'nest' | 'queue';

export type ModeEntry = {
	id: string;
	/** Why it was entered — `count`, `meter:pot1`, `buy`, … as the book named it. */
	cause?: string;
	/** What the book carried with it (counter totals, held coins, active modifiers…). */
	payload: Record<string, unknown>;
};

export type ModeStackState = {
	/** Active modes, bottom first. The last entry is the mode on screen. Never holds the base game. */
	stack: ModeEntry[];
	/** Modes announced to play once the stack is back at base, in order. */
	queue: ModeEntry[];
};

export type ModeTransition =
	| { kind: 'enter'; mode: ModeEntry; from: string }
	| { kind: 'merge'; mode: ModeEntry }
	| { kind: 'queued'; mode: ModeEntry }
	| { kind: 'exit'; mode: ModeEntry; to: string; total?: number }
	| { kind: 'resume'; mode: ModeEntry }
	| { kind: 'allFinished' };

export type ModeStep = { state: ModeStackState; transitions: ModeTransition[] };

/** The base game's id — what an empty stack is. Mirrors `game-config`'s `BASE_GAME_MODE`. */
export const BASE_MODE_ID = 'basegame';

export const emptyModeStack = (): ModeStackState => ({ stack: [], queue: [] });

/** The mode on screen: the top of the stack, else the base game. */
export const activeModeId = (state: ModeStackState): string =>
	state.stack.at(-1)?.id ?? BASE_MODE_ID;

/** Whether `id` is playing or suspended on the stack (the base game always is). */
export const isModeActive = (state: ModeStackState, id: string): boolean =>
	id === BASE_MODE_ID || state.stack.some((entry) => entry.id === id);

const merged = (entry: ModeEntry, cause: string | undefined, payload: Record<string, unknown>) => ({
	...entry,
	cause: entry.cause ?? cause,
	payload: { ...entry.payload, ...payload },
});

/** Enter mode `id`, now (`nest`) or after the current modes finish (`queue`). */
export function enterMode(
	state: ModeStackState,
	id: string,
	options: { policy?: ModePolicy; cause?: string; payload?: Record<string, unknown> } = {},
): ModeStep {
	const payload = options.payload ?? {};
	if (id === BASE_MODE_ID) return { state, transitions: [] };

	const onStack = state.stack.findIndex((entry) => entry.id === id);
	if (onStack >= 0) {
		const stack = state.stack.slice();
		stack[onStack] = merged(stack[onStack], options.cause, payload);
		return { state: { ...state, stack }, transitions: [{ kind: 'merge', mode: stack[onStack] }] };
	}
	const queued = state.queue.findIndex((entry) => entry.id === id);
	if (queued >= 0) {
		const queue = state.queue.slice();
		queue[queued] = merged(queue[queued], options.cause, payload);
		return { state: { ...state, queue }, transitions: [{ kind: 'merge', mode: queue[queued] }] };
	}

	const entry: ModeEntry = { id, payload, ...(options.cause ? { cause: options.cause } : {}) };
	if (options.policy === 'queue' && state.stack.length > 0) {
		return {
			state: { ...state, queue: [...state.queue, entry] },
			transitions: [{ kind: 'queued', mode: entry }],
		};
	}
	return {
		state: { ...state, stack: [...state.stack, entry] },
		transitions: [{ kind: 'enter', mode: entry, from: activeModeId(state) }],
	};
}

/**
 * Exit mode `id` (the mode on screen when absent). A mode that is only queued is dropped from the
 * queue without ever having played; a mode that is nowhere is a no-op, so an exit replayed past
 * its own entry — a resume that starts mid-feature — cannot underflow the stack.
 */
export function exitMode(
	state: ModeStackState,
	id?: string,
	options: { total?: number } = {},
): ModeStep {
	const target = id ?? state.stack.at(-1)?.id;
	if (!target || target === BASE_MODE_ID) return { state, transitions: [] };

	const at = state.stack.findIndex((entry) => entry.id === target);
	if (at < 0) {
		const queue = state.queue.filter((entry) => entry.id !== target);
		return { state: { ...state, queue }, transitions: [] };
	}

	const wasOnTop = at === state.stack.length - 1;
	const exited = state.stack[at];
	const stack = state.stack.filter((_, index) => index !== at);
	let next: ModeStackState = { ...state, stack };
	const transitions: ModeTransition[] = [
		{
			kind: 'exit',
			mode: exited,
			to: activeModeId(next),
			...(options.total !== undefined ? { total: options.total } : {}),
		},
	];
	if (!wasOnTop) return { state: next, transitions };

	if (stack.length > 0) {
		transitions.push({ kind: 'resume', mode: stack[stack.length - 1] });
		return { state: next, transitions };
	}
	const [first, ...rest] = next.queue;
	if (first) {
		next = { stack: [first], queue: rest };
		transitions.push({ kind: 'enter', mode: first, from: BASE_MODE_ID });
		return { state: next, transitions };
	}
	transitions.push({ kind: 'allFinished' });
	return { state: next, transitions };
}

/**
 * Rebuild a stack from what a resume snapshot carried, WITHOUT transitions: a reload re-enters every
 * mode on the stack in order, but replays no intro. Entries are applied as the book listed them.
 */
export function restoreModes(
	entries: readonly (
		| { op: 'enter'; id: string; policy?: ModePolicy; cause?: string; payload?: Record<string, unknown> }
		| { op: 'exit'; id: string }
	)[],
): ModeStackState {
	let state = emptyModeStack();
	for (const entry of entries) {
		state =
			entry.op === 'enter'
				? enterMode(state, entry.id, entry).state
				: exitMode(state, entry.id).state;
	}
	return state;
}
