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
	type SymbolLayerSpec,
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
	SYMBOL_RIG_FILL,
	REEL_PADDING,
	SYMBOL_DIM_TINT,
	INITIAL_SYMBOL_STATE,
	SPIN_OPTIONS_DEFAULT,
	SPIN_OPTIONS_FAST,
} from './src/game/constants';
export { createGameConfig, type GameConfigDeps } from './src/game/gameConfig';
export {
	isUsableCell,
	resolveSymbolState,
	type CellLike,
	type StateMapLike,
} from './src/game/symbolCell';
export { createSymbolMap, type SymbolMapDeps, type SymbolMapApi } from './src/game/symbolMap';
export { createSymbolInfo, type SymbolInfoDeps, type SymbolInfoApi } from './src/game/symbolInfo';
export { hexToTintNumber } from './src/game/tint';
export { createGameContext, getGameContext, type GameContext } from './src/game/context';
export type { BookEventRegistry, ImplementsEngineBookEvents } from './src/game/bookEvents';
export { createPlayBook, type PlayBookDeps } from './src/game/playBook';
export {
	BASE_MODE_ID,
	activeModeId,
	emptyModeStack,
	enterMode,
	exitMode,
	isModeActive,
	restoreModes,
	type ModeEntry,
	type ModePolicy,
	type ModeStackState,
	type ModeStep,
	type ModeTransition,
} from './src/game/modeStack';
export {
	BASE_GAME_TYPE,
	createModeGameTypeResolver,
	MODE_EVENT_TYPES,
	modeEntryMeters,
	modeOpOf,
	type ModeOp,
} from './src/game/modeEvents';
export {
	applyOverlayEvent,
	boardDropCells,
	drainedMeters,
	drainMeters,
	emptyOverlayState,
	freeSpinsGaveWay,
	type ModeEntryCause,
	type OverlayDropCell,
	type OverlayState,
	type PotsOverlayEventFields,
} from './src/game/potsOverlay';
export {
	createModeController,
	type ModeController,
	type ModeControllerDeps,
} from './src/game/modeController.svelte';
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
	applyHoldAndWinEvent,
	emptyHoldAndWinState,
	HOLD_AND_WIN_SNAPSHOT_EVENTS,
	type HoldAndWinCause,
	type HoldAndWinCell,
	type HoldAndWinCellAmount,
	type HoldAndWinCoinChange,
	type HoldAndWinEntry,
	type HoldAndWinEvent,
	type HoldAndWinEventFields,
	type HoldAndWinEventType,
	type HoldAndWinJackpotLevel,
	type HoldAndWinJackpotSource,
	type HoldAndWinMeterLevel,
	type HoldAndWinSnapshot,
	type HoldAndWinState,
	type HoldAndWinTally,
	type HoldAndWinUpgradeChange,
	type HoldAndWinWheelPrize,
	isHoldAndWinEvent,
} from './src/game/holdAndWin';
export {
	releasedCells,
	respinCellKey,
	respinSeedBoard,
	respinSpins,
	type RespinSpin,
} from './src/game/respinBoard';
export {
	createRespinBoard,
	type RespinBoard,
	type RespinBoardCell,
	type RespinBoardDeps,
} from './src/game/respinBoard.svelte';
export {
	cellWorth,
	countSteps,
	staggerDelays,
	tallyCountUp,
	type CountStep,
	type TallyCountUp,
} from './src/game/respinCount';
export {
	wheelEase,
	wheelLandingRotation,
	wheelPrizeLabel,
	wheelSegmentAngle,
	wheelSegmentAt,
	wheelSegmentCentre,
} from './src/game/holdAndWinWheel';
export { type EmitterEventFlight } from './src/game/flight';
export {
	curveLength,
	FLIGHT_BEND_STRENGTHS,
	flightDuration,
	flightEase,
	flightStagger,
	planFlight,
	pointOnCurve,
	type FlightCandidateKind,
	type FlightCurve,
	type FlightDurationOptions,
	type FlightPoint,
	type FlightRect,
	type FlightRoute,
	type PlanFlightOptions,
} from 'engine-layout';
export {
	FLIGHT_HEAD_TINT,
	FLIGHT_TRAIL_CONFIG,
	FLIGHT_TRAIL_LIFETIME_S,
	flightGlowTexture,
} from './src/game/flightGlow';
export { coinLabelText, moneyDecimalSeparator, type CoinLabelFormat } from './src/game/coinLabel';

export {
	tierHasExit,
	resolveWinTap,
	type TierAnimationMap,
	type WinTapAction,
} from './src/game/winEscalation';
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
export { default as FlightView } from './src/components/FlightView.svelte';
