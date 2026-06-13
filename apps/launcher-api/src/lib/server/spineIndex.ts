/**
 * Server-side port of the `skeletons.json` scan/index logic from
 * `scripts/r2-sync-spines.mjs` (`scan()`, `isSkeletonJson`, `detectVersion`,
 * `runtimeLine`, `atlasPma`, `b64url`). Instead of walking a local folder it
 * walks an R2 spines prefix and reads file heads back from R2, so the index the
 * launcher writes is BYTE-COMPATIBLE with what the CLI script produces — the
 * exact shape `spine.ts` (`resolveEditorSpine` / `resolveSkeletonsRoot`) reads.
 *
 * Format parity is load-bearing: keep this aligned with the script. The fields
 * `spine.ts` actually consumes are `folder`, `skeleton_file`, `atlas_file`,
 * `format`, `runtime`, `pma` (others — `name`, `version`, `dir_b64`, `id` — are
 * carried for the viewer + index round-trip).
 */
import { getObjectBytes, getObjectText, listAllKeys } from './r2';

/**
 * Is a spine bundle dir named `name` already present under `spinesPrefix` —
 * CASE-INSENSITIVELY? R2 keys are case-sensitive, so a plain existence check lets
 * `Test1` and `test1` coexist as separate bundles; the Rigger's New-rig / upload use
 * this so a fresh rig can't shadow an existing one by case alone.
 */
export async function spineBundleNameTaken(spinesPrefix: string, name: string): Promise<boolean> {
	const lower = name.toLowerCase();
	const keys = await listAllKeys(`${spinesPrefix}/`);
	for (const k of keys) {
		const seg = k.slice(spinesPrefix.length + 1).split('/')[0];
		if (seg && seg.toLowerCase() === lower) return true;
	}
	return false;
}

/** Asset extensions the spine sync uploads — everything else is skipped.
 * `.irig` = the Invisible Rigger's edited-skeleton format (Spine JSON under our
 * extension); indexed as a first-class JSON skeleton so saved edits re-open. */
export const SPINE_ASSET_EXT = new Set([
	'.atlas',
	'.json',
	'.irig',
	'.skel',
	'.png',
	'.webp',
	'.jpg',
	'.jpeg',
]);

/** Content-type per extension — byte-identical to the script's CONTENT_TYPE map. */
export const SPINE_CONTENT_TYPE: Record<string, string> = {
	'.atlas': 'text/plain; charset=utf-8',
	'.json': 'application/json',
	'.irig': 'application/json',
	'.skel': 'application/octet-stream',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
};

const VER_RE = /(\d+)\.(\d+)\.(\d+)/;

export function spineExt(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

export function contentTypeForSpineFile(name: string): string {
	return SPINE_CONTENT_TYPE[spineExt(name)] ?? 'application/octet-stream';
}

function b64url(s: string): string {
	return Buffer.from(s, 'utf8').toString('base64url');
}

function basename(name: string): string {
	const i = name.lastIndexOf('/');
	return i === -1 ? name : name.slice(i + 1);
}

function stemOf(name: string): string {
	const base = basename(name);
	const dot = base.lastIndexOf('.');
	return dot === -1 ? base : base.slice(0, dot);
}

function isSkeletonJson(head: string): boolean {
	return head.includes('"skeleton"') && head.includes('"bones"');
}

function detectVersion(file: string, head: string): string {
	const ext = spineExt(file);
	if (ext === '.json' || ext === '.irig') {
		const m = head.match(/"spine"\s*:\s*"([^"]+)"/);
		if (m) return m[1];
	}
	const m = head.match(VER_RE);
	return m ? `${+m[1]}.${+m[2]}.${+m[3]}` : '';
}

function runtimeLine(version: string): string {
	const m = (version || '').match(/(\d+)\.(\d+)/);
	const line = m ? `${m[1]}.${m[2]}` : '';
	return line === '4.1' || line === '4.2' ? line : '4.2';
}

function atlasPma(text: string): boolean {
	return /^\s*pma\s*:\s*true\s*$/im.test(text.slice(0, 2000));
}

