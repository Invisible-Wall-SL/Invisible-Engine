import {
	INFINITY_MARK,
	AUTO_SPINS_TEXT_OPTIONS,
	AUTO_SPINS_TEXT_OPTION_MAP,
	LOSS_LIMIT_TEXT_OPTIONS,
	AUTO_SPINS_LOSS_LIMIT_MULTIPLIER_MAP,
	SINGLE_WIN_LIMIT_TEXT_OPTIONS,
	AUTO_SPINS_SINGLE_WIN_LIMIT_MULTIPLIER_MAP,
	type AutoSpinsText,
	type LossLimitText,
	type SingleWinLimitText,
} from 'constants-shared/autoSpins';
import { stateBet, stateBetDerived } from './stateBet.svelte';

/**
 * The autoplay option ladders now live in `constants-shared/autoSpins` (constants, not state — the
 * launcher editor needs them on the server, where a `.svelte.ts` module can't be imported). They are
 * re-exported here so every existing `state-shared` importer is unchanged.
 */
export {
	INFINITY_MARK,
	AUTO_SPINS_TEXT_OPTIONS,
	AUTO_SPINS_TEXT_OPTION_MAP,
	LOSS_LIMIT_TEXT_OPTIONS,
	AUTO_SPINS_LOSS_LIMIT_MULTIPLIER_MAP,
	SINGLE_WIN_LIMIT_TEXT_OPTIONS,
	AUTO_SPINS_SINGLE_WIN_LIMIT_MULTIPLIER_MAP,
	type AutoSpinsText,
	type LossLimitText,
	type SingleWinLimitText,
} from 'constants-shared/autoSpins';

export type UIConfigMode = 'default' | 'replay';

/**
 * Player-led SPEED features, each independently toggleable per game/jurisdiction
 * (the "defang via config, never gut" rule — the machinery stays, config hides the
 * entry points). `turbo` = the turbo toggle button; `autoplay` = the autospin button
 * + its modal; `spaceHold` = hold-Space continuous betting.
 *
 * SLAM STOP is deliberately NOT a flag: it is always on (owner direction), so a press
 * mid-round snaps the reels and fast-forwards the win presentation. That makes
 * `UI_FEATURES_UK` below an INCOMPLETE UK profile — a UK build also has to suppress the
 * slam, which needs a flag adding here and a gate in `utils-shared/spinStop`.
 */
export type UIFeatureFlags = {
	turbo: boolean;
	autoplay: boolean;
	spaceHold: boolean;
};

/** Default profile — every speed feature available (non-UK markets). */
export const UI_FEATURES_DEFAULT: UIFeatureFlags = {
	turbo: true,
	autoplay: true,
	spaceHold: true,
};

/**
 * UK Gambling Commission profile: licensed UK slots PROHIBIT autoplay, turbo/quick
 * spin and player-led spin-stop, so all speed features are off. Apply with
 * `setUiFeatures(UI_FEATURES_UK)` for a UK build. INCOMPLETE — see the slam-stop note
 * on `UIFeatureFlags`.
 */
export const UI_FEATURES_UK: UIFeatureFlags = {
	turbo: false,
	autoplay: false,
	spaceHold: false,
};

