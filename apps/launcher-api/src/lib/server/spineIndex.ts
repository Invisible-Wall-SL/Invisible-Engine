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
 * Does the folder (given its file names + full dir key) contain a Spine skeleton — a
 * `.skel`/`.irig` (both are ALWAYS skeletons) or a `.json` whose head is a skeleton? Used
 * to tell an atlas-LESS folder that still backs a rig (must NOT be dropped) from one that
 * only holds support files (safe to skip). Reads `.json` heads only when there is no
 * `.skel`/`.irig` to short-circuit on, and only for atlas-less folders — so healthy folders
 * pay nothing extra.
 */
async function folderHasSkeleton(dirKey: string, names: string[]): Promise<boolean> {
	for (const n of names) {
		const low = n.toLowerCase();
		if (low.endsWith('.skel') || low.endsWith('.irig')) return true;
	}
	for (const n of names) {
		if (!n.toLowerCase().endsWith('.json')) continue;
		const obj = await getObjectBytes(`${dirKey}${n}`);
		if (!obj) continue;
		const head = new TextDecoder().decode(obj.body.subarray(0, 512));
		if (isSkeletonJson(head)) return true;
	}
	return false;
}

export interface SkeletonScanResult {
	index: SkeletonsIndex;
	/**
	 * Folders that contain a skeleton but NO co-located `.atlas` — EXACTLY the folders the
	 * index build excludes (a skeleton with no atlas can't be described, so it is dropped).
	 * Surfaced so a reindex can re-derive the atlas (from `source.json`) or preserve the
	 * folder's prior `skeletons.json` entry rather than silently un-shipping a working rig
	 * ([[gotcha_manifest_region_no_geometry_dropped]] is the same class of silent drop).
	 */
	atlasMissingFolders: string[];
}

/**
 * The scan half of {@link buildSkeletonsIndex}: the identical index PLUS the list of
 * skeleton-bearing folders excluded for want of an atlas. `buildSkeletonsIndex` is
 * `(await scanSkeletonsIndex(...)).index`, so its serialized output is byte-unchanged.
 *
 * Lists every object under `${spinesPrefix}/`, groups by folder (relative to the prefix,
 * `''` for the root), and emits one entry per `.skel` / skeleton-`.json` — matching the
 * script's `scan()`: same-stem `.atlas` (else first atlas in the folder), version from the
 * skeleton head + atlas `pma`, sorted by `name` (case-insensitive), `id` by index.
 *
 * `prefix` is the slug-normalized `<client>/<project>/spines` string written into the
 * index (the script's PREFIX) — the SAME value the viewer compares against.
 */
