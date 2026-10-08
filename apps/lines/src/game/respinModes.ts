import type { Scene } from 'engine-layout';
import type { HoldAndWinJackpot, RespinModeRules, RespinPlay } from 'game-config';

/**
 * WHICH RESPIN MODE PLAYS, AND ON WHAT (`docs/design/bonus-games.md` §2.3) — the decisions the
 * runtime makes from the mode stack and the declared respin modes, kept free of runes so the gate
 * (`scripts/check-respin-modes-runtime.mts`) drives them with real rounds. The reactive wrappers are
 * `activeRespinMode.svelte.ts`, `stateRespinBoard.svelte.ts` and `respinScreens.svelte.ts`.
 */

/**
 * The respin mode playing on `stack` (bottom first): the respin mode nearest the top, else the
 * primary (`modes[0]`) — one respin mode plays at a time, and with none on the stack the base game's
 * coins, pots and jackpots are the primary's.
 */
export const respinModeOnStack = <T extends { mode: string }>(
	modes: readonly T[],
	stack: readonly string[],
): T | undefined => {
	for (let i = stack.length - 1; i >= 0; i--) {
		const mode = modes.find((m) => m.mode === stack[i]);
		if (mode) return mode;
	}
	return modes[0];
};

/** The board a respin mode plays on: the strip it rolls and its rows. */
export type RespinBoardShape = { mode?: string; gameType: string; rows: number };

/**
 * `mode`'s board on a grid of `gridRows`: an expanding board builds every row up to its `maxRows`,
 * any other keeps the grid's. No mode ⇒ the default `respin` strip on the grid.
 */
export const respinBoardShape = (
	mode: RespinModeRules | undefined,
	gridRows: number,
): RespinBoardShape => {
	const expansion = mode?.block.expansion;
	return {
		mode: mode?.mode,
		gameType: mode?.gameType ?? 'respin',
		rows: expansion ? Math.max(gridRows, expansion.maxRows) : gridRows,
	};
};

/** Is a board built for `built` the board `wanted` plays on? A different mode is rebuilt even at
 *  the same size: its strip, blank and rules are its own. */
export const sameRespinBoard = (
	built: Pick<RespinBoardShape, 'mode' | 'rows'> & { reels: number },
	wanted: Pick<RespinBoardShape, 'mode' | 'rows'> & { reels: number },
): boolean =>
	built.mode === wanted.mode && built.reels === wanted.reels && built.rows === wanted.rows;

/**
 * A jackpot tier as the game shows it: the active respin mode's, else the first respin mode's that
 * has it (the primary first), so a tile of another mode's tier shows what that mode pays.
 */
export const jackpotTier = (
	modes: readonly RespinModeRules[],
	active: RespinModeRules | undefined,
	tier: string,
): HoldAndWinJackpot | undefined => {
	const named = ({ name }: { name: string }) => name.toLowerCase() === tier.toLowerCase();
	return (
		active?.block.jackpots.find(named) ?? modes.flatMap((mode) => mode.block.jackpots).find(named)
	);
};

/** A scene's id without its mode's `-<modeId>` suffix — the reference screen it is a copy of. */
export const modeSceneBaseId = (scene: Pick<Scene, 'id' | 'modeId'>): string => {
	const suffix = scene.modeId ? `-${scene.modeId}` : '';
	return suffix && scene.id.endsWith(suffix) ? scene.id.slice(0, -suffix.length) : scene.id;
};

/**
 * The screen that draws `screen`'s beat in respin mode `mode`: that mode's own copy (`role: 'mode'`,
 * its `modeId`, the same base id — the `holdAndWin` mode's keeps the reference id, any other is
 * suffixed with its id, bonus-games Phase 5b), else `screen` itself.
 */
export const modeScreenFor = (
	scenes: readonly Pick<Scene, 'id' | 'role' | 'modeId'>[],
	mode: string | undefined,
	screen: string,
): string =>
	(mode &&
		scenes.find(
			(scene) =>
				scene.role === 'mode' && scene.modeId === mode && modeSceneBaseId(scene) === screen,
		)?.id) ||
	screen;

/**
 * Does the book park on SPIN before this event? Before each respin of a `manual` respin mode — the
 * first after the intro and the first after a resume included — unless play is hands-off (autoplay,
 * hold-to-spin), where a park would wait for a press that is never coming. `auto` (and absent) never
 * parks, which is how every Hold and Win game has always played.
 */
export const parksBeforeRespin = (
	eventType: string,
	play: RespinPlay | undefined,
	handsOff: boolean,
): boolean => eventType === 'respinReveal' && play === 'manual' && !handsOff;
