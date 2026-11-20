import type { GameConfigDoc } from 'game-config';
import { adoptSaved, bodyFor, openDoc } from '../../src/routes/(app)/config/pageDoc.ts';
import type { Harness } from './harness';

/**
 * THE ROUND TRIP of `check:characters-tool`: a config through the page's own load (`openDoc`), the
 * REAL save (`gameConfigStorage` `saveGameConfigDoc`) and the real load, over the gate's in-memory
 * R2. §8 sets what it runs on once its storage is mocked ({@link setRoundTrip}); §8 and §12 then
 * each run their own configs through it.
 */
export interface RoundTripDeps {
	client: string;
	save: (
		client: string,
		project: string,
		doc: GameConfigDoc,
		etag: string | null,
	) => Promise<{ doc: GameConfigDoc }>;
	load: (
		client: string,
		project: string,
	) => Promise<{ doc: GameConfigDoc | null; etag: string | null }>;
	/** The bytes stored for a project. */
	stored: (project: string) => string;
}

let deps: RoundTripDeps | undefined;

export const setRoundTrip = (next: RoundTripDeps): void => {
	deps = next;
};

const text = (v: unknown): string => JSON.stringify(v);

/** Stored bytes without their stamp, as the save lays them out. */
const unstamped = (bytes: string): string => {
	const doc = JSON.parse(bytes) as Record<string, unknown>;
	delete doc.updatedAt;
	return JSON.stringify(doc, null, 2);
};

/**
 * Open `config` as the page does, save it, and open and save what was stored: five checks, each
 * labelled `<section>. round trip, <name>: …`. Returns the bytes stored at the end, or `undefined`
 * when §8 has not set the storage up.
 */
export async function roundTrip(
	t: Harness,
	section: string,
	name: string,
	config: GameConfigDoc,
): Promise<string | undefined> {
	const label = `${section}. round trip, ${name}`;
	if (!deps) {
		t.check(`${label}: the storage of §8 is set up`, false);
		return undefined;
	}
	const { client, save, load, stored } = deps;
	const project = `${section}-${name}`.replace(/\W+/g, '-');
	const live = openDoc(JSON.parse(text(config)) as GameConfigDoc);
	const first = await save(client, project, bodyFor(live), null);
	const bytes = stored(project);
	t.same(`${label}: the save stores what the page held`, JSON.parse(unstamped(bytes)), live);
	const kept = JSON.parse(bytes) as GameConfigDoc;
	t.check(
		`${label}: … its characters and classes byte for byte`,
		text(kept.arcade?.characters) === text(live.arcade?.characters) &&
			text(kept.arcade?.online?.characters) === text(live.arcade?.online?.characters),
	);
	t.same(`${label}: the page adopts what was stored`, adoptSaved(first.doc), JSON.parse(bytes));
	const { doc: loaded, etag } = await load(client, project);
	const reopened = openDoc(loaded!);
	await save(client, project, bodyFor(reopened), etag);
	t.check(
		`${label}: opened and saved untouched, the bytes are the same`,
		unstamped(stored(project)) === unstamped(bytes),
	);
	t.check(
		`${label}: … and so is what the page then sends`,
		text(bodyFor(openDoc((await load(client, project)).doc!))) ===
			text({
				...(JSON.parse(text(bodyFor(reopened))) as GameConfigDoc),
				updatedAt: (JSON.parse(stored(project)) as { updatedAt?: unknown }).updatedAt,
			}),
	);
	return stored(project);
}
