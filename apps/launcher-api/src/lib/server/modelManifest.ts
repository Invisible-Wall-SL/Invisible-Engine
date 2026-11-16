import { MIRROR_PREFIX } from '$lib/volumeModels';
import { ConflictError, getObjectTextWithEtag, precondition, putObjectText } from './r2';

/**
 * The shared model mirror's manifest — the file `GET /api/launcher/models-manifest` serves to
 * desktops, `runpod/pull-models.py` fills a volume from and `seed-comfyui-models.py` /
 * `runpod/push-models.py` write. Every launcher write is a compare-and-swap on its ETag, retried
 * on a lost race, so two admins (or an admin and a running transfer) cannot drop each other's
 * entries. The owner-run Python scripts (`seed-comfyui-models.py`, `push-models.py`) write it
 * the same way: re-read at write time, merge, conditional put.
 */
export const MANIFEST_KEY = 'tools/invisible-launcher/models-manifest.json';

export interface ManifestEntry {
	key: string;
	dir: string;
	name: string;
	size: number;
	sha256: string;
	/**
	 * `false` = deliberately removed from the RunPod volume while kept in the mirror, so
	 * `pull-models.py` does not put it back. Absent = on the volume (every older entry).
	 */
	volume?: boolean;
	[extra: string]: unknown;
}

export interface ModelsManifest {
	version: number;
	base_prefix: string;
	models: ManifestEntry[];
}

const CAS_ATTEMPTS = 5;

function parse(text: string): ModelsManifest {
	const raw = JSON.parse(text) as Partial<ModelsManifest>;
	return {
		version: raw.version ?? 1,
		base_prefix: raw.base_prefix || MIRROR_PREFIX,
		models: Array.isArray(raw.models)
			? raw.models.filter((m): m is ManifestEntry => !!m && typeof m.key === 'string')
			: [],
	};
}

/** The manifest, or an empty one when it has never been seeded. Throws on a corrupt file. */
export async function readManifest(): Promise<ModelsManifest> {
	const got = await getObjectTextWithEtag(MANIFEST_KEY);
	return got ? parse(got.text) : { version: 1, base_prefix: MIRROR_PREFIX, models: [] };
}

/**
 * Read-modify-write under CAS. `change` edits the entry list in place and returns false to skip
 * the write. A corrupt manifest is refused rather than overwritten — it is what every desktop
 * syncs from, so replacing it with a guess would be worse than failing the action.
 */
export async function updateManifest(change: (models: ManifestEntry[]) => boolean): Promise<void> {
	for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
		const got = await getObjectTextWithEtag(MANIFEST_KEY);
		const manifest = got ? parse(got.text) : { version: 1, base_prefix: MIRROR_PREFIX, models: [] };
		if (!change(manifest.models)) return;
		try {
			await putObjectText(
				MANIFEST_KEY,
				JSON.stringify(manifest, null, 2),
				'application/json',
				precondition(got ? got.etag : null),
			);
			return;
		} catch (e) {
			if (!(e instanceof ConflictError)) throw e;
		}
	}
	throw new Error('The models manifest kept changing underneath this write — try again.');
}

/** `dir` / `name` the way the seeder writes them for `comfyui-models/<rel>`. */
export function entryFor(key: string, size: number, sha256: string): ManifestEntry {
	const rel = key.slice(MIRROR_PREFIX.length + 1);
	const slash = rel.lastIndexOf('/');
	return {
		key,
		dir: slash < 0 ? '' : rel.slice(0, slash),
		name: slash < 0 ? rel : rel.slice(slash + 1),
		size,
		sha256,
	};
}

export function upsertEntry(entry: ManifestEntry): (models: ManifestEntry[]) => boolean {
	return (models) => {
		const i = models.findIndex((m) => m.key === entry.key);
		if (i < 0) models.push(entry);
		else models[i] = { ...models[i], ...entry };
		return true;
	};
}

export function setOnVolume(key: string, onVolume: boolean): (models: ManifestEntry[]) => boolean {
	return (models) => {
		const m = models.find((e) => e.key === key);
		if (!m) return false;
		if (onVolume) delete m.volume;
		else m.volume = false;
		return true;
	};
}

export function removeEntry(key: string): (models: ManifestEntry[]) => boolean {
	return (models) => {
		const i = models.findIndex((m) => m.key === key);
		if (i < 0) return false;
		models.splice(i, 1);
		return true;
	};
}
