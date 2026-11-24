/**
 * Where a rig made by 🦴 Create rig was cut from (docs/design/frame-to-rig.md §12 F2j): the bundle
 * sidecar `frame-source.json`, one of the rig's authoring sidecars (`rigSidecars.ts`), so every
 * `.irig` write carries it and every backup keeps it. ✂ Edit cut opens the cut it names again and
 * 🔄 Update rig rebuilds the parts from it. Pure (no R2, no DOM). No game, export or runtime reads it:
 * engine-rig's `readIrig` is strict, so none of this is in the `.irig`.
 */

export const FRAME_SOURCE_SIDECAR = 'frame-source.json';
export const FRAME_SOURCE_VERSION = 1;

/** A prop as the rig was made with it: its ✓ / ✗, motion and the bone the author picked. */
export interface FrameSourceProp {
	name: string;
	take: boolean;
	motion: string;
	bone?: string;
}

export interface FrameSourceDoc {
	frameSource: typeof FRAME_SOURCE_VERSION;
	/** The rig it belongs to (its `.irig` stem). */
	rig: string;
	template: { id: string; version: number };
	/** The Flipbook clip and its main frame; null for a cut made before cuts named their clip. */
	clip: { id: string; frame: number } | null;
	/** The kept cut of the main frame (`rig-from-frame/<job>/`). */
	job: string;
	/** `cut.json`'s ETag when the rig was made: another means the cut was touched up or re-cut since. */
	cutEtag: string | null;
	/** Per-part frames: each part taken from another kept cut, by its job, and that frame. */
	sources: Record<string, string>;
	frames: Record<string, number | null>;
	props: FrameSourceProp[];
	/**
	 * Each attachment the cut made (every part and taken prop), by name: its slot and a hash of it as
	 * made, bones by name (`attachmentHash`). A rig whose attachment hashes otherwise was edited by hand.
	 */
	parts: Record<string, { slot: string; hash: string }>;
	/** The sheet the parts are drawn from (its manifest key), and its revision when they were made. */
	art: string;
	artRevision: string;
	made: string;
	/** Linked to its cut after it was made (a rig from before this sidecar): its hashes are today's build. */
	linked?: true;
	/** The mark of the `.irig` text it was written with (`riggerIrigWrite.pairMark`). */
	irig?: string;
}

const KEYS = new Set([
	'frameSource',
	'rig',
	'template',
	'clip',
	'job',
	'cutEtag',
	'sources',
	'frames',
	'props',
	'parts',
	'art',
	'artRevision',
	'made',
	'linked',
	'irig',
]);
const JOB = /^[A-Za-z0-9_-]{6,64}$/;
const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Why `value` is no frame source a save may store (empty when it is one). */
export function frameSourceProblems(value: unknown): string[] {
	const at = FRAME_SOURCE_SIDECAR;
	if (!isRecord(value)) return [`${at} is not an object`];
	const out: string[] = [];
	for (const k of Object.keys(value)) if (!KEYS.has(k)) out.push(`${at}.${k} is not a field`);
	if (value.frameSource !== FRAME_SOURCE_VERSION)
		out.push(`${at}.frameSource must be ${FRAME_SOURCE_VERSION}`);
	if (!str(value.rig)) out.push(`${at}.rig must name the rig`);
	const t = value.template;
	if (!isRecord(t) || !str(t.id) || typeof t.version !== 'number')
		out.push(`${at}.template must be { id, version }`);
	const c = value.clip;
	if (c !== null && (!isRecord(c) || !str(c.id) || !Number.isInteger(c.frame)))
		out.push(`${at}.clip must be { id, frame } or null`);
	if (typeof value.job !== 'string' || !JOB.test(value.job)) out.push(`${at}.job is not a job id`);
	if (value.cutEtag !== null && typeof value.cutEtag !== 'string')
		out.push(`${at}.cutEtag must be a string or null`);
	const sources = value.sources;
	if (
		!isRecord(sources) ||
		!Object.values(sources).every((j) => typeof j === 'string' && JOB.test(j))
	)
		out.push(`${at}.sources must map parts to job ids`);
	const frames = value.frames;
	if (!isRecord(frames) || !Object.values(frames).every((f) => f === null || Number.isInteger(f)))
		out.push(`${at}.frames must map parts to frame numbers`);
	const props = value.props;
	if (
		!Array.isArray(props) ||
		!props.every(
			(p) =>
				isRecord(p) &&
				str(p.name) &&
				typeof p.take === 'boolean' &&
				typeof p.motion === 'string' &&
				(p.bone === undefined || str(p.bone)),
		)
	)
		out.push(`${at}.props must be [{ name, take, motion, bone? }]`);
	const parts = value.parts;
	if (
		!isRecord(parts) ||
		!Object.values(parts).every((p) => isRecord(p) && str(p.slot) && str(p.hash))
	)
		out.push(`${at}.parts must map attachments to { slot, hash }`);
	if (!str(value.art)) out.push(`${at}.art must name the sheet`);
	if (typeof value.artRevision !== 'string') out.push(`${at}.artRevision must be a string`);
	if (typeof value.made !== 'string') out.push(`${at}.made must be a date`);
	if (value.linked !== undefined && value.linked !== true) out.push(`${at}.linked must be true`);
	if (value.irig !== undefined && typeof value.irig !== 'string')
		out.push(`${at}.irig must be a string`);
	return out;
}
