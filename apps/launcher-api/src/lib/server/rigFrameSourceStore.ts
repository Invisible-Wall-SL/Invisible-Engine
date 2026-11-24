/**
 * The R2 half of a frame-made rig's source (docs/design/frame-to-rig.md §12 F2j): the sheets its
 * parts are drawn from, the cut it names and switching the bundle's art when an update is saved.
 *
 * A rig made by 🦴 Create rig draws from the sheet `<rig>_parts`, and its bundle re-syncs from that
 * sheet on every read (`ensureBundleAtlasFresh`): writing new art there would change the rig every
 * game ships before the author saved the update. So 🔄 Update rig writes the rig's OTHER sheet
 * (`<rig>_parts` and `<rig>_parts_b` take turns), and the save that stores the updated `.irig` points
 * the bundle at it. The sheet the bundle draws from is never written by an update.
 */
import { json } from '@sveltejs/kit';
import sharp from 'sharp';
import { FRAME_SOURCE_SIDECAR, frameSourceProblems, type FrameSourceDoc } from '../rigFrameSource';
import { loadRegionSet, type EditorRegionSet } from './editorRegions';
import { SUB } from './projectPaths';
import {
	getObjectBytes,
	getObjectText,
	getObjectTextWithEtag,
	headObject,
	listAllKeys,
} from './r2';
import { bundleRevision, ensureBundleAtlasFresh } from './rigBundleSync';
import { jobRoot, partsSheetName } from './rigFrameKeys';
import type { StoredCut } from './rigFromFrame';
import type { AlphaImage } from './rigFrameUpdate';
import { sidecarOwner, type IrigTarget, type SidecarPlan } from './riggerIrigWrite';

/** The two sheets a frame-made rig's parts are drawn from, in turn. */
export const rigPartsSheets = (stem: string): [string, string] => [
	partsSheetName(stem),
	`${partsSheetName(stem)}_b`,
];

export const sheetManifestKey = (clientKey: string, projectKey: string, sheet: string): string =>
	`${SUB.manifests(clientKey, projectKey)}/atlas_manifest_${sheet}.json`;

export const bundlePrefixOf = (t: Pick<IrigTarget, 'dir' | 'rigsPrefix'>): string =>
	t.dir ? `${t.rigsPrefix}/${t.dir}` : t.rigsPrefix;

/**
 * The rig folders of the project, other than `except`, whose bundle is drawn from the sheet
 * `manifestKey` (their `source.json` names it: picked with ⟳ source…): an update must not write it.
 */
export async function rigsDrawnFrom(
	clientKey: string,
	projectKey: string,
	manifestKey: string,
	except: string,
): Promise<string[]> {
	const spines = SUB.spines(clientKey, projectKey);
	const folders = (await listAllKeys(`${spines}/`))
		.filter((k) => k.endsWith('/source.json'))
		.map((k) => k.slice(0, -'/source.json'.length))
		.filter((f) => f !== except);
	const drawn = await Promise.all(
		folders.map(async (f) => ((await liveArtKey(f)) === manifestKey ? f : null)),
	);
	return drawn.filter((f): f is string => f !== null).map((f) => f.slice(spines.length + 1) || '/');
}

/** The sheet the bundle's art is synced from (its `source.json`), or '' when it names none. */
export async function liveArtKey(bundlePrefix: string): Promise<string> {
	const text = await getObjectText(`${bundlePrefix}/source.json`);
	if (!text) return '';
	try {
		const key = (JSON.parse(text) as { manifestKey?: unknown }).manifestKey;
		return typeof key === 'string' ? key : '';
	} catch {
		return '';
	}
}

/** The rig's sheet an update writes: the one its bundle is not drawn from. */
export function updateSheet(
	clientKey: string,
	projectKey: string,
	stem: string,
	live: string,
): string {
	const [a, b] = rigPartsSheets(stem);
	return sheetManifestKey(clientKey, projectKey, a) === live ? b : a;
}