export const stateUi = $state({
	autoSpinsText: '10' as AutoSpinsText,
	autoSpinsLossLimitText: INFINITY_MARK as LossLimitText,
	autoSpinsSingleWinLimitText: INFINITY_MARK as SingleWinLimitText,
	freeSpinCounterShow: false,
	freeSpinCounterCurrent: 0,
	freeSpinCounterTotal: 0,
	// Extra free spins won on the most recent mid-feature retrigger (the `freeSpinRetrigger` book
	// event's `extraFs`). Feeds the `freeSpinsAdded` number + `freeSpinsAddedText` sentence value
	// sources a retrigger celebration screen binds. Set universally at dispatch (game `utils.ts`).
	freeSpinsAdded: 0,
	// Round-lifecycle gates for screen/component visibility (a `Scene.visibleSource` or a
	// component `visibleSource` param binds to these): true only while that presentation
	// phase is on screen. Driven by the game's book-event handlers, alongside the existing
	// freeSpinIntro/Outro/win show↔hide event broadcasts. (free-game / base-game are derived
	// from `stateGame.gameType` in the game, so they aren't duplicated here.)
	freeSpinIntroShow: false,
	freeSpinOutroShow: false,
	winShow: false,
	bigWinShow: false,
	// Spin-button CELEBRATION LOCK latch — kept SEPARATE from the `*Show` flags above.
	// Those flags are set by the coded book-event handlers and the flow-v1 effects, but a
	// flow-v2 authored game drives its celebrations with `fireCue` nodes and OMITS the
	// flag-setting `effect` nodes, so `freeSpinIntroShow`/`bigWinShow` never go true there
	// (verified live on the remake — the intro screen was up for its full duration with those
	// flags false). This latch is instead driven off the flow's ACTIVE SCREENS (`activeScreenIds`
	// ⊇ `freeSpinIntro`/`freeSpinOutro`/`bigWin`) by `apps/lines` Game.svelte's `$effect`; read
	// via `hasCelebrationOverlay()`.
	celebrationLock: { intro: false, outro: false, win: false },
	// Spin-button lock for a NON-SCREEN unskippable window — the free-spin intro's scatter-match
	// animation and the book/expanding-symbol reveal. Kept SEPARATE from `celebrationLock` (which
	// tracks celebration SCREENS): these phases run BEFORE any celebration screen mounts, so the
	// screen-driven latch is still false while they play, leaving the button a live STOP. A slam in
	// that window trips the sticky round token and then collapses the intro's player-gated tap-hold.
	// Mirrored off the unskippable-presentation depth by the game's `runBookEventPresentation`; read
	// via `hasUnskippablePresentation()`.
	unskippablePresentationActive: false,
	menuOpen: false,
	drawerFold: false,
	drawerButtonShow: false,
	/**
	 * How many press-to-continue overlays are mounted. Non-zero ⇒ that overlay OWNS the press: it
	 * covers the canvas with a full-screen hit rect AND binds Space itself, so the spin button's
	 * Space hotkey must stand down or one keypress would run both the slam and the
	 * press-to-continue (plus the bet sound over the outro music). Maintained by each game's
	 * `PressToContinue`; read via `hasContinuePress()`.
	 */
	continuePressCount: 0,
	/**
	 * SPIN HOLD — the round is paused mid-book waiting for the player to press SPIN. Raised by the
	 * game (`apps/lines` `freeSpinHold.ts`) after a big win inside a free-spin feature, so the
	 * feature rests on its winning board instead of rolling the next spin on its own.
	 *
	 * It is the INVERSE of every other latch here: `celebrationLock` / `unskippablePresentationActive`
	 * make the button INERT, this makes it LIVE mid-round and re-labels it SPIN — the press neither
	 * bets (the bonus book is already paid for) nor slams, it just releases the hold. Read via
	 * {@link hasSpinHold} by `utils-shared/spinStop`, which is the ONE place the press decision lives.
	 */
	spinHoldActive: false,
	config: {
		mode: 'default' as UIConfigMode,
		features: { ...UI_FEATURES_DEFAULT } as UIFeatureFlags,
	},
});

/** Whether a press-to-continue overlay currently owns the press (see
 *  `stateUi.continuePressCount`). */
export const hasContinuePress = () => stateUi.continuePressCount > 0;

/**
 * The live press-to-continue handlers, oldest first. Held OUTSIDE `$state` because they are
 * callbacks, not reactive data (the reactive half is `continuePressCount` above) - same
 * discipline as `spinHoldResolve` below.
 *
 * Why a registry at all: an overlay's own full-screen hit rect sits at the overlay's z, so any
 * chrome painted ABOVE it (the HUD - spin, turbo, bet steppers) hit-tests FIRST and swallows the
 * click. The press then does nothing at all: the button is inert under the celebration lock, and
 * the tap never reaches the overlay. Hovering the spin button therefore made the celebration
 * unskippable until the player moved the pointer off it. The fix is a single canvas-top INPUT MASK
 * ({@link runTopContinuePress}) the game mounts above every band, so the overlay masks the chrome
 * instead of the chrome masking the overlay. The mask needs to know WHICH overlay's press to run -
 * that is this registry.
 */