export interface SkeletonIndexEntry {
	name: string;
	folder: string;
	skeleton_file: string;
	atlas_file: string;
	format: 'skel' | 'json';
	version: string;
	runtime: string;
	pma: boolean;
	dir_b64: string;
	id: number;
}

export interface SkeletonsIndex {
	prefix: string;
	skeletons: SkeletonIndexEntry[];
}

/**
 * Build the `skeletons.json` index for a spines prefix in R2. Lists every object
 * under `${spinesPrefix}/`, groups by folder (relative to the prefix, `''` for the
 * root), and emits one entry per `.skel` / skeleton-`.json` — matching the script's
 * `scan()`: same-stem `.atlas` (else first atlas in the folder), version from the
 * skeleton head + atlas `pma`, sorted by `name` (case-insensitive), `id` by index.
 *
 * `prefix` is the slug-normalized `<client>/<project>/spines` string written into
 * the index (the script's PREFIX) — the SAME value the viewer compares against.
 */
export async function buildSkeletonsIndex(
	spinesPrefix: string,
	prefix: string,
): Promise<SkeletonsIndex> {
	const root = `${spinesPrefix}/`;
	const allKeys = await listAllKeys(root);

	// Relative POSIX paths under the prefix, asset extensions only, skipping the
	// index itself and any folder placeholders.
	const relFiles = allKeys
		.filter((k) => k.startsWith(root))
		.map((k) => k.slice(root.length))
		.filter((rel) => rel && rel !== 'skeletons.json' && !rel.endsWith('/'))
		.filter((rel) => SPINE_ASSET_EXT.has(spineExt(rel)));

	// Group filenames by their folder (relative dir, `''` for the prefix root).
	const byDir = new Map<string, string[]>();
	for (const rel of relFiles) {
		const slash = rel.lastIndexOf('/');
		const dir = slash === -1 ? '' : rel.slice(0, slash);
		const name = slash === -1 ? rel : rel.slice(slash + 1);
		if (!byDir.has(dir)) byDir.set(dir, []);
		byDir.get(dir)!.push(name);
	}

	const entries: Omit<SkeletonIndexEntry, 'id'>[] = [];
	for (const [dir, names] of byDir) {
		const atlases = names.filter((n) => n.toLowerCase().endsWith('.atlas'));
		if (!atlases.length) continue;
		const skels = names.filter((n) => n.toLowerCase().endsWith('.skel'));

		const dirKey = dir ? `${root}${dir}/` : root;
		const jsons: string[] = [];
		// `.json` AND `.irig` are JSON skeletons (the Rigger writes `.irig`).
		for (const n of names.filter((n) => {
			const low = n.toLowerCase();
			return low.endsWith('.json') || low.endsWith('.irig');
		})) {
			const obj = await getObjectBytes(`${dirKey}${n}`);
			if (!obj) continue;
			const head = new TextDecoder().decode(obj.body.subarray(0, 512));
			if (isSkeletonJson(head)) jsons.push(n);
		}

		for (const sk of [...skels, ...jsons]) {
			const stem = stemOf(sk);
			const atlas = atlases.find((a) => stemOf(a) === stem) ?? atlases[0];

			const skObj = await getObjectBytes(`${dirKey}${sk}`);
			const head = skObj ? new TextDecoder('latin1').decode(skObj.body.subarray(0, 512)) : '';
			const version = detectVersion(sk, head);
			const atlasText = (await getObjectText(`${dirKey}${atlas}`)) ?? '';

			entries.push({
				// Matches the script's `${folder}/${stem}` (folder is the relative dir,
				// `''` for the prefix root → a leading-slash name, as the script produces).
				name: `${dir}/${stem}`,
				folder: dir,
				skeleton_file: sk,
				atlas_file: atlas,
				format: sk.toLowerCase().endsWith('.skel') ? 'skel' : 'json',
				version,
				runtime: runtimeLine(version),
				pma: atlasPma(atlasText),
				dir_b64: b64url(dir),
			});
		}
	}

	entries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
	const skeletons: SkeletonIndexEntry[] = entries.map((e, id) => ({ ...e, id }));
	return { prefix, skeletons };
}
