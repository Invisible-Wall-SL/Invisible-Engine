import {
	registerComponents,
	registerRepeaterSources,
	FEATURE_CARD_DEF,
	CONFIRM_DIALOG_DEF,
	type RepeaterItem,
	type RepeaterSource,
} from 'engine-layout';
import { stateBet, stateMeta } from 'state-shared';
import { getContextEventEmitter } from 'utils-event-emitter';
import { numberToCurrencyString } from 'utils-shared/amount';

import { stateBonus } from './stateBonus.svelte';
import type { EmitterEventModal } from './types';

/**
 * Wrap a runes getter as a {@link RepeaterSource} — the list sibling of a value source. On
 * `subscribe(run)` it calls `run` with the current items SYNCHRONOUSLY (the Svelte store contract —
 * first paint has a real list), then spins up an `$effect.root` whose `$effect` re-reads `getter()`
 * (capturing its reactive deps) and pushes every change to `run`, returning the root's stop fn as
 * the unsubscribe. So the registered source replays the live selector to whichever `repeater` binds.
 */
function repeaterSource(getter: () => RepeaterItem[]): RepeaterSource {
	return {
		subscribe(run) {
			run(getter());
			return $effect.root(() => {
				$effect(() => {
					run(getter());
				});
			});
		},
	};
}

/**
 * Register the in-canvas Select-Feature (buy-bonus) menu once at boot — the SHARED wiring every
 * game calls in one line, so the Pixi `buyFeature` scene is the default buy-bonus SELECT surface
 * for all projects (the HTML `ModalBuyBonus` is deleted). It:
 *
 *  1. registers the built-in `featureCard` ComponentDef, so a `repeater(source:'featureCards')`
 *     resolves the card the def draws (panel + icon + title/description/price + button), and
 *  2. registers the `featureCards` source: one `featureCard` per non-default bet mode, fed from
 *     the ACTIVE config (`stateMeta.betModeMeta` × `stateBet.betAmount`). Each card's per-item
 *     values mirror the retired HTML `BonusCards` (title/description are source strings localized
 *     at render; `price` is the live bet × cost multiplier; `iconKey` is the bet-mode icon), and
 *     its `select` press preserves the HTML card's contract: select the mode + broadcast
 *     `buyBonusConfirm` (which each game routes to the in-canvas `<BuyBonusConfirm>` step).
 *
 * MUST be called during a component's init (`getContextEventEmitter` reads Svelte context). Lives in
 * `components-ui-html` — the home of `stateBonus` + the buy-bonus domain — because `engine-layout`
 * is deliberately state-agnostic (no `state-shared` import), so the state-coupled wiring stays here.
 * A game with no non-default bet mode registers an empty list ⇒ the menu never has cards to show.
 */
export function registerBuyFeature(): void {
	const { eventEmitter } = getContextEventEmitter<EmitterEventModal>();
	// Register the two built-in defs the buy-bonus flow renders: the `featureCard` (the SELECT menu's
	// per-mode card) and the generic `confirmDialog` (the CONFIRM step's `<ConfirmDialog>` / the twin
	// of the retired HTML `ModalBuyBonusConfirm`), so both `componentInstance`s resolve at render.
	registerComponents({
		[FEATURE_CARD_DEF.id]: FEATURE_CARD_DEF,
		[CONFIRM_DIALOG_DEF.id]: CONFIRM_DIALOG_DEF,
	});
	registerRepeaterSources({
		featureCards: repeaterSource(() =>
			Object.values(stateMeta.betModeMeta)
				.filter((mode) => mode.type !== 'default')
				.map((mode) => ({
					key: mode.mode,
					values: {
						title: mode.text.title,
						description: mode.text.description ?? '',
						price: numberToCurrencyString(stateBet.betAmount * mode.costMultiplier),
						buttonLabel: mode.text.button,
						iconKey: mode.assets.icon,
					},
					onSelect: () => {
						stateBonus.selectedBetModeKey = mode.mode;
						eventEmitter.broadcast({ type: 'buyBonusConfirm' });
					},
				})),
		),
	});
}
