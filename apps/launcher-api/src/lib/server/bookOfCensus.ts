/**
 * The BOOK-OF CENSUS (`docs/design/book-feature.md` §6–§7): read-only proof that nothing of the
 * retired `bookOf` kind is left. Phase 6's migration moved every Book-of project to `lines` with
 * the expanding symbol; Phase 7 removed the kind, the `book` protocol and the migration itself, and
 * merges only while this census is clear:
 *   - no project row whose `game_type` is still `bookOf` (now an unknown, custom-looking kind);
 *   - no test-server manifest entry still dealt by the book mock (`protocol: 'book'`) — the test
 *     server no longer mounts it, so such a game would not be served;
 *   - no `_shared/editor-templates/bookOf.json`;
 *   - no republish the migration left pending (`_shared/migrations/book-of/<project>.json`).
 * Writes nothing.
 */
import { editorTemplateKey } from './projectPaths';
import { listProjects } from './projects';
import { getObjectText, listAllKeys, objectExists } from './r2';
import { loadTestServerManifest } from './testServerManifest';

/** The retired kind, and the protocol that dealt it — read from stored data, never written. */
const RETIRED_KIND = 'bookOf';
const RETIRED_PROTOCOL = 'book';
/** Where the Phase 6 migration recorded a republish that had not landed. */
const PENDING_PREFIX = '_shared/migrations/book-of/';

export type BookOfCensus = {
	/** Project rows still of the retired kind. */
	projects: { key: string; name: string }[];
	/** Manifest entries still on the book protocol. */
	bookManifestEntries: { key: string; projectKey: string | null; runtime: string | null }[];
	/** Whether `_shared/editor-templates/bookOf.json` exists. */
	editorTemplate: boolean;
	/** Projects whose migration republish never landed, and the games it named. */
	pendingRepublish: { project: string; games: string[] }[];
	/** Every list empty and no editor template. */
	clear: boolean;
};

async function readPending(): Promise<BookOfCensus['pendingRepublish']> {
	const out: BookOfCensus['pendingRepublish'] = [];
	for (const key of await listAllKeys(PENDING_PREFIX)) {
		let games: string[] = [];
		try {
			const marker = JSON.parse((await getObjectText(key)) ?? '') as { games?: unknown };
			if (Array.isArray(marker.games)) games = marker.games.map(String);
		} catch {
			// An unreadable marker still counts: something was left pending.
		}
		out.push({ project: key.slice(PENDING_PREFIX.length).replace(/\.json$/, ''), games });
	}
	return out;
}

export async function bookOfCensus(): Promise<BookOfCensus> {
	const [rows, manifest, editorTemplate, pendingRepublish] = await Promise.all([
		listProjects(),
		loadTestServerManifest(),
		objectExists(editorTemplateKey(RETIRED_KIND)),
		readPending(),
	]);
	const projects = rows
		.filter((p) => p.gameType === RETIRED_KIND)
		.map((p) => ({ key: p.key, name: p.name }));
	const bookManifestEntries = Object.entries(manifest.games)
		.filter(([, entry]) => (entry.protocol as string) === RETIRED_PROTOCOL)
		.map(([key, entry]) => ({
			key,
			projectKey: entry.projectKey ?? null,
			runtime: typeof entry.runtime === 'string' && entry.runtime ? entry.runtime : null,
		}));
	return {
		projects,
		bookManifestEntries,
		editorTemplate,
		pendingRepublish,
		clear:
			!projects.length &&
			!bookManifestEntries.length &&
			!editorTemplate &&
			!pendingRepublish.length,
	};
}
