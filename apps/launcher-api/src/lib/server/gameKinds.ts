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
}

export async function selectableGameKinds(): Promise<SelectableGameKind[]> {
	const builtins = listFullSceneSets().map((s) => ({ id: s.gameType, name: s.name }));
	const seen = new Set(builtins.map((b) => b.id));
	const out: SelectableGameKind[] = [...builtins];
	for (const k of await listKinds()) {
		if (seen.has(k.id)) continue;
		seen.add(k.id);
		out.push({ id: k.id, name: k.name });
	}
	return out;
}
