/**
 * "Is this published game running an engine older than the one that shipped?" — the ONE
 * definition of engine staleness, shared by the Game Maker page (the per-project amber
 * badge) and the bulk `POST /api/game-maker/publish-all` endpoint (which picks the games
 * to republish). Two readings of the same signal must never disagree: a badge that says
 * stale while the bulk run skips the game is worse than either alone.
 *
 * The signal is a comparison of two existing timestamps — no new stamp file:
 *   - the shared runtime bundle's release time (`_runtime/<id>/index.html` mtime), and
 *   - the game's own last publish (its manifest entry's `updatedAt`).
 *
 * Conservative by design: a missing `runtime`/`updatedAt`, an absent bundle, or a game
 * that was never published ⇒ NOT comparable ⇒ never flagged. An unknown engine version
 * must read as "no claim", not as "up to date" and not as a false alarm.
 */
import {
	runtimeBundleReleasedAt,
	type TestServerManifest,
	loadTestServerManifest,
} from './testServerManifest';

export interface EngineStaleness {
	/** The shared bundle this game is served from (`test_server/_runtime/<id>/`). */
	runtimeId: string | null;
	/** Epoch-ms of the game's last publish, or null when unknown. */
	publishedAt: number | null;
	/** Epoch-ms the runtime bundle was last released, or null when unknown. */
	runtimeReleasedAt: number | null;
	/** Both timestamps known AND the game is published — only then does `stale` mean anything. */
	comparable: boolean;
	/** The runtime shipped AFTER this game's last publish. */
	stale: boolean;
}

const UNKNOWN: EngineStaleness = {
	runtimeId: null,
	publishedAt: null,
	runtimeReleasedAt: null,
	comparable: false,
	stale: false,
};

export interface EngineStalenessIndex {
	/** Staleness for one game key. `published` is the caller's own "has a registered game row". */
	for(key: string, published: boolean): EngineStaleness;
}

/**
 * Resolve every referenced runtime bundle's release time ONCE (normally there is a single
 * id, `lines`) and return a synchronous lookup over the manifest. Pass the manifest in when
 * the caller already loaded it — the Game Maker loader does, for the profile chips.
 */
export async function engineStalenessIndex(
	manifest?: TestServerManifest,
): Promise<EngineStalenessIndex> {
	const games = (manifest ?? (await loadTestServerManifest())).games;

	const runtimeIds = new Set<string>();
	for (const entry of Object.values(games)) {
		if (entry.runtime) runtimeIds.add(entry.runtime);
	}
	const releasedAt = new Map<string, number | null>();
	await Promise.all(
		[...runtimeIds].map(async (id) => releasedAt.set(id, await runtimeBundleReleasedAt(id))),
	);

	return {
		for(key: string, published: boolean): EngineStaleness {
			const entry = games[key];
			if (!entry) return UNKNOWN;
			const runtimeId = entry.runtime ?? null;
			const parsed = entry.updatedAt ? Date.parse(entry.updatedAt) : NaN;
			const publishedAt = Number.isFinite(parsed) ? parsed : null;
			const released = runtimeId ? (releasedAt.get(runtimeId) ?? null) : null;
			const comparable = published && released !== null && publishedAt !== null;
			return {
				runtimeId,
				publishedAt,
				runtimeReleasedAt: released,
				comparable,
				stale: comparable && released! > publishedAt!,
			};
		},
	};
}
