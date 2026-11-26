import { collectComponentIds, type ComponentDef } from 'engine-layout';
import { zoneArtComponentRoots, type GameConfigDoc } from 'game-config';

import type { LoadComponent } from './zoneArtProps';

/**
 * THE SHIP STEP (§6 step 4): what the bundle's component closure is seeded with for the zone art's
 * prop components, which no scene places: each component's id and the ids its pinned def names
 * (its piece defs), and the pinned defs themselves, which the bundle ships beside the latest (as
 * a pinned instance's version is) so the runtime resolves the exact version the save compiled.
 */
export async function zoneArtPropSeeds(
	gameConfig: GameConfigDoc | null | undefined,
	load: LoadComponent,
): Promise<{ ids: string[]; pinned: ComponentDef[] }> {
	if (!gameConfig) return { ids: [], pinned: [] };
	const roots = zoneArtComponentRoots(gameConfig);
	const pinned = (await Promise.all(roots.map((r) => load(r.component, r.version)))).filter(
		(def): def is ComponentDef => !!def,
	);
	const ids = [
		...roots.map((r) => r.component),
		...pinned.flatMap((def) => collectComponentIds([def.root])),
	];
	return { ids: [...new Set(ids)], pinned };
}