export async function scanSkeletonsIndex(
	spinesPrefix: string,
	prefix: string,
): Promise<SkeletonScanResult> {
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
	const atlasMissingFolders: string[] = [];
	for (const [dir, names] of byDir) {
		const dirKey = dir ? `${root}${dir}/` : root;
		const atlases = names.filter((n) => n.toLowerCase().endsWith('.atlas'));
		if (!atlases.length) {
			// A skeleton with no atlas would be silently dropped — flag it so the caller can
			// re-derive the atlas or keep the prior entry rather than un-ship the rig.
			if (await folderHasSkeleton(dirKey, names)) atlasMissingFolders.push(dir);
			continue;
		}
		const skels = names.filter((n) => n.toLowerCase().endsWith('.skel'));

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
	return { index: { prefix, skeletons }, atlasMissingFolders };
}

/**
 * Build the `skeletons.json` index for a spines prefix in R2 — see {@link scanSkeletonsIndex}
 * for the shape/parity contract. Kept as a thin wrapper so existing callers are unchanged.
 */
export async function buildSkeletonsIndex(
	spinesPrefix: string,
	prefix: string,
): Promise<SkeletonsIndex> {
	return (await scanSkeletonsIndex(spinesPrefix, prefix)).index;
}

export interface ReindexOutcome {
	/** The index to WRITE to `skeletons.json` (fresh entries + any preserved-from-prior). */
	index: SkeletonsIndex;
	/** Folders whose missing `.atlas` was re-derived from `source.json` this call. */
	rederivedFolders: string[];
	/** Still-atlas-less folders whose prior `skeletons.json` entry was carried forward. */
	preservedFolders: string[];
	/**
	 * Every folder STILL skeleton-bearing-but-atlas-less after the re-derive attempt (no
	 * atlas AND no source to rebuild one). A caller MUST fail LOUDLY when the folder it just
	 * wrote is in this set, so a broken rig is surfaced now, not discovered blank later.
	 */
	atlasMissingFolders: string[];
}

/**
 * Injected side effects for {@link reindexSkeletonsPreserving} so the merge/preserve policy
 * is PURE and unit-testable without R2. The endpoint supplies R2-backed implementations.
 */
export interface ReindexDeps {
	/** (Re)scan the spines prefix into an index + the atlas-missing skeleton folders. */
	scan(): Promise<SkeletonScanResult>;
	/** The `skeletons.json` currently in R2 (the entries to preserve from). `null` when absent. */
	readPriorIndex(): Promise<SkeletonsIndex | null>;
	/**
	 * Try to re-derive `folder`'s `.atlas` from its remembered source (`source.json`);
	 * resolves `true` when an atlas now exists in the folder. `atlasFile` is the filename to
	 * (re)write — the prior entry's `atlas_file` when known, else `<folder>.atlas`.
	 */
	rederiveAtlas(folder: string, atlasFile: string): Promise<boolean>;
}

/**
 * Fold the prior index's entries for still-dropped folders back into a freshly-built index,
 * so a skeleton-bearing folder that lost its atlas is NEVER silently removed. A no-op —
 * returns `freshIndex` UNCHANGED (identity) — when nothing needs preserving, so a healthy
 * reindex stays byte-identical to {@link buildSkeletonsIndex}.
 */
export function mergePreservingDroppedFolders(
	freshIndex: SkeletonsIndex,
	priorIndex: SkeletonsIndex | null,
	atlasMissingFolders: string[],
): { index: SkeletonsIndex; preservedFolders: string[] } {
	const preservedFolders: string[] = [];
	const preserved: Omit<SkeletonIndexEntry, 'id'>[] = [];
	if (priorIndex) {
		for (const folder of atlasMissingFolders) {
			const prev = priorIndex.skeletons.filter((s) => s.folder === folder);
			if (!prev.length) continue;
			for (const { id: _id, ...rest } of prev) preserved.push(rest);
			preservedFolders.push(folder);
		}
	}
	if (!preserved.length) return { index: freshIndex, preservedFolders };

	// Re-merge on the SAME key + sort + contiguous-id rule the scan uses, so the combined
	// index is indistinguishable from one the scan would have produced with the atlases present.
	const combined = [
		...freshIndex.skeletons.map(({ id: _id, ...rest }) => rest),
		...preserved,
	];
	combined.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
	const skeletons = combined.map((e, id) => ({ ...e, id }));
	return { index: { prefix: freshIndex.prefix, skeletons }, preservedFolders };
}

/**
 * Rebuild `skeletons.json` for a spines prefix so a reindex can NEVER silently un-ship a rig:
 *
 *  1. Scan. If no skeleton folder is missing an atlas → return the plain index (byte-parity).
 *  2. Layer 1 — for each atlas-less skeleton folder, re-derive its `.atlas` from `source.json`
 *     (the same path `⟳ Re-sync atlas` uses), then re-scan.
 *  3. Layer 2 — any folder STILL atlas-less (no source to rebuild from) keeps its prior index
 *     entry (preserve, never drop) and is reported in `atlasMissingFolders` so the caller can
 *     fail loudly for the folder it just saved. Saving rig A can never drop atlas-less rig B.
 */
export async function reindexSkeletonsPreserving(deps: ReindexDeps): Promise<ReindexOutcome> {
	const first = await deps.scan();
	if (!first.atlasMissingFolders.length) {
		return { index: first.index, rederivedFolders: [], preservedFolders: [], atlasMissingFolders: [] };
	}

	const prior = await deps.readPriorIndex();
	const atlasFileFor = (folder: string): string => {
		const prev = prior?.skeletons.find((s) => s.folder === folder && s.atlas_file);
		if (prev?.atlas_file) return prev.atlas_file;
		const stem = folder ? (folder.split('/').pop() ?? folder) : 'skeleton';
		return `${stem}.atlas`;
	};

	const rederivedFolders: string[] = [];
	for (const folder of first.atlasMissingFolders) {
		if (await deps.rederiveAtlas(folder, atlasFileFor(folder))) rederivedFolders.push(folder);
	}

	const rebuilt = rederivedFolders.length ? await deps.scan() : first;
	const stillMissing = rebuilt.atlasMissingFolders;
	if (!stillMissing.length) {
		return { index: rebuilt.index, rederivedFolders, preservedFolders: [], atlasMissingFolders: [] };
	}

	const { index, preservedFolders } = mergePreservingDroppedFolders(rebuilt.index, prior, stillMissing);
	console.warn(
		`[rigger] reindex: skeleton folder(s) with no atlas and no source to rebuild — ` +
			`preserved prior entries for [${preservedFolders.join(', ')}]; ` +
			`still atlas-missing [${stillMissing.join(', ')}]`,
	);
	return { index, rederivedFolders, preservedFolders, atlasMissingFolders: stillMissing };
}
