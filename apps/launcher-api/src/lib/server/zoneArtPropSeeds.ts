import { resolveComponentClosureWithPins, type ComponentDef } from 'engine-layout';
import { zoneArtComponentRoots, type GameConfigDoc } from 'game-config';

import type { LoadComponent } from './zoneArtProps';

/**
 * THE SHIP STEP (§6 step 4): what the bundle's component closure is seeded with for the zone art's
 * prop components, which no scene places, and the exact versions it must ship beside the latest.
 * Each pinned root's closure is resolved as a placed instance's is
 * (`resolveComponentClosureWithPins` over its nodes): every id it names (its piece defs) seeds the
 * bundle's walk, and every def it pins (a piece pinned at a version, as the root is) ships at that
 * version with the root, so the runtime draws the pieces the save's version was authored with.
 */
export async function zoneArtPropSeeds(
	gameConfig: GameConfigDoc | null | undefined,
	load: LoadComponent,
): Promise<{ ids: string[]; pinned: ComponentDef[] }> {
	if (!gameConfig) return { ids: [], pinned: [] };
	const ids = new Set<string>();
	const pinned: ComponentDef[] = [];
	for (const root of zoneArtComponentRoots(gameConfig)) {
		ids.add(root.component);
		const def = await load(root.component, root.version);
		if (!def) continue;
		pinned.push(def);
		const closure = await resolveComponentClosureWithPins(
			def.root.children,
			(id) => load(id),
			(id, version) => load(id, version),
		);
		for (const id of Object.keys(closure.defs)) ids.add(id);
		for (const version of closure.versions)
			if (!pinned.some((p) => p.id === version.id && p.version === version.version))
				pinned.push(version);
	}
	return { ids: [...ids], pinned };
}