/** A kept cut and its ETag, or null when it is gone. */
export async function readCut(
	clientKey: string,
	projectKey: string,
	job: string,
): Promise<{ cut: StoredCut; etag: string | null } | null> {
	const got = await getObjectTextWithEtag(`${jobRoot(clientKey, projectKey, job)}/cut.json`);
	if (!got) return null;
	try {
		return { cut: JSON.parse(got.text) as StoredCut, etag: got.etag };
	} catch {
		return null;
	}
}

/** The frame each part taken from another kept cut comes from (null when that cut names none). */
export async function cutFrames(
	clientKey: string,
	projectKey: string,
	cut: Pick<StoredCut, 'sources'>,
): Promise<Record<string, number | null>> {
	const out: Record<string, number | null> = {};
	for (const [part, job] of Object.entries(cut.sources ?? {}))
		out[part] = (await readCut(clientKey, projectKey, job))?.cut.clip?.frame ?? null;
	return out;
}

/** A sheet's revision as a bundle records it, or '' when it has no regions or page. */
export async function artRevision(manifestKey: string): Promise<string> {
	const rs = await loadRegionSet(manifestKey);
	return rs.regions.length && rs.pageKey ? bundleRevision(rs) : '';
}

/** Each named region's alpha on its untrimmed canvas; a rotated one is left out. */
export async function regionAlphas(
	rs: EditorRegionSet,
	names: readonly string[],
): Promise<Map<string, AlphaImage>> {
	const out = new Map<string, AlphaImage>();
	const want = rs.regions.filter((r) => names.includes(r.name) && !r.rotated);
	if (!want.length || !rs.pageKey) return out;
	const page = await getObjectBytes(rs.pageKey);
	if (!page) return out;
	for (const r of want) {
		const { data, info } = await sharp(page.body)
			.extract({ left: r.x, top: r.y, width: r.w, height: r.h })
			.ensureAlpha()
			.extractChannel(3)
			.raw()
			.toBuffer({ resolveWithObject: true });
		const [w, h] = [r.origW ?? r.w, r.origH ?? r.h];
		const canvas = new Uint8Array(w * h);
		const [ox, oy] = [r.offX ?? 0, r.offY ?? 0];
		for (let y = 0; y < info.height; y++)
			for (let x = 0; x < info.width; x++) {
				const [cx, cy] = [x + ox, y + oy];
				if (cx < w && cy < h) canvas[cy * w + cx] = data[y * info.width + x];
			}
		out.set(r.name, { data: canvas, w, h });
	}
	return out;
}

/** The rig's own frame source as stored, its ETag, and why it cannot be used when it cannot. */
export async function storedFrameSource(target: IrigTarget): Promise<{
	read: { text: string; etag: string | null } | null;
	doc: FrameSourceDoc | null;
	problems: string[];
}> {
	const read = await getObjectTextWithEtag(target.sidecarKeys.frame);
	if (!read) return { read, doc: null, problems: [] };
	let value: unknown;
	try {
		value = JSON.parse(read.text);
	} catch {
		return { read, doc: null, problems: [`${FRAME_SOURCE_SIDECAR} is not valid JSON`] };
	}
	const problems = frameSourceProblems(value);
	return { read, doc: problems.length ? null : (value as FrameSourceDoc), problems };
}

/** The `.atlas` the bundle draws with: `<stem>.atlas`, else the folder's one atlas. */
export async function bundleAtlasFile(bundlePrefix: string, stem: string): Promise<string | null> {
	if (await headObject(`${bundlePrefix}/${stem}.atlas`)) return `${stem}.atlas`;
	const atlases = (await listAllKeys(`${bundlePrefix}/`))
		.map((k) => k.slice(bundlePrefix.length + 1))
		.filter((n) => !n.includes('/') && n.toLowerCase().endsWith('.atlas'));
	return atlases.length === 1 ? atlases[0] : null;
}

/**
 * Why the bundle cannot be drawn from the art `doc` names, or null when it can (or already is):
 * the sheet must be one of the rig's two and still the one its parts were made on — a later update
 * that wrote it again leaves meshes made for other art.
 */
