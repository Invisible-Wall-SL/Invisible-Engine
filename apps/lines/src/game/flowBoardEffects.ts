import type { FlowEffect } from 'engine-flow';
import { MATCH3_BOARD_ACTIONS } from 'engine-flow-v2';

/**
 * The board actions a family mechanic backs (`MATCH3_VOCAB`'s `boardSwap`, `boardShuffle`, …),
 * registered by the mechanic's runtime when its session starts (`match3.svelte.ts`). A registry rather than an
 * import so the Flow runtime, which every slot game builds, never loads a family's module.
 */
let registered: Readonly<Record<string, FlowEffect>> = {};

export const registerBoardEffects = (effects: Readonly<Record<string, FlowEffect>>) => {
	registered = effects;
};

export const boardEffect = (name: string): FlowEffect | undefined => registered[name];

/** Every board action a vocabulary may declare, backed or not yet (the vocabulary coverage check). */
export const boardEffectNames: readonly string[] = MATCH3_BOARD_ACTIONS;
