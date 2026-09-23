/**
 * Engine repeater-source registry — the list analogue of `registerComponentValues`
 * (value feeds) and `registerComponentActions` (behaviour feeds). It maps a
 * `repeater` node's `source` PARAM (`'featureCards'|…`) to the game's live array of
 * items. Sibling to the other feed registries: the game registers its named repeater
 * sources once at boot, and ANY `repeater` node whose `source` names one binds to it
 * — sources are keyed by SOURCE NAME, not by node, so the same `featureCard`
 * ComponentDef can be repeated by any scene that points a `repeater` at this feed.
 *
 * Module-scoped (private to whichever bundled copy of this package the game pulls in —
 * pnpm gives each game its own copy, so no cross-game leakage). Svelte-free: a source
 * is just the minimal Svelte-store-`subscribe` contract, so this module is re-exported
 * from the bare `engine-layout` (type-only) entry. The engine `<Repeater>` subscribes
 * and renders one `<ComponentInstance>` per item, feeding each item's `values` as that
 * instance's `engineProvided` param values and wiring its `select` press to `onSelect`.
 */

/** One repeated item — the data for a single per-item `<ComponentInstance>`. */
export interface RepeaterItem {
	/**
	 * The `engineProvided` param VALUES for this item's instance (e.g. a feature card's
	 * `title`/`description`/`price`/`buttonLabel`/`iconKey`). Merged into the instance's
	 * param context, so a text/sprite node bound to one of these keys renders the item's
	 * value — the multi-value sibling of the single `value` feed a `HudReadout` binds.
	 */
	values: Record<string, unknown>;
	/** Wired to the instance's `select` press. Absent ⇒ the card is inert (not pressable). */
	onSelect?: () => void;
	/** Stable list key for the `{#each}` (falls back to the item's index). */
	key?: string;
	/**
	 * The item's NUMBER, when its key is the display form of one — a bet amount, an autoplay
	 * count, a limit multiplier (`Infinity` for `∞`). Seeded as the select payload's
	 * `selectedValue` field so a numeric flow action (`setBetAmount(amount)`) can consume the
	 * press directly; a source whose items are pure names (feature cards) leaves it unset and the
	 * pin simply yields nothing.
	 */
	value?: number;
	/**
	 * PER-ITEM component override (distinct, authorable cards): the {@link ComponentDef} id THIS
	 * item instantiates, instead of the repeater node's shared `componentId`. Lets one repeater
	 * render heterogeneous items — a bespoke card per buy-feature mode — from a single source.
	 * Absent ⇒ the item falls back to the node's `componentId`, byte-identical to a uniform
	 * repeater (parity).
	 *
	 * BAKE/SHIP GAP (Phase B): `collectComponentIds` walks the doc STATICALLY and only sees the
	 * repeater node's `componentId`, so a component named here (assigned from config at RUNTIME)
	 * is NOT collected onto the bake/pull chain and would not ship. The config side that assigns
	 * these ids must ALSO collect them onto the bake chain separately (like editor-art keys). This
	 * field only makes the RENDER side heterogeneous; the collection side is a Phase-B concern.
	 */
	componentId?: string;
}

/**
 * Minimal Svelte-store contract a repeater source must satisfy — the list sibling of
 * `ValueSource`, kept to bare `subscribe` so this module stays Svelte-free. Any Svelte
 * `Readable<RepeaterItem[]>` satisfies it, as does a hand-rolled store. `subscribe` MUST
 * invoke `run` synchronously with the current items on subscribe (the Svelte store
 * contract), so the first paint has a real list.
 */
export interface RepeaterSource {
	subscribe(run: (items: RepeaterItem[]) => void): () => void;
}

const registry = new Map<string, RepeaterSource>();

export function registerRepeaterSources(sources: Record<string, RepeaterSource>): void {
	for (const [source, store] of Object.entries(sources)) {
		registry.set(source, store);
	}
}

export function getRepeaterSource(source: string): RepeaterSource | undefined {
	return registry.get(source);
}

export function clearRepeaterSources(): void {
	registry.clear();
}
