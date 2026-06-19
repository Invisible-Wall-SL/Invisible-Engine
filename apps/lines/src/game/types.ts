import { type SpinningReelSymbolState } from 'utils-slots';
import type config from './config';

export type SymbolName = keyof typeof config.symbols;
export type RawSymbol = {
	name: SymbolName;
	multiplier?: number;
	scatter?: boolean;
	wild?: boolean;
};
export type BetMode = keyof typeof config.betModes;
export type GameType = keyof typeof config.paddingReels;

export const SYMBOL_STATES = [
	'static',
	'spin',
	'land',
	'win',
	'postWinStatic',
	'explosion',
	'bookIntro',
	'bookIdle',
] as const;

export type SymbolState = SpinningReelSymbolState | (typeof SYMBOL_STATES)[number];

/** A single symbol×state binding: the sprite frame or spine animation that renders it.
 * Structural twin of a `SYMBOL_INFO_MAP` cell — authored by the Invisible Symbols State
 * Machine (docs/design/invisible-symbols-state-machine.md). */
export type SymbolCellInfo = {
	type: 'sprite' | 'spine';
	assetKey: string;
	animationName?: string;
	/** Per-cell size. Optional on a baked OVERRIDE cell (absent = inherit the global
	 *  `defaultSizeRatios`); the coded `SYMBOL_INFO_MAP` always supplies it. Render code
	 *  reads the resolved size via `getSymbolInfo` (see `resolveSymbolSizeRatios`). */
	sizeRatios?: { width: number; height: number };
};

/** Symbol name → state → binding. The coded `SYMBOL_INFO_MAP` IS one of these (the
 * default); a baked symbols doc supplies sparse overrides merged over it cell-by-cell. */
export type SymbolInfoMap = Record<string, Record<string, SymbolCellInfo>>;

export type Position = {
	reel: number;
	row: number;
};
