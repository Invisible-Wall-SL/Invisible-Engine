/**
 * Frame to rig, the cut's launcher half (docs/design/frame-to-rig.md §5, phase F1).
 *
 * The Rigger names a Flipbook clip, a frame of it and the joints it tracked there; this resolves
 * the frame to the sheet page and region the clip draws it from, on the clip's canvas (every
 * frame at its untrimmed size, as `rigger-motion`'s `clipFrames` draws it, so the track's
 * normalised points land on the same pixels), and the template to the slots the cut reads. The
 * cut itself is atlas-tool's (`rig_from_frame.py`), which writes the job's files under
 * `<client>/<project>/rig-from-frame/<job>/` — authoring scratch, never baked (rule 8).
 */
import { clipFrameRefs, type FlipbookClip } from 'engine-flipbook';
import sharp from 'sharp';
import { loadRegionSet, type EditorRegion, type EditorRegionSet } from './editorRegions';
import { isProjectArtAllowed } from './projectArtScope';
import { projectPrefix } from './projectPaths';
import { rigTemplateForNewRig } from './rigTemplateStore';

/** The parts the cut makes and needs: a template without them is not one it can cut for. */
export const CUT_REQUIRED_PARTS = [
	'torso',
	'head',
	'upper_arm_l',
	'lower_arm_l',
	'upper_arm_r',
	'lower_arm_r',
] as const;
export const JOB_ID = /^[a-z0-9][a-z0-9-]{5,63}$/;
export const BACKGROUND = 255;
const MAX_SIDE = 4096;

export interface CutFrame {
	pageKey: string;
	region: Pick<EditorRegion, 'x' | 'y' | 'w' | 'h' | 'rotated' | 'offX' | 'offY'>;
	canvas: [number, number];
}

export type Resolved<T> = { ok: true; value: T } | { ok: false; status: number; message: string };

/** The clip's frame `index` as the cut reads it, or why it cannot be read. */
export async function resolveClipFrame(
	clip: Pick<FlipbookClip, 'assetKey' | 'frames'>,
	index: number,
	scope: { prefixes: string[]; clientKey: string; projectKey: string },
): Promise<Resolved<CutFrame>> {
	const refs = clipFrameRefs(clip);
	if (!Number.isInteger(index) || index < 0 || index >= refs.length)
		return { ok: false, status: 400, message: 'That frame is not in the clip.' };
	const sets = new Map<string, Promise<EditorRegionSet>>();
	const set = (key: string) => {
		let p = sets.get(key);
		if (!p) sets.set(key, (p = loadRegionSet(key)));
		return p;
	};
	let fullW = 0;
	let fullH = 0;
	let chosen: { region: EditorRegion; pageKey: string } | null = null;
	for (const [i, ref] of refs.entries()) {
		const s = await set(ref.assetKey);
		const region = s.regions.find((r) => r.name === ref.region);
		if (!region)
			return {
				ok: false,
				status: 422,
				message: `The clip's frame "${ref.region}" is not in its sheet.`,
			};
		fullW = Math.max(fullW, region.origW ?? region.w);
		fullH = Math.max(fullH, region.origH ?? region.h);
		if (i === index) chosen = { region, pageKey: s.pageKey };
	}
	if (!chosen?.pageKey)
		return { ok: false, status: 422, message: "The frame's sheet has no page image." };
	if (
		!(await isProjectArtAllowed(chosen.pageKey, scope.prefixes, scope.clientKey, scope.projectKey))
	)
		return { ok: false, status: 403, message: "The frame's sheet is not in this project." };
	// The cut writes under this project and reads only its art: a frame drawn from a shared sheet
	// is cut from its own project's copy once it has one.
	if (!chosen.pageKey.startsWith(`${projectPrefix(scope.clientKey, scope.projectKey)}/`))
		return {
			ok: false,
			status: 422,
			message:
				'The frame comes from a sheet shared from another project; cut a clip of this project.',
		};
	if (fullW > MAX_SIDE || fullH > MAX_SIDE)
		return { ok: false, status: 422, message: `The clip's frames are larger than ${MAX_SIDE} px.` };
	const { x, y, w, h, rotated, offX, offY } = chosen.region;
	return {
		ok: true,
		value: {
			pageKey: chosen.pageKey,
			region: { x, y, w, h, rotated, offX, offY },
			canvas: [fullW, fullH],
		},
	};
}

/** The project sheet a rig made from a frame takes its images from (design §5). */
export function partsSheetName(rigName: string): string {
	return `${rigName}_parts`;
}

/** Where a frame's pixels are: its page and region. */
export function frameKey(pageKey: string, r: Pick<EditorRegion, 'x' | 'y' | 'w' | 'h'>): string {
	return `${pageKey}|${r.x}|${r.y}|${r.w}|${r.h}`;
}

/** Each frame of the clip by where its pixels are ({@link frameKey}), so a cut made before cuts
 * named their clip is still found by the frame it was cut from. */
