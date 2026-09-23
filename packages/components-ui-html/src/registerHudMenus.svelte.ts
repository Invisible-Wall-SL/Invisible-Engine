import {
	registerComponents,
	registerComponentActions,
	registerComponentValues,
	registerRepeaterSources,
	OPTION_CARD_DEF,
	OPTION_CARD_LABEL_FILL,
	OPTION_CARD_LABEL_FILL_SELECTED,
	type RepeaterItem,
} from 'engine-layout';
import {
	stateBet,
	stateBetDerived,
	stateConfig,
	closeModal,
	openBetMenu,
	stateUi,
	armAutoSpins,
	setAutoSpinsOption,
	setAutoSpinsLossLimitOption,
	setAutoSpinsSingleWinLimitOption,
	AUTO_SPINS_TEXT_OPTIONS,
	AUTO_SPINS_TEXT_OPTION_MAP,
	LOSS_LIMIT_TEXT_OPTIONS,
	AUTO_SPINS_LOSS_LIMIT_MULTIPLIER_MAP,
	SINGLE_WIN_LIMIT_TEXT_OPTIONS,
	AUTO_SPINS_SINGLE_WIN_LIMIT_MULTIPLIER_MAP,
} from 'state-shared';
import { getContextEventEmitter } from 'utils-event-emitter';

import { boolSource, repeaterSource, valueSource } from './engineSources.svelte';
import { formatBetAmount } from './betAmountFormat';
import { i18nDerived } from './i18n/i18nDerived';
import type { EmitterEventModal } from './types';

/**
 * The BET-MENU and AUTO-SPIN menus as engine feeds — the wiring that makes those two screens
 * AUTHORABLE instead of hard-coded HTML. It adds no screen and opens nothing; it only publishes what
 * an authored screen needs to exist:
 *
 *  1. the `optionCard` ComponentDef, so a `repeater` pointed at any list below stamps a tile;
 *  2. four repeater SOURCES — the bet ladder and the three autoplay ladders — each item carrying the
 *     display `label`, the machine `value`, and whether it is the current pick;
 *  3. four value SOURCES, so a readout on the screen can show the standing choice; and
 *  4. three component ACTIONS (`betMenu`, `autoSpinStart`, `close`), which do two jobs at once: they
 *     make a bound node PRESSABLE, and they give it a `<nodeId>.on<Action>` pin in the flow editor.
 *     Each `onpress` is the CODED fallback, so with nothing authored the game behaves exactly as it
 *     did — `betMenu` opens the same HTML modal the bet readout always opened. Once a flow owns the
 *     pin, `<ComponentInstance>`'s press router suppresses these bodies and runs the authored graph.
 *
 * Sibling of `registerBuyFeature`, and here for the same reason: `engine-layout` is deliberately
 * state-agnostic, so the state-coupled half of an engine feed lives in this package. MUST be called
 * during a component's init (`getContextEventEmitter` reads Svelte context).
 */
