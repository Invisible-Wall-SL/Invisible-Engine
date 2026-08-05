import {
	registerComponents,
	registerRepeaterSources,
	registerInstanceValues,
	FEATURE_CARD_DEF,
	CONFIRM_DIALOG_DEF,
	CONFIRM_DIALOG_NODE_ID,
	type RepeaterItem,
	type RepeaterSource,
	type InstanceValueSource,
} from 'engine-layout';
import { stateBet, stateMeta, stateI18nDerived } from 'state-shared';
import { getContextEventEmitter } from 'utils-event-emitter';
import { numberToCurrencyString } from 'utils-shared/amount';

import { stateBonus, stateBonusDerived } from './stateBonus.svelte';
import { i18nDerived } from './i18n/i18nDerived';
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
 * Wrap a runes getter as an {@link InstanceValueSource} — the MAP sibling of {@link repeaterSource},
 * replaying a live `engineProvided` values map (title/message/…) to whichever scene instance the feed
 * is keyed to. Same store contract: synchronous first emit, then an `$effect.root` pushes every
 * change (so a new bet mode picked ⇒ a new title/message threads through without re-mounting).
 */
function instanceValueSource(getter: () => Record<string, unknown>): InstanceValueSource {
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
 *     `buyBonusConfirm` (which each game routes to the in-canvas `<BuyBonusConfirm>` step), and
 *  3. registers the `confirm-dialog` instance-value feed: the per-mode `engineProvided` values
 *     (title/message/confirm+cancel labels/image) the FLOW-shown confirm dialog reads — the flow
 *     twin of the values `<BuyBonusConfirm>` injects imperatively via the instance-binding context.
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
	// Register as BUILT-IN (lowest precedence): this call runs AFTER the game's boot
	// `registerBakedComponents()`, so an unflagged re-register would clobber a project's
	// EDITED `featureCard`/`confirmDialog` with the coded default. Flagged, the built-in
	// only seeds the id when no project/baked def exists — the project shadow wins (§8).
	registerComponents(
		{
			[FEATURE_CARD_DEF.id]: FEATURE_CARD_DEF,
			[CONFIRM_DIALOG_DEF.id]: CONFIRM_DIALOG_DEF,
		},
		{ builtin: true },
	);
	registerRepeaterSources({
		featureCards: repeaterSource(() =>
			Object.values(stateMeta.betModeMeta)
				.filter((mode) => mode.type !== 'default')
				.map((mode) => ({
					key: mode.mode,
					// Per-mode CARD: the config assigns this mode its own card ComponentDef id. Set ⇒ the
					// repeater instantiates THAT card for this item (Phase A per-item `componentId`); unset ⇒
					// `undefined` ⇒ the item falls back to the node's default `featureCard` (byte-identical to
					// before). The def rides the bake chain because the launcher collector reads the config's
					// `card` ids (see `betModeCardIds`) — the runtime-assigned ids a static scene walk misses.
					componentId: mode.card || undefined,
					values: {
						title: mode.text.title,
						description: mode.text.description ?? '',
						price: numberToCurrencyString(stateBet.betAmount * mode.costMultiplier),
						buttonLabel: mode.text.button,
						iconKey: mode.assets.icon,
						// Per-mode card param overrides (config `cardParams`): merged AFTER the engine-provided
						// fields so a mode can restyle ANY card param (panel/icon frame/button/spine/tint/…) —
						// the repeater threads each into the card instance's param context, where it wins over
						// the component's authored default. Spread LAST so an override may also replace an
						// engine-provided field if the author intends to. Empty/absent ⇒ no overrides (parity).
						...(mode.cardParams ?? {}),
					},
					onSelect: () => {
						stateBonus.selectedBetModeKey = mode.mode;
						eventEmitter.broadcast({ type: 'buyBonusConfirm' });
					},
				})),
		),
	});
	// Feed the FLOW-shown confirm dialog its per-mode `engineProvided` values. In the imperative path
	// `<BuyBonusConfirm>` → `<ConfirmDialog>` supplies these via the instance-binding context; when the
	// buy flow runs in Flow mode the `buyConfirm` scene is shown GENERICALLY (`showContainer`), with no
	// mount to inject them, so the dialog would render the def-default labels. This node-id-keyed feed
	// (keyed to the seeded `confirm-dialog` instance, NOT the reusable `confirmDialog` component) is the
	// engine's lowest-precedence supplier — consulted only when neither prop nor binding is present, so
	// the imperative path is untouched. Mirrors `<BuyBonusConfirm>`'s `values` derivation exactly (source
	// strings translated at read; reactive on `stateBonus.selectedBetModeKey` via `selectedBetModeData`).
	registerInstanceValues({
		[CONFIRM_DIALOG_NODE_ID]: instanceValueSource(() => {
			const mode = stateBonusDerived.selectedBetModeData();
			return {
				title: stateI18nDerived.translate(mode?.text.title ?? ''),
				message: stateI18nDerived.translate(mode?.text.dialog ?? ''),
				confirmLabel: i18nDerived.confirm(),
				cancelLabel: i18nDerived.cancel(),
				imageKey: mode?.assets.dialogImage ?? '',
			};
		}),
	});
}