export async function clipFrameKeys(
	clip: Pick<FlipbookClip, 'assetKey' | 'frames'>,
): Promise<Map<string, number>> {
	const sets = new Map<string, Promise<EditorRegionSet>>();
	const out = new Map<string, number>();
	for (const [i, ref] of clipFrameRefs(clip).entries()) {
		let p = sets.get(ref.assetKey);
		if (!p) sets.set(ref.assetKey, (p = loadRegionSet(ref.assetKey)));
		const s = await p;
		const r = s.regions.find((x) => x.name === ref.region);
		if (r && s.pageKey && !out.has(frameKey(s.pageKey, r))) out.set(frameKey(s.pageKey, r), i);
	}
	return out;
}

/** The fields of a stored `cut.json` the launcher reads. */
export interface StoredCut {
	job: string;
	template: string;
	size: [number, number];
	names: string[];
	parts: { name: string; px: number }[];
	props: {
		name: string;
		bone: string;
		before?: string;
		after?: string;
		host: string;
		take?: boolean;
		motion?: string;
	}[];
	source?: { pageKey: string; region: Pick<EditorRegion, 'x' | 'y' | 'w' | 'h'> };
	clip?: { id: string; frame: number };
	edited?: string;
}

/** The frame of clip `clipId` a stored cut was made from, or null when it is another clip's: the
 * clip it names, or (a cut from before cuts named it) the frame whose pixels it was cut from. */
export function cutFrameOf(
	cut: StoredCut,
	clipId: string,
	keys: Map<string, number>,
): number | null {
	if (cut.clip) return cut.clip.id === clipId ? cut.clip.frame : null;
	const src = cut.source;
	return src?.region ? (keys.get(frameKey(src.pageKey, src.region)) ?? null) : null;
}

/** The template's slot names in draw order, if it has the parts the cut makes. */
export async function cutTemplateSlots(
	templateId: string,
): Promise<Resolved<{ id: string; slots: string[] }>> {
	const t = await rigTemplateForNewRig(templateId);
	if (!t) return { ok: false, status: 404, message: 'That template is gone.' };
	const slots = t.slots.map((s) => s.name);
	const missing = CUT_REQUIRED_PARTS.filter((p) => !slots.includes(p));
	if (missing.length)
		return {
			ok: false,
			status: 422,
			message: `A frame is cut into Half body parts; ${t.label} has no ${missing.join(', ')}.`,
		};
	return { ok: true, value: { id: t.id, slots } };
}

export function newJobId(): string {
	const rand = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) =>
		b.toString(16).padStart(2, '0'),
	).join('');
	return `f2r-${Date.now().toString(36)}-${rand}`;
}

export function jobRoot(clientKey: string, projectKey: string, job: string): string {
	return `${projectPrefix(clientKey, projectKey)}/rig-from-frame/${job}`;
}

/** A cut's 8-bit label map (`labels.png`) as raw indices, row by row, and its width. */
export async function rawLabels(png: Uint8Array): Promise<{ data: Uint8Array; width: number }> {
	const { data, info } = await sharp(png)
		.extractChannel(0)
		.raw()
		.toBuffer({ resolveWithObject: true });
	return { data: new Uint8Array(data), width: info.width };
}

/**
 * The author's brushed label map, checked against the cut's: the same size, every value a part
 * or prop of the cut, and the character's outline unchanged (the brush moves a patch between
 * parts, never in or out of the character). Read from the red channel of the page's PNG; answered
 * as the 8-bit grey PNG the cut writes.
 */
export async function checkedLabels(
	png: Uint8Array,
	before: Uint8Array,
	names: number,
): Promise<Resolved<Uint8Array>> {
	const decode = async () => ({
		mine: await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
		theirs: await sharp(before).extractChannel(0).raw().toBuffer({ resolveWithObject: true }),
	});
	let decoded: Awaited<ReturnType<typeof decode>>;
	try {
		decoded = await decode();
	} catch {
		return { ok: false, status: 400, message: 'The label map is not a readable PNG.' };
	}
	const { mine, theirs } = decoded;
	const { width, height } = theirs.info;
	if (mine.info.width !== width || mine.info.height !== height)
		return { ok: false, status: 400, message: "The label map is not the frame's size." };
	const out = new Uint8Array(width * height);
	const step = mine.info.channels;
	for (let i = 0; i < out.length; i++) {
		const v = mine.data[i * step];
		if ((v === BACKGROUND) !== (theirs.data[i] === BACKGROUND))
			return {
				ok: false,
				status: 400,
				message: 'The brush may move a patch between parts, not the outline.',
			};
		if (v !== BACKGROUND && v >= names)
			return { ok: false, status: 400, message: 'The label map names a part the cut has not.' };
		out[i] = v;
	}
	// sharp writes one raw channel as RGB unless told the colourspace; the cut reads 8-bit grey.
	const encoded = await sharp(Buffer.from(out), { raw: { width, height, channels: 1 } })
		.toColourspace('b-w')
		.png({ compressionLevel: 9 })
		.toBuffer();
	return { ok: true, value: new Uint8Array(encoded) };
}
