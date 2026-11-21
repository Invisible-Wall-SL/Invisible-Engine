/**
 * Types for what a room's bots are called (`botNames.js`). Pinned by `scripts/check-bot-names.mjs`.
 */

/** The key two names are the same by: letter case aside. */
export function nameKey(name: string): string;

export type BotNamer = {
	/** A name for a new bot of `character` not in `taken` ({@link nameKey}s), or `undefined` for a
	 *  class with no names. */
	next(character: string, taken: ReadonlySet<string>): string | undefined;
};

export function createBotNamer(
	names: Readonly<Record<string, readonly string[]>>,
	seed: number | string,
): BotNamer;
