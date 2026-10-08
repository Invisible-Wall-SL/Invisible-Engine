/**
 * The selectable game kinds offered by every "new game from kind" picker: the
 * built-in scene sets (`engine-layout`) plus author-created custom kinds (§21.6),
 * de-duplicated with built-ins winning. Shared by the `/admin` createProject action
 * and the Invisible Game Maker page so both offer — and validate against — the SAME
 * union (never a client-only const). Extracted from `admin/+page.server.ts`.
 */
import { listFullSceneSets } from 'engine-layout';
import { listKinds } from './kindStorage';

export interface SelectableGameKind {
	id: string;
	name: string;
	/** A kind still stored on existing projects but no longer offered for a new one. Listed so a
	 *  project of it keeps its name and the pickers can show its current value. */
	retired?: true;
}

/**
 * Kinds no new game is made as. `bookOf` is the Book-of mechanic, now a Game Config feature of a
 * lines game (`freeSpins.expandingSymbol`, `docs/design/book-feature.md`): Game Maker offers
 * "Book of Thermopylae" as lines plus its preset instead. Its projects keep the kind until they are
 * migrated (Phase 6); the kind itself goes in Phase 7.
 */
export const RETIRED_GAME_KINDS: ReadonlySet<string> = new Set(['bookOf']);

/** The kinds a picker offers for a NEW game (or a kind change): the selectable ones not retired. */
export const offeredGameKinds = (kinds: SelectableGameKind[]): SelectableGameKind[] =>
	kinds.filter((k) => !k.retired);

export async function selectableGameKinds(): Promise<SelectableGameKind[]> {
	const builtins = listFullSceneSets().map((s) => ({
		id: s.gameType,
		name: s.name,
		...(RETIRED_GAME_KINDS.has(s.gameType) ? { retired: true as const } : {}),
	}));
	const seen = new Set(builtins.map((b) => b.id));
	const out: SelectableGameKind[] = [...builtins];
	for (const k of await listKinds()) {
		if (seen.has(k.id)) continue;
		seen.add(k.id);
		out.push({ id: k.id, name: k.name });
	}
	return out;
}