export function registerHudMenus(): void {
	const { eventEmitter } = getContextEventEmitter<EmitterEventModal>();

	// Register as BUILT-IN (lowest precedence): this runs AFTER the game's boot
	// `registerBakedComponents()`, so an unflagged re-register would clobber a project's EDITED
	// `optionCard` with the coded default. Flagged, it only seeds the id when nothing else has.
	registerComponents({ [OPTION_CARD_DEF.id]: OPTION_CARD_DEF }, { builtin: true });

	registerRepeaterSources({
		betOptions: repeaterSource(() => betOptionItems()),
		autoSpinOptions: repeaterSource(() =>
			optionItems(
				AUTO_SPINS_TEXT_OPTIONS,
				AUTO_SPINS_TEXT_OPTION_MAP,
				stateUi.autoSpinsText,
				(option) => setAutoSpinsOption(option),
			),
		),
		autoSpinLossLimitOptions: repeaterSource(() =>
			optionItems(
				LOSS_LIMIT_TEXT_OPTIONS,
				AUTO_SPINS_LOSS_LIMIT_MULTIPLIER_MAP,
				stateUi.autoSpinsLossLimitText,
				(option) => setAutoSpinsLossLimitOption(option),
			),
		),
		autoSpinWinLimitOptions: repeaterSource(() =>
			optionItems(
				SINGLE_WIN_LIMIT_TEXT_OPTIONS,
				AUTO_SPINS_SINGLE_WIN_LIMIT_MULTIPLIER_MAP,
				stateUi.autoSpinsSingleWinLimitText,
				(option) => setAutoSpinsSingleWinLimitOption(option),
			),
		),
	});

	registerComponentValues({
		autoSpins: valueSource(() => stateUi.autoSpinsText),
		autoSpinsLossLimit: valueSource(() => stateUi.autoSpinsLossLimitText),
		autoSpinsWinLimit: valueSource(() => stateUi.autoSpinsSingleWinLimitText),
		autoSpinsRemaining: valueSource(() => stateBet.autoSpinsCounter),
	});

	registerComponentActions({
		// The bet readout's press, named. Coded fallback: the HTML bet menu it has always opened.
		// No `disabled` feed: the readout keeps its own mid-spin gate (`HudValue` checks the game's
		// idle state, which lives in the Pixi UI context this package can't read), and the parity
		// discipline is to omit a flag rather than register a wrong one.
		betMenu: {
			onpress: () => {
				eventEmitter.broadcast({ type: 'soundPressGeneral' });
				openBetMenu();
			},
		},
		// Start an autoplay run from the picked options — the state commit plus the `autoBet`
		// broadcast that actually starts the machine, the same pair `AutoSpinsStartButton` fires.
		// Disabled while the stake is unaffordable, mirroring that button.
		autoSpinStart: {
			onpress: () => {
				armAutoSpins();
				eventEmitter.broadcast({ type: 'soundPressGeneral' });
				eventEmitter.broadcast({ type: 'autoBet' });
				closeModal();
			},
			disabled: boolSource(() => !stateBetDerived.isBetCostAvailable()),
		},
		// A generic dismiss, so a screen's ✕ / CANCEL tile is pressable and projects a pin an author
		// wires to `Hide`. Coded fallback: close whatever HTML modal is open.
		close: {
			onpress: () => {
				eventEmitter.broadcast({ type: 'soundPressGeneral' });
				closeModal();
			},
		},
	});
}

/**
 * The bet ladder as tiles — `stateConfig.betMenuOptions`, the same "most used" subset of the RGS
 * `betLevels` the HTML grid shows, with the top entry labelled MAX.
 *
 * Two deliberate differences from `BetMenuAmountGrid`. It does NOT truncate to 15/18 entries: that
 * cap is chrome for a fixed-height modal, and an authored screen sizes its own grid. And the press
 * writes `betAmount` RAW rather than through the balance-clamping `setBetAmount`, because that is
 * what the grid it replaces does — clamping would light up a different tile from the one pressed,
 * and the spin button's own affordability gate already refuses an unpayable stake.
 */
function betOptionItems(): RepeaterItem[] {
	const options = stateConfig.betMenuOptions.filter(
		(value, index, array) => array.indexOf(value) === index,
	);
	const max = options[options.length - 1];
	return options.map((amount) => {
		const selected = amount === stateBet.betAmount;
		return {
			key: String(amount),
			value: amount,
			values: {
				label: amount === max ? i18nDerived.max() : formatBetAmount(amount),
				selected,
				labelFill: selected ? OPTION_CARD_LABEL_FILL_SELECTED : OPTION_CARD_LABEL_FILL,
			},
			onSelect: () => {
				stateBet.betAmount = amount;
			},
		};
	});
}

/**
 * One ladder of TEXT options as tiles — the shape all three autoplay lists share (`'100'`, `'25×'`,
 * `'∞'`). The option text is both the key and the label; `value` is its number from the matching
 * multiplier map (`Infinity` for `∞`), so a flow action can consume the press numerically.
 */
function optionItems(
	options: readonly string[],
	valueMap: Record<string, number>,
	current: string,
	commit: (option: string) => void,
): RepeaterItem[] {
	return options.map((option) => {
		const selected = option === current;
		return {
			key: option,
			value: valueMap[option],
			values: {
				label: option,
				selected,
				labelFill: selected ? OPTION_CARD_LABEL_FILL_SELECTED : OPTION_CARD_LABEL_FILL,
			},
			onSelect: () => commit(option),
		};
	});
}
