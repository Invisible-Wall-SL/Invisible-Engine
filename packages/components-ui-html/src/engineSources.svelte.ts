import type {
	BoolSource,
	RepeaterItem,
	RepeaterSource,
	InstanceValueSource,
	ValueSource,
} from 'engine-layout';

/**
 * The runes→store adapters the engine feed registries take — one home for the three, so the
 * modules that install shared engine feeds from this package (`registerBuyFeature`,
 * `registerHudMenus`) don't each carry their own copy of the same eight lines.
 *
 * All three follow the Svelte store contract the registries require: `subscribe(run)` calls `run`
 * SYNCHRONOUSLY with the current value (so the first paint has real data), then opens an
 * `$effect.root` whose `$effect` re-reads the getter — capturing its reactive deps — and pushes every
 * change, returning the root's stop fn as the unsubscribe. So a registered source simply replays a
 * live runes selector to whichever node binds it.
 */

/** A live LIST feed — what a `repeater` node's `source` param resolves to. */
export function repeaterSource(getter: () => RepeaterItem[]): RepeaterSource {
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

/** A live MAP feed — the `engineProvided` values a flow-shown scene instance reads, keyed by node id. */
export function instanceValueSource(getter: () => Record<string, unknown>): InstanceValueSource {
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

/** A live FLAG feed — a registered action's `disabled`/`active` state. */
export function boolSource(getter: () => boolean): BoolSource {
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

/** A live SCALAR feed — what a readout's `source` param resolves to. `format` renders a number
 *  (currency, percent); a string value is rendered verbatim and ignores it. */
export function valueSource(
	getter: () => number | string,
	format?: (value: number) => string,
): ValueSource {
	return {
		subscribe(run) {
			run(getter());
			return $effect.root(() => {
				$effect(() => {
					run(getter());
				});
			});
		},
		...(format ? { format } : {}),
	};
}
