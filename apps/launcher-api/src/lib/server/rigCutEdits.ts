/**
 * Frame to rig, the touch-ups a page keeps with a cut (the prop editor and per-part frames,
 * docs/design/frame-to-rig.md §12 F2d), checked and applied with no I/O: `/api/rigger/from-frame/edits`
 * reads and writes the cut around it.
 */
import type { Resolved, StoredCut } from './rigFromFrame';
import { armTail } from '../rigSlotOrder';
import { controlTarget } from './rigTemplateFit';

export const JOB_ID = /^[a-z0-9][a-z0-9-]{5,63}$/;
/** A prop the author adds is named `prop_` and a short lowercase name. */
export const PROP_NAME = /^prop_[a-z0-9_]{1,40}$/;
export const PROP_MOTIONS = ['rides', 'swings', 'off'] as const;

/** What of a template the edits are checked against: its slots in draw order and its bones. */
export interface CutTemplate {
	slots: { name: string; bone: string }[];
	bones: { name: string; parent?: string }[];
}

/** The edits a page sends with a cut (`/api/rigger/from-frame/edits`), less the label map. */
export interface CutEdits {
	/** The cut's names after the edits: its parts as they are, then its props. */
	names?: unknown;
	props?: unknown;
	/** Per part, the kept cut (job) of another frame it is taken from; null takes it back. */
	sources?: unknown;
}

/**
 * The author's edits to a cut's props and per-part frames, checked against the cut and its
 * template, as a new cut (the one given is left as it is) and the other cuts it now takes parts
 * from (which the caller checks exist). Props: each one's ✓ / ✗, rides / swings / comes off and the
 * bone it hangs from (kept as the author's: `boneSet`); with `names`, props added (named, on the
 * part they are painted over: drawn just in front of it, after the arm's last finger on an arm) and
 * removed (their pixels already given back in the label map, so `relabelled` must be true when a
 * prop's index moves). Sources: a part (not a prop) to the job of another kept cut, or null.
 */
export function applyCutEdits(
	cut: StoredCut,
	edits: CutEdits,
	t: CutTemplate,
	relabelled: boolean,
): Resolved<{ cut: StoredCut; jobs: string[] }> {
	const no = (message: string): Resolved<never> => ({ ok: false, status: 400, message });
	const parts = cut.parts.map((p) => p.name);
	const bones = new Map(t.bones.map((b) => [b.name, b]));
	const slots = t.slots.map((s) => s.name);
	const next: StoredCut = structuredClone(cut);
	let names = cut.names;
	if (edits.names !== undefined) {
		if (!Array.isArray(edits.names) || !edits.names.every((n) => typeof n === 'string'))
			return no("`names` is the list of the cut's parts and props.");
		names = edits.names as string[];
		if (names.length > 250 || parts.some((p, i) => names[i] !== p))
			return no("The cut's parts stay as they are, first and in their order.");
		if (new Set(names).size !== names.length) return no('A prop is named twice.');
		const moved = cut.names.some((n, i) => i >= parts.length && names[i] !== n);
		if (moved && !relabelled) return no('A prop removed or reordered needs its label map.');
	}
	const given = edits.props === undefined ? [] : edits.props;
	if (!Array.isArray(given)) return no('`props` is a list.');
	const props = new Map(next.props.map((p) => [p.name, p]));
	for (const raw of given as Record<string, unknown>[]) {
		const name = raw && typeof raw.name === 'string' ? raw.name : '';
		let p = props.get(name);
		if (!p) {
			if (!PROP_NAME.test(name))
				return no(
					`A new prop is named prop_ and up to 40 lowercase letters, digits or _ (${name}).`,
				);
			if (!names.includes(name)) return no(`The prop ${name} is not in the cut's names.`);
			const host = typeof raw.host === 'string' ? raw.host : '';
			if (!parts.includes(host)) return no(`The prop ${name} is drawn over no part of the cut.`);
			const side = /^(hand|lower_arm)_([lr])$/.exec(host)?.[2];
			const bone = t.slots.find((s) => s.name === host)?.bone ?? host;
			p = {
				name,
				bone,
				after: side ? armTail(slots, side) : host,
				host,
				take: true,
				motion: 'rides',
			};
			props.set(name, p);
		}
		if (raw.take !== undefined) {
			if (typeof raw.take !== 'boolean') return no('A prop is taken (true) or not (false).');
			p.take = raw.take;
		}
		if (raw.motion !== undefined) {
			if (!PROP_MOTIONS.includes(raw.motion as (typeof PROP_MOTIONS)[number]))
				return no('A prop rides, swings or comes off.');
			p.motion = raw.motion as string;
		}
		if (raw.bone !== undefined) {
			const b = typeof raw.bone === 'string' ? bones.get(raw.bone) : undefined;
			if (!b || controlTarget(b.name) || props.has(b.name))
				return no(`The prop ${name} hangs from a bone the template has (not a control).`);
			p.bone = b.name;
			p.boneSet = true;
		}
	}
	const kept = names.slice(parts.length).map((n) => props.get(n));
	if (kept.some((p) => !p)) return no('Each prop in `names` is an existing prop or a new one.');
	next.names = names;
	next.props = kept as StoredCut['props'];
	const jobs: string[] = [];
	if (edits.sources !== undefined) {
		if (!edits.sources || typeof edits.sources !== 'object' || Array.isArray(edits.sources))
			return no('`sources` is { part: job | null }.');
		const sources = { ...(next.sources ?? {}) };
		for (const [part, job] of Object.entries(edits.sources as Record<string, unknown>)) {
			if (!parts.includes(part))
				return no(`The cut has no part ${part} to take from another frame.`);
			if (job === null) delete sources[part];
			else if (typeof job === 'string' && JOB_ID.test(job) && job !== cut.job) {
				sources[part] = job;
				jobs.push(job);
			} else return no(`The part ${part} is taken from another kept cut of the clip.`);
		}
		if (Object.keys(sources).length) next.sources = sources;
		else delete next.sources;
	}
	return { ok: true, value: { cut: next, jobs } };
}

/** Each name's pixel count in a label map (raw indices, 255 the background). */
export function labelCounts(labels: Uint8Array, names: number): number[] {
	const out = new Array<number>(names).fill(0);
	for (const v of labels) if (v < names) out[v]++;
	return out;
}
