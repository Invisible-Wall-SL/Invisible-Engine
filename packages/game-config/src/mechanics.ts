import type { GameConfigDoc, WinModelType } from './types';
import { resolveWinModel } from './winModel';

/**
 * The win models whose games CASCADE by default.
 *
 * A cascade is a board mechanic rather than a template (see
 * `docs/design/game-type-templates.md` Phase F), so it is deliberately NOT a field inside
 * {@link WinModel} — a lines game is allowed to tumble and a cluster game is allowed not to. What
 * the type gives us is the right DEFAULT: a `cluster` / `scatter` game that never removes its
 * winners and drops the survivors is not a variant, it is broken.
 *
 * Adding a future tumble type is one entry here, and every surface that asks "does this game
 * tumble" follows automatically.
 */
export const CASCADE_BY_DEFAULT: ReadonlySet<WinModelType> = new Set(['cluster', 'scatter']);

/** Does a game of this win model tumble unless its project says otherwise? */
export function cascadeDefaultFor(type: WinModelType): boolean {
	return CASCADE_BY_DEFAULT.has(type);
}

/**
 * Does this game cascade? The project's authored answer wins; absent ⇒ the win model's default.
 *
 * Read it through here rather than touching `doc.cascade`, for the same reason
 * {@link resolveWinModel} exists: otherwise "absent means it depends on the type" gets
 * re-implemented at each site and eventually mis-implemented at one of them.
 */
export function resolveCascade(
	doc: Pick<GameConfigDoc, 'winModel' | 'cascade'> | undefined,
): boolean {
	if (typeof doc?.cascade === 'boolean') return doc.cascade;
	return cascadeDefaultFor(resolveWinModel(doc).type);
}

/**
 * Normalize an authored `cascade`, or `undefined` when there is nothing worth storing.
 *
 * Same invariant as the rest of this schema — store only what DEPARTS from the default — so a
 * config that simply agrees with its type normalizes byte-identically to one that never mentioned
 * the field, and every doc authored before this existed is untouched.
 */
export function normalizeCascade(raw: unknown, type: WinModelType): boolean | undefined {
	if (typeof raw !== 'boolean') return undefined;
	return raw === cascadeDefaultFor(type) ? undefined : raw;
}
