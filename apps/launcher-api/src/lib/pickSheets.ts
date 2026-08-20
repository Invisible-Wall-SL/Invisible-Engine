/**
 * Which key an atlas-scoped frame ref is SCOPED BY — the rule shared by everything that writes one.
 *
 * A scoped pick is stored as `<key>::<region>`, and the editor-art export registers a sheet's
 * textures under its MANIFEST key. So the key has to be the manifest, and getting it wrong is
 * INVISIBLE: the ref simply names a namespace nothing ever registers, the sprite resolves no
 * texture, and the art is absent in-game with only a console line to say so.
 *
 * Four surfaces write scoped refs (`/editor`, `/components`, `/symbols`, `/config`) and two more
 * resolve them (`resolveManifestKey`'s ship-path repair, `listSheets`' asset listing). They all
 * come here, because a disagreement between any two of them IS the bug.
 *
 * Dependency-free on purpose — `node apps/launcher-api/pickSheets.fixture.ts` runs it directly.
 */

/** One entry the region picker lists: the atlas a frame belongs to, by the key a pick is scoped by. */
export type PickSheet = { key: string; name: string };

type AtlasLike = { key: string; name: string; kind: string };
type SheetLike = { key: string; name: string; manifestKey?: string };

function basename(key: string): string {
	const i = key.lastIndexOf('/');
	return i === -1 ? key : key.slice(i + 1);
}

/**
 * Which of a sheet folder's JSONs IS its manifest: prefer the Sheet Maker AI manifest, else the
 * first JSON in the folder (R2 lists lexicographically, so "first" is stable).
 */
export function pickManifestKey(jsonKeys: string[]): string | null {
	const am = jsonKeys.find((k) => basename(k).startsWith('atlas_manifest_'));
	return am ?? jsonKeys[0] ?? null;
}

/**
 * `<sheet folder> → its manifest key`, derived from ONE recursive listing of the sheets root.
 *
 * The alternative — a `resolveManifestKey` round trip per sheet — runs on ordinary page loads, and
 * N sequential R2 listings is the sort of cost that quietly makes a tool slow to open.
 *
 * Only files DIRECTLY in a sheet folder count. That is not a shortcut: `resolveManifestKey` lists
 * with a `/` delimiter and therefore cannot see a nested JSON, so counting one here would let the
 * picker name a manifest the repair pass would never resolve to.
 */
export function manifestKeyByFolder(root: string, allKeys: string[]): Map<string, string> {
	const jsons = new Map<string, string[]>();
	for (const key of allKeys) {
		if (!key.toLowerCase().endsWith('.json')) continue;
		const slash = key.indexOf('/', root.length);
		if (slash === -1) continue;
		const folder = key.slice(0, slash + 1);
		if (key.slice(folder.length).includes('/')) continue;
		const list = jsons.get(folder);
		if (list) list.push(key);
		else jsons.set(folder, [key]);
	}
	const out = new Map<string, string>();
	for (const [folder, list] of jsons) {
		const manifest = pickManifestKey(list);
		if (manifest) out.set(folder, manifest);
	}
	return out;
}

/**
 * The region picker's source list — atlas MANIFESTS + sheets, in that order.
 *
 * Shared by `/editor`, `/components`, `/symbols` and `/config`, which each derived this by hand and
 * must not drift: they are the only writers of scoped frame refs.
 *
 * A `SheetAsset.key` is the sheet's R2 output PREFIX — that field is the prefix the FTP browser and
 * the sheet tool address it by, so it cannot simply be changed — hence `manifestKey`, resolved once
 * in `listSheets`, is what is preferred here.
 */
export function pickSheetsFrom(assets: { atlases: AtlasLike[]; sheets: SheetLike[] }): PickSheet[] {
	return [
		...assets.atlases
			.filter((a) => a.kind === 'atlas-manifest')
			.map((a) => ({ key: a.key, name: a.name })),
		// A sheet whose manifest could not be resolved is still listed under its prefix:
		// `/api/editor/regions` resolves a prefix fine, so its frames stay pickable, and a ref scoped
		// by it degrades to the bare frame name in `parseScopedFrameRef` rather than vanishing.
		// Dropping the sheet from the picker would be the worse failure.
		...assets.sheets.map((s) => ({ key: s.manifestKey ?? s.key, name: s.name })),
	];
}
