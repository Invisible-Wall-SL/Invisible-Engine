import { SYMBOL_STATES } from 'engine-layout';
import { type SpinningReelSymbolState } from 'utils-slots';

export { SYMBOL_STATES };

/**
 * A symbol id. WIDE (`string`) on purpose, and this is a deliberate loss of a guarantee.
 *
 * It used to be `keyof typeof config.symbols` — a compile-time union derived from the compiled
 * template — so naming a symbol the game could not draw was a build error. Since Phase 3 of
 * `docs/design/invisible-game-config.md` the config is authored per project and known only at
 * RUNTIME, so that union became a lie: it would describe the sample game while the project runs
 * its own, and would have REJECTED a correct symbol id from an authored config. The check moves to
 * `warnOnGameConfigIssues()`, which compares the active config's in-play set against the symbol map
 * at boot and reports a symbol with no art as an error.
 */
export type SymbolName = string;

export type RawSymbol = {
	name: SymbolName;
	multiplier?: number;
	scatter?: boolean;
	wild?: boolean;
};

export type SymbolState = SpinningReelSymbolState | (typeof SYMBOL_STATES)[number];

/** A single symbol×state binding: the sprite frame or spine animation that renders it.
 * Structural twin of a `SYMBOL_INFO_MAP` cell — authored by the Invisible Symbols State
 * Machine (docs/design/invisible-symbols-state-machine.md). */
export type SymbolCellInfo = {
	type: 'sprite' | 'spine' | 'flipbook';
	assetKey: string;
	animationName?: string;
	/** `flipbook` cells only: the authored Invisible Flipbook clip this state plays. The clip
	 * names its own sheet(s), so `assetKey` merely holds its primary one. */
	clipId?: string;
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
