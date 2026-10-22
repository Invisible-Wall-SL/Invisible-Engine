import type { ElementFxEntry, ElementFxTrigger } from 'constants-shared/elementFx';
import { SYMBOL_STATES, type SymbolStateName } from 'engine-layout';

/**
 * PER-SYMBOL ELEMENT FX — the effects one symbol plays in one of its states: a shake as it lands, a
 * glow while it wins, a melt as it explodes. The symbols doc's `symbolFx` section (symbol → state →
 * entries), authored in `/symbols` and baked as `bundle.symbols.symbolFx`; the game reads each list
 * through `readElementFxEntries` and plays its `enter` and `always` entries. A state plays exactly
 * its own list: nothing is inherited from the state whose art it borrows.
 *
 * Shared by the server's `normalizeSymbolsDoc` and the page's setter and dirty signature, so the
 * page signs exactly what a save stores (the arrangement `normalizeFlights` has).
 */

/**
 * The triggers a symbol's state offers: `enter` plays each time the symbol enters the state,
 * `always` loops while it is in it. Not `keyed` (no timeline poses a symbol) and not `cue` (a cue
 * would reach every symbol in that state at once).
 */
export const SYMBOL_FX_TRIGGERS = [
	'enter',
	'always',
] as const satisfies readonly ElementFxTrigger[];

/** How the two read in `/symbols`: a symbol is not "shown", it is in a state. */
export const SYMBOL_FX_TRIGGER_TEXT: Record<
	(typeof SYMBOL_FX_TRIGGERS)[number],
	{ label: string; summary: string }
> = {
	enter: { label: 'When it enters this state', summary: 'entering the state' },
	always: { label: 'While in this state (loops)', summary: 'while in the state, looping' },
};

/** The most entries one symbol's state keeps; a longer list is cut to its first ones. */
export const SYMBOL_FX_MAX = 12;

export type SymbolFxMap = Record<string, Partial<Record<SymbolStateName, ElementFxEntry[]>>>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `raw` as the doc stores it, or undefined when nothing is left: per symbol (a non-blank name) per
 * state (a `SYMBOL_STATES` key), a list of plain objects, at most {@link SYMBOL_FX_MAX}. The entries
 * are kept VERBATIM, not read, so one a newer build wrote (a kind this build does not know) survives
 * a save. An emptied list drops its state, and a symbol left with no state drops itself.
 */
export function pruneSymbolFx(raw: unknown): SymbolFxMap | undefined {
	if (!isRecord(raw)) return undefined;
	const out: SymbolFxMap = {};
	for (const [symbol, states] of Object.entries(raw)) {
		if (!symbol.trim() || !isRecord(states)) continue;
		const kept: Partial<Record<SymbolStateName, ElementFxEntry[]>> = {};
		for (const state of SYMBOL_STATES) {
			const list = states[state];
			if (!Array.isArray(list)) continue;
			const entries = list.filter(isRecord).slice(0, SYMBOL_FX_MAX);
			if (entries.length) kept[state] = entries as unknown as ElementFxEntry[];
		}
		if (Object.keys(kept).length) out[symbol] = kept;
	}
	return Object.keys(out).length ? out : undefined;
}
