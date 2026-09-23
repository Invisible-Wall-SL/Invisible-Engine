/**
 * Repeater SELECT vocabulary — the ONE source of the strings the repeater's fused flow pin is
 * built from, shared by the RUNTIME side (`engine-layout`'s `<Repeater>`, which routes a card press
 * through the flow) and the AUTHOR side (`engine-flow-v2`, which projects the fused `onSelect` pin +
 * its selected-key data-out). Both packages already depend on `constants-shared` and NOT on each
 * other, so this shared home keeps the pin id, the ownership key, and the seeded trigger-payload
 * field from ever drifting across the declare/implement split.
 */

/**
 * The container-event NAME a `repeater` node's card press fires (`ownsContainerEvent(repeaterId,
 * REPEATER_SELECT_EVENT)` / the fused `<repeaterId>.onSelect` exec-out). Mirrors the `select` signal
 * the built-in `featureCard` def declares — one fused pin for the whole list (N items → one pin), the
 * repeater analogue of a button's `onSpin`.
 */
export const REPEATER_SELECT_EVENT = 'select';

/**
 * The trigger-payload FIELD carrying WHICH item was selected — the `RepeaterItem.key` (for feature
 * cards, the bet-mode key). Named `betModeKey` so the Phase-3a `selectBetMode` flow action (which
 * reads `payload.betModeKey`) consumes it with no mapping. It is both the seeded `$trigger` field at
 * dispatch (`{ betModeKey: item.key }`) and the id tail of the fused pin's data-out
 * (`<repeaterId>.onSelect.betModeKey`).
 */
export const REPEATER_SELECTED_KEY = 'betModeKey';

/**
 * The GENERIC name for the same string — `betModeKey` reads as buy-feature jargon on a repeater of
 * bet amounts or autoplay counts, so every select payload carries the item's key under BOTH names
 * and the author wires whichever reads right. `betModeKey` stays because existing docs hold edges to
 * it (and `selectBetMode` consumes it unmapped); new wiring should prefer this one.
 */
export const REPEATER_SELECTED_ID = 'selectedKey';

/**
 * The trigger-payload FIELD carrying the selected item's NUMBER — `RepeaterItem.value`, the machine
 * reading of the key a card displays (bet amount `5`, autoplay count `100`, `Infinity` for `∞`).
 * A key is a string, so a numeric flow action (`setBetAmount(amount)`) cannot consume it; this is the
 * pin that feeds those. A source that has no number for an item leaves it `undefined` — the pin is
 * declared regardless (the projection is static, the items are a runtime registry read), so an author
 * wiring it off a key-only source simply gets nothing.
 */
export const REPEATER_SELECTED_VALUE = 'selectedValue';