const continuePressHandlers: { id: number; onpress: () => void }[] = [];
let continuePressNextId = 1;

/**
 * Register `onpress` as a live press-to-continue handler and return its unregister. Called by the
 * `PressToContinue` overlay alongside the `continuePressCount` bump.
 */
export const registerContinuePress = (onpress: () => void): (() => void) => {
	const id = continuePressNextId++;
	continuePressHandlers.push({ id, onpress });
	return () => {
		const index = continuePressHandlers.findIndex((entry) => entry.id === id);
		if (index >= 0) continuePressHandlers.splice(index, 1);
	};
};

/**
 * Run the NEWEST live press-to-continue handler - the canvas-top input mask's press body.
 *
 * Newest, not oldest: two gates overlap across a fade-out/fade-in, and the one that just mounted is
 * the one in front of the player. That mirrors what the per-overlay hit rects did on their own (the
 * later mount painted on top and won the hit test). No handler => no-op.
 */
export const runTopContinuePress = (): void => {
	continuePressHandlers[continuePressHandlers.length - 1]?.onpress();
};

/**
 * Whether a non-skippable celebration presentation currently owns the screen: the
 * free-spin intro, the free-spin outro, or the win panel. While true the spin button
 * locks (goes inert) so a press can't slam-fast-forward the celebration — read by
 * `utils-shared/spinStop`. Backed by the `celebrationLock` latch (maintained off the
 * emitter cues, so it is correct on coded / flow-v1 / flow-v2 alike), NOT the `*Show`
 * flags a flow-v2 game never sets.
 */
export const hasCelebrationOverlay = () =>
	stateUi.celebrationLock.intro || stateUi.celebrationLock.outro || stateUi.celebrationLock.win;

/**
 * Whether a non-skippable presentation with NO celebration screen is running — the free-spin intro's
 * scatter-match animation or the book/expanding-symbol reveal. The spin button locks (goes inert)
 * for this window too, so a slam in the gap before the intro screen mounts can't trip the round token
 * and collapse the intro's player-gated tap-hold. Mirrored off the unskippable-presentation depth
 * (`apps/lines` `runBookEventPresentation`); read by `utils-shared/spinStop`.
 */
export const hasUnskippablePresentation = () => stateUi.unskippablePresentationActive;

/** The resolver that ends the current spin hold — held OUTSIDE `$state` because it is a callback,
 *  not reactive data (a function in a `$state` proxy is a trap, and nothing renders off it). */
let spinHoldResolve: (() => void) | undefined;

/**
 * Whether the round is paused waiting for a SPIN press (see `stateUi.spinHoldActive`). While true
 * the spin button is live, reads SPIN, and its press releases the hold rather than betting or
 * slamming — `utils-shared/spinStop` is the only reader.
 */
export const hasSpinHold = () => stateUi.spinHoldActive;

/**
 * Open a spin hold: `release` is called once, by the player's press (or by {@link cancelSpinHold}
 * on a round that ends early). Re-arming over a live hold releases the previous one, so a hold can
 * never be stranded by a second arm.
 */
export const armSpinHold = (release: () => void) => {
	if (spinHoldResolve) releaseSpinHold();
	spinHoldResolve = release;
	stateUi.spinHoldActive = true;
};

/** End the hold and run its resolver, so the paused book resumes. Idempotent — a press that lands
 *  after the hold already closed does nothing. */
export const releaseSpinHold = () => {
	const resolve = spinHoldResolve;
	spinHoldResolve = undefined;
	stateUi.spinHoldActive = false;
	resolve?.();
};

