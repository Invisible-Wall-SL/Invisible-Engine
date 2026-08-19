/**
 * `engine-game` — the game-type-AGNOSTIC engine layer.
 *
 * Phase A of `docs/design/game-type-templates.md` lifts the ~80% of `apps/lines/src` that is not
 * lines-specific into this package, so a game type becomes `{ data, mechanic }` rather than a
 * whole app folder. `apps/lines` keeps only the compiled config, i18n, routes, stories, and the
 * `lines` mechanic itself.
 *
 * Deliberately SOURCE-entry (`main`/`types` → this file, no build step), like `components-pixi`
 * and unlike `engine-layout`: a pre-built `dist/` is what lets a game bundle silently ship stale
 * engine code, which has already cost this project a debugging session.
 */
export {
	SYMBOL_STATES,
	type SymbolName,
	type RawSymbol,
	type SymbolState,
	type SymbolCellInfo,
	type SymbolInfoMap,
	type Position,
} from './src/game/types';

export {
	winLevelMap,
	type WinLevelMap,
	type WinLevel,
	type WinLevelType,
	type WinLevelAnimation,
	type WinLevelData,
	type WinLevelAlias,
} from './src/game/winLevelMap';

export { resolveWinMount, type WinMount } from './src/game/winOwnership';
export {
	freeSpinsRemaining,
	freeSpinsTotal,
	freeSpinsCurrent,
} from './src/game/freeSpinCounterValues';
export { eventSignal } from './src/game/signalSource';
export { boolSource } from './src/game/boolSource.svelte';
export { textSource } from './src/game/textSource.svelte';
export { valueSource } from './src/game/valueSource.svelte';
