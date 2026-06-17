/**
 * Shared read-modify-write of the Invisible Test Server's game manifest
 * (`test_server/games.json`) in R2. Both the server-side Publish action
 * (`publishGame.ts`) and the standalone `scripts/publish-game-bundle.mjs` use the
 * SAME canonical shape + merge logic so the two never diverge:
 *
 *   { "games": { "<key>": { "protocol": "lines"|"book", "name": str,
 *                           "runtime"?: str, "updatedAt": iso } } }
 *
 * The optional `runtime` field tells the test server to serve the shared prebuilt
 * bundle at `test_server/_runtime/<runtime>/` instead of per-key files; the mock
 * RGS is still selected per-key by `protocol`. The merge is non-destructive: it
 * preserves every OTHER game's entry (a clobbering write once dropped games).
 */
import { getObjectText, putObjectText } from './r2';

export const TEST_SERVER_MANIFEST_KEY = 'test_server/games.json';

export type MockProtocol = 'lines' | 'book';

export interface TestServerGameEntry {
	protocol: MockProtocol;
	name: string;
	/** Shared prebuilt-bundle id under `test_server/_runtime/<runtime>/` (Game Maker). */
	runtime?: string;
	/** ISO timestamp — passed IN by the caller (no `Date.now()` here). */
	updatedAt: string;
}

export interface TestServerManifest {
	games: Record<string, TestServerGameEntry>;
}

/** Read the manifest (or an empty one when absent / malformed). */
export async function loadTestServerManifest(): Promise<TestServerManifest> {
	const raw = await getObjectText(TEST_SERVER_MANIFEST_KEY);
	if (!raw) return { games: {} };
	try {
		const parsed = JSON.parse(raw) as Partial<TestServerManifest>;
		return { games: parsed.games ?? {} };
	} catch {
		return { games: {} };
	}
}

/**
 * Merge ONE game entry into the manifest (read-modify-write) and persist it,
 * preserving every other game. Returns the written manifest.
 */
export async function upsertTestServerGame(
	key: string,
	entry: TestServerGameEntry,
): Promise<TestServerManifest> {
	const manifest = await loadTestServerManifest();
	manifest.games[key] = entry;
	await putObjectText(
		TEST_SERVER_MANIFEST_KEY,
		JSON.stringify(manifest, null, 2),
		'application/json; charset=utf-8',
	);
	return manifest;
}