/** Drop a hold at round teardown. Same body as {@link releaseSpinHold} — named apart so the
 *  belt-and-braces cleanup in `playBet` reads as cleanup, not as a simulated press. */
export const cancelSpinHold = releaseSpinHold;

/** Merge a partial feature profile into the live UI config (e.g. a game's setup or
 * the editor-authored game settings supplying a jurisdiction preset). */
export const setUiFeatures = (features: Partial<UIFeatureFlags>) => {
	stateUi.config.features = { ...stateUi.config.features, ...features };
};

/**
 * The AUTOPLAY COMMITTERS — the state half of starting an autoplay run, lifted out of
 * `AutoSpinsStartButton` so the HTML modal, an authored Pixi auto-spin screen and a flow action all
 * arm a run through ONE body instead of three copies that drift. They are deliberately state-only:
 * the press sound and the `autoBet` broadcast stay with each caller, because the event emitter is
 * Svelte-context-bound and this package is context-free.
 *
 * Each `set*` takes the option's TEXT (`'100'`, `'25×'`, `'∞'`) rather than a number, because that is
 * what the option tables store and what a repeater tile's key carries; an unknown string is IGNORED
 * rather than written, so a stale doc or a typo'd flow payload can't put the state into a value the
 * limit maps have no entry for (which would silently make the limit `undefined` ⇒ `NaN`).
 */
export const setAutoSpinsOption = (option: string): void => {
	if ((AUTO_SPINS_TEXT_OPTIONS as readonly string[]).includes(option)) {
		stateUi.autoSpinsText = option as AutoSpinsText;
	}
};

export const setAutoSpinsLossLimitOption = (option: string): void => {
	if ((LOSS_LIMIT_TEXT_OPTIONS as readonly string[]).includes(option)) {
		stateUi.autoSpinsLossLimitText = option as LossLimitText;
	}
};

export const setAutoSpinsSingleWinLimitOption = (option: string): void => {
	if ((SINGLE_WIN_LIMIT_TEXT_OPTIONS as readonly string[]).includes(option)) {
		stateUi.autoSpinsSingleWinLimitText = option as SingleWinLimitText;
	}
};

/**
 * Arm an autoplay run from the picked options — the VERBATIM state body of `AutoSpinsStartButton`:
 * the round counter, both limits resolved to ABSOLUTE amounts off the current `betAmount` (not
 * `betCost()` — matching the coded button), and a one-shot `buy` mode dropped back to BASE so the
 * run doesn't repeat a bought bonus. The caller then broadcasts `autoBet`, which is what actually
 * starts the machine.
 */
export const armAutoSpins = (): void => {
	stateBet.autoSpinsCounter = AUTO_SPINS_TEXT_OPTION_MAP[stateUi.autoSpinsText];
	stateBet.autoSpinsLossLimitAmount = limitAmount(
		AUTO_SPINS_LOSS_LIMIT_MULTIPLIER_MAP[stateUi.autoSpinsLossLimitText],
	);
	stateBet.autoSpinsSingleWinLimitAmount = limitAmount(
		AUTO_SPINS_SINGLE_WIN_LIMIT_MULTIPLIER_MAP[stateUi.autoSpinsSingleWinLimitText],
	);
	if (stateBetDerived.activeBetMode().type === 'buy') stateBet.activeBetModeKey = 'BASE';
};

/**
 * A limit multiplier resolved to an absolute amount off the current stake. `∞` is a real option, so
 * the product is `betAmount * Infinity` — which is `NaN` when the stake is 0, and EVERY comparison
 * against `NaN` is false, so the run would never stop on that limit. A non-finite product means
 * "no limit", which is what `Infinity` already expresses.
 */
const limitAmount = (multiplier: number): number => {
	const amount = stateBet.betAmount * multiplier;
	return Number.isNaN(amount) ? Infinity : amount;
};

/** Stop a running autoplay — zeroing the counter is what the coded auto-spin button does, and the
 *  auto-bet machine reads it between rounds. Inert when no run is live. */
export const stopAutoSpins = (): void => {
	stateBet.autoSpinsCounter = 0;
};
