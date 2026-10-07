import { SYMBOL_ENUM } from 'engine-flow-v2';

/** What an enum literal's picker draws. */
export interface EnumChoices {
	/** The enum's values, as the vocabulary lists them. */
	options: readonly string[];
	/** Stored values the options do not hold — shown and flagged, never dropped. */
	stale: string[];
	/** The suffix a stale value's label carries (`W — not in play`). */
	flag: string;
	/** The line under a picker holding a stale value. */
	note: string;
}

/**
 * The picker for an enum literal (`stored`: a value, or a list's values) over its enum's `values`.
 * A stored value the values no longer hold stays VISIBLE and FLAGGED, so the author can see it and
 * change or remove it themselves; nothing here rewrites it. A `SymbolName` value is "not in play" —
 * the project's symbols are Invisible Game Config's — but only once those are known: with none
 * listed, nothing is flagged as out of play.
 */
export function enumChoices(
	enumName: string,
	values: readonly string[],
	stored: unknown,
): EnumChoices {
	const held = (Array.isArray(stored) ? stored : [stored]).filter(
		(value): value is string => typeof value === 'string' && value !== '',
	);
	const stale = [...new Set(held.filter((value) => !values.includes(value)))];
	const symbols = enumName === SYMBOL_ENUM && values.length > 0;
	return {
		options: values,
		stale,
		flag: symbols ? 'not in play' : 'not listed',
		note: symbols
			? 'Not in play in Invisible Game Config — kept as authored. Pick an in-play symbol, or put it back on the reels there.'
			: 'Not among the current options — kept as authored.',
	};
}
