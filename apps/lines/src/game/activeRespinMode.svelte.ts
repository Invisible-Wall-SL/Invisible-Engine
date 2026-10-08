import { respinModeRules, type HoldAndWin, type RespinModeRules } from 'game-config';

import { getActiveGameConfig } from './gameConfig';
import { respinModeOnStack } from './respinModes';
import { stateModes } from './stateModes.svelte';

/**
 * THE ACTIVE RESPIN MODE (`docs/design/bonus-games.md` §2.3) — whose rules the respin board, the
 * counter, the letters, the jackpots, the wheel and the expansion read. A project can declare several
 * respin modes; one plays at a time, and it is the respin mode nearest the top of the mode stack.
 * With none on the stack (the base game, a pot filling, a base-game jackpot) it is the PRIMARY, the
 * mode the legacy `holdAndWin` block mirrors — so a game with one respin mode reads exactly the block
 * it always read.
 *
 * Read the rules through here, never through `config.holdAndWin`.
 */

const rulesFor = new WeakMap<object, RespinModeRules[]>();

/** Every respin mode the config declares, the primary first; `[]` without Hold and Win. */
export const respinModes = (): RespinModeRules[] => {
	const config = getActiveGameConfig();
	let modes = rulesFor.get(config);
	if (!modes) {
		modes = respinModeRules(config);
		rulesFor.set(config, modes);
	}
	return modes;
};

/** The respin mode `id`, if the config declares one. */
export const respinModeById = (id: string | undefined): RespinModeRules | undefined =>
	id === undefined ? undefined : respinModes().find((mode) => mode.mode === id);

/** The respin mode playing now — the topmost on the stack, else the primary (reactive). */
export const activeRespinMode = (): RespinModeRules | undefined =>
	respinModeOnStack(
		respinModes(),
		stateModes.state.stack.map((entry) => entry.id),
	);

/** Is the respin mode playing now the primary — the one whose coins land on the base reels? */
export const isPrimaryRespinMode = (): boolean => {
	const mode = activeRespinMode();
	return mode !== undefined && mode === respinModes()[0];
};

/** The active respin mode's rules, in the legacy block's shape. */
export const activeRespinRules = (): HoldAndWin | undefined => activeRespinMode()?.block;

/** Every respin mode's rules — what a value source registered once at boot must cover. */
export const everyRespinRules = (): HoldAndWin[] => respinModes().map((mode) => mode.block);
