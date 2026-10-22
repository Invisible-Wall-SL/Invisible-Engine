import type { ComponentDef } from 'engine-layout';

import { pinnedDefKey } from './editorCanvas.helpers';

/**
 * Reads the older component versions the screens' placements pin (§8.9), each once: a version is an
 * immutable snapshot. The returned `request` is idempotent per pin, and `onLoad` receives each def
 * that is exactly the version asked for. A version the store does not hold (404) is not asked
 * again, and its placements draw the latest, as the game does; a failed read is retried on the next
 * request.
 */
export function createPinnedVersionLoader(
	projectKey: string,
	onLoad: (def: ComponentDef) => void,
): (id: string, version: number) => void {
	const requested = new Set<string>();
	return (id, version) => {
		const key = pinnedDefKey(id, version);
		if (requested.has(key)) return;
		requested.add(key);
		const query = new URLSearchParams({ id, version: String(version) });
		if (projectKey) query.set('project', projectKey);
		fetch(`/api/editor/component?${query}`)
			.then(async (res) => {
				if (res.status === 404) return;
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const def = (await res.json()) as ComponentDef;
				if (def.id === id && def.version === version) onLoad(def);
			})
			.catch(() => requested.delete(key));
	};
}