export async function frameArtProblem(
	clientKey: string,
	projectKey: string,
	target: IrigTarget,
	doc: FrameSourceDoc,
): Promise<string | null> {
	if (doc.art !== (await liveArtKey(bundlePrefixOf(target)))) {
		const own = rigPartsSheets(target.stem).map((s) => sheetManifestKey(clientKey, projectKey, s));
		if (!own.includes(doc.art))
			return `its parts are drawn from a sheet that is not this rig's (${doc.art})`;
	}
	// Checked when the bundle is already drawn from it too: an undo across two updates names a sheet
	// the second one made again.
	if ((await artRevision(doc.art)) !== doc.artRevision)
		return 'the sheet its parts were made on has been made again since (another 🔄 Update rig, or the sheet edited): run 🔄 Update rig again';
	return null;
}

export type FramePlan =
	{ ok: true; plan?: SidecarPlan; doc: FrameSourceDoc | null } | { ok: false; response: Response };

const unchanged = 'The stored rig is unchanged.';
const refuse = (status: number, error: string, message: string, extra = {}): FramePlan => ({
	ok: false,
	response: json({ ok: false, error, ...extra, message }, { status }),
});

/**
 * What a save does to the rig's `frame-source.json`: `sent` is a client's whole sidecar (an update
 * made in the page, or a link) and the ETag it read it at (undefined with force); without it the
 * stored one is kept (`writeIrig` re-marks it). A sent one must be the rig's, current, well formed,
 * and drawn from art the bundle can take (`frameArtProblem`).
 */
export async function framePlan(
	clientKey: string,
	projectKey: string,
	target: IrigTarget,
	irigEtag: string | null,
	sent?: { doc: unknown; baseEtag: string | null | undefined },
): Promise<FramePlan> {
	if (!sent) return { ok: true, doc: null };
	const { read } = await storedFrameSource(target);
	const owner = read ? sidecarOwner(read.text) : undefined;
	if (read && owner !== undefined && owner !== target.stem)
		return refuse(
			409,
			'frame-other-rig',
			`Not saved — the frame source in this folder belongs to rig "${owner}", not "${target.stem}". ${unchanged}`,
		);
	if (sent.baseEtag !== undefined && (read ? read.etag : null) !== sent.baseEtag)
		return refuse(
			409,
			'conflict',
			`Someone else updated the cut of "${target.stem}" while you were editing. Your changes are still here — reload to get their version first.`,
			{ etag: irigEtag, frameEtag: read?.etag ?? null },
		);
	const doc = isRecord(sent.doc) ? { ...sent.doc, rig: target.stem } : sent.doc;
	const problems = frameSourceProblems(doc);
	if (problems.length)
		return refuse(
			422,
			'frame-invalid',
			`Not saved — the rig's frame source is malformed: ${problems.slice(0, 6).join('; ')}. ${unchanged}`,
			{ problems },
		);
	const source = doc as FrameSourceDoc;
	const art = await frameArtProblem(clientKey, projectKey, target, source);
	if (art) return refuse(409, 'frame-art', `Not saved — ${art}. ${unchanged}`);
	return { ok: true, plan: { read, ours: true, next: JSON.stringify(source) }, doc: source };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** Point the bundle at the art `doc` names, once its `.irig` is stored. False when it could not. */
export async function switchFrameArt(
	clientKey: string,
	projectKey: string,
	target: IrigTarget,
	doc: FrameSourceDoc,
): Promise<boolean> {
	// Its `.irig` is stored by now: a failure here is reported (`artSwitched: false`), never thrown, or
	// the tab would keep the old ETags and refuse its own next save.
	try {
		const bundle = bundlePrefixOf(target);
		if (doc.art === (await liveArtKey(bundle))) return true;
		// Again, as late as can be: another update may have written that sheet since the save checked it.
		if ((await artRevision(doc.art)) !== doc.artRevision) return false;
		const atlas = await bundleAtlasFile(bundle, target.stem);
		if (!atlas) return false;
		const synced = await ensureBundleAtlasFresh(clientKey, projectKey, bundle, atlas, {
			force: true,
			manifestKey: doc.art,
		});
		return synced !== null;
	} catch (e) {
		console.error(`[rigger] ${target.stem}: its art could not be switched to ${doc.art}:`, e);
		return false;
	}
}
