import type { FlowEffect } from 'engine-flow';
import { ARCADE_LOOP_ACTIONS, MATCH3_BOARD_ACTIONS } from 'engine-flow-v2';

/**
 * The actions a family mechanic backs (`MATCH3_VOCAB`'s `boardSwap`, `boardShuffle`, …;
 * `ARCADE_VOCAB`'s `setVelocity`, `moveTo`, `setTag`), and the `$engine` values it answers
 * (`ARCADE_VOCAB`'s `random`), registered by the mechanic's runtime when its session starts
 * (`match3.svelte.ts`, `arcade.ts`). A registry rather than an import so the Flow runtime, which
 * every slot game builds, never loads a family's module.
 */
let registered: Readonly<Record<string, FlowEffect>> = {};

export const registerBoardEffects = (effects: Readonly<Record<string, FlowEffect>>) => {
	registered = effects;
};

export const boardEffect = (name: string): FlowEffect | undefined => registered[name];

/** Every family action a vocabulary may declare, backed or not yet (the vocabulary coverage check). */
export const boardEffectNames: readonly string[] = [
	...MATCH3_BOARD_ACTIONS,
	...ARCADE_LOOP_ACTIONS,
];

let values: ((key: string) => unknown) | undefined;

export const registerBoardValues = (read: ((key: string) => unknown) | undefined) => {
	values = read;
};

/** A family's `$engine` value, or `undefined` when none is registered or it answers none. */
export const boardValue = (key: string): unknown => values?.(key);
