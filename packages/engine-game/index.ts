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

export {
	SYMBOL_SIZE,
	SYMBOL_SPINE_FILL,
	REEL_PADDING,
	SYMBOL_DIM_TINT,
	INITIAL_SYMBOL_STATE,
	SPIN_OPTIONS_DEFAULT,
	SPIN_OPTIONS_FAST,
} from './src/game/constants';
export { createGameConfig, type GameConfigDeps } from './src/game/gameConfig';
export { createGameContext, getGameContext, type GameContext } from './src/game/context';
export {
	createGameState,
	type GameStateDeps,
	type GameStateApi,
	type Reel,
	type ReelSymbol,
	type MultiplierSymbol,
	type StackedArt,
	type StackedPictureRun,
} from './src/game/gameState.svelte';
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

export { default as Background, type BackgroundCover } from './src/components/Background.svelte';
export { default as BoardContainer } from './src/components/BoardContainer.svelte';
export { default as ContinuePressMask } from './src/components/ContinuePressMask.svelte';
export { default as CountUpInteraction } from './src/components/CountUpInteraction.svelte';
export { default as FreeSpinIntroGate } from './src/components/FreeSpinIntroGate.svelte';
export { default as PressToContinue } from './src/components/PressToContinue.svelte';
export { default as ResumeBet } from './src/components/ResumeBet.svelte';
export {
	default as Transition,
	type EmitterEventTransition,
} from './src/components/Transition.svelte';
export { default as TransitionAnimation } from './src/components/TransitionAnimation.svelte';
export {
	default as WinAnimation,
	type WinAnimationStep,
} from './src/components/WinAnimation.svelte';
export { default as WinCoins } from './src/components/WinCoins.svelte';
