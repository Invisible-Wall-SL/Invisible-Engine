import { createHash } from 'node:crypto';
import { json } from '@sveltejs/kit';
import { bake2p5d, rig2p5dProblems, type UnmetRun } from '../rig2p5d';
import {
	RIG3D_EARLIER,
	RIG3D_SIDECAR,
	bakedParts,
	canonicalJson,
	clipOf,
	followersOf,
	partsDiffer,
	rig3dDocProblems,
	rig3dIrigProblems,
	rigOf,
	withBake,
	type ClipPlan,
	type Rig3dClip,
	type Rig3dDoc,
} from '../rig3d';
import { getObjectTextWithEtag, headObject } from './r2';
import { framePlan, switchFrameArt } from './rigFrameSourceStore';
import { controlsPlan, storedControls } from './riggerControls';
import { constraintOrderClashes, gainedOrderClashes, irigDocProblem } from './riggerIrig';
import {
	irigConflict,
	pairMark,
	readSidecar,
	sidecarOwner,
	writeIrig,
	type IrigTarget,
	type IrigWriteResult,
	type SidecarPlans,
} from './riggerIrigWrite';

/**
 * Saving a rig that has 3D data (docs/design/rig-2p5d.md §3, P2). A rig is 3D when its folder holds
 * a `rig3d.json` naming it (`rig`); it holds the 3D keys, and the `.irig` the baked 2D clips games
 * play. Every save of such a rig — the Rigger's, a restore, a Director rebind — comes through here
 * and writes the two together (`writeIrig`): the sidecar first, then the `.irig`, each under its own
 * precondition, the sidecar put back if the `.irig` loses its race.
 *
 * What a save does:
 *  - **Bakes.** Each 3D clip is baked from the sidecar into the `.irig` (its owned bones' timelines,
 *    the draw order, drawing slots' attachment keys, the followers' setup), unless the stored bake
 *    is current: same input (the rig and the clip, hashed) and the `.irig` still holding exactly it.
 *    A baked transition (P7) is a clip like any other here; detaching a clip detaches its transitions.
 *  - **Refuses a 2D edit of a baked part.** The sidecar keeps, per clip, the hash of what the bake
 *    wrote and of the bakes before it. A save whose clip no longer matches any of them changed it in
 *    2D (or deleted the clip), which a bake would silently undo: it is refused (`baked-edited`)
 *    unless the save says per clip what to do, `rebake` (3D wins) or `detach` (the clip becomes a
 *    plain 2D clip and leaves the sidecar) — the choice §3 gives the author. Today's 2D Rigger sends
 *    neither, so its save of a 3D clip it edited is refused with what changed, and its save of
 *    anything else (a 2D clip, a slot colour, an event, a setup the bake re-keys) goes through.
 *  - **Keeps the turnaround.** Once set it is never changed (§11.2).
 *  - **Refuses a torn pair.** A sidecar whose mark (`irig`) is not of the stored `.irig` was written
 *    by a save that has not written, or never wrote, its `.irig`: nothing is saved over it until
 *    that save lands or the pair is restored from the history (`rig3d-torn`).
 *  - **Refuses a new constraint-order clash** — on every save, 3D or not: a constraint the runtime
 *    would never run (`gainedOrderClashes`, `order-clash`). One the stored rig (its `.irig`, else
 *    its source `.json`) already has still saves; the Rigger offers 🩹 Repair for it
 *    (docs/design/rig-controls.md §4.1).
 *  - **Writes the rig's controls with it** (`controls.json`, `riggerControls.ts`): a client's whole
 *    sidecar, checked, or the stored one with the `.irig`'s renames followed and what it no longer
 *    has dropped. Every rig, 3D or not, is saved here.
 */

export type Resolution = 'rebake' | 'detach';

export interface RigSave {
	/** The `.irig` as it will be stored: imported, stamped, and passing `irigDocProblem`. */
	doc: Record<string, unknown>;
	/** The `.irig` precondition: a string = If-Match, null = create, undefined = force. */
	baseEtag: string | null | undefined;
	/**
	 * A 3D client's whole sidecar; null turns the rig's 3D off (the sidecar is removed, the clips stay
	 * as baked). Absent for a 2D save, which keeps the stored one.
	 */
	rig3d?: unknown;
	/** The sidecar's ETag as that client read it (null = none). Absent with force. */
	rig3dBaseEtag?: string | null;
	/** Per clip, what a 2D edit of its baked parts, or its removal, should do. */
	resolve?: Record<string, Resolution>;
	/** A controls client's whole `controls.json`. Absent for any other save, which keeps the stored one. */
	controls?: unknown;
	/** Its ETag as that client read it (null = none). Absent with force. */
	controlsBaseEtag?: string | null;
	/**
	 * A frame-made rig's whole `frame-source.json` after 🔄 Update rig or a link (frame-to-rig §12
	 * F2j), and its ETag as read; the bundle's art follows it once the `.irig` is stored.
	 */
	frame?: { doc: unknown; baseEtag: string | null | undefined };
}

export interface Rig3dUnmet extends UnmetRun {
	clip: string;
}

export type RigSaveResult =
	| (Extract<IrigWriteResult, { ok: true }> & {
			/** Clips baked by this save. */
			rebaked: string[];
			/** Clips that became plain 2D clips. */
			detached: string[];
			/** Runs a bake could not bring within the rig's tolerance. */
			unmet: Rig3dUnmet[];
			/** What the save dropped from the kept `controls.json` (names the `.irig` no longer has). */
			controlsDropped: string[];
			/** False when a sent frame source's art could not be synced into the bundle. */
			artSwitched?: boolean;
	  })
	| { ok: false; response: Response };

const hashOf = (v: unknown): string =>
	createHash('sha256').update(canonicalJson(v)).digest('hex').slice(0, 32);

const refuse = (status: number, error: string, message: string, extra = {}) => ({
	ok: false as const,
	response: json({ ok: false, error, ...extra, message }, { status }),
});
const unchanged = 'The stored rig is unchanged.';
const listed = (items: string[], most = 6) =>
	items.length > most
		? `${items.slice(0, most).join('; ')}; and ${items.length - most} more`
		: items.join('; ');

/** The sidecar as stored, parsed and checked; `problems` when it cannot be used. */
function parseSidecar(text: string): { doc: Rig3dDoc | null; problems: string[] } {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return { doc: null, problems: [`${RIG3D_SIDECAR} is not valid JSON`] };
	}
	const problems = rig3dDocProblems(value);
	return { doc: problems.length ? null : (value as Rig3dDoc), problems };
}

/**
 * The 3D data a save opens with: the stored sidecar and `.irig` (its text only when the sidecar is
 * this rig's, to check the pair, or `withText`), and whether the sidecar is torn from it (its mark
 * is of another `.irig` text).
 */
export async function storedRig3d(target: IrigTarget, withText = false) {
	const read = await readSidecar(target, 'rig3d');
	const owner = read ? sidecarOwner(read.text) : undefined;
	const irig: { etag: string | null; text?: string } | null =
		owner === target.stem || withText
			? await getObjectTextWithEtag(target.key)
			: await headObject(target.key);
	const parsed = read ? parseSidecar(read.text) : { doc: null, problems: [] };
	const mark = parsed.doc?.irig;
	// Only this rig's sidecar pairs with its `.irig`: another rig's carries the mark of that rig's.
	const torn =
		owner === target.stem &&
		irig?.text !== undefined &&
		mark !== undefined &&
		mark !== pairMark(irig.text);
	return { read, irig, owner, torn, ...parsed };
}

export async function saveRig(
	clientKey: string,
	projectKey: string,
	target: IrigTarget,
	save: RigSave,
): Promise<RigSaveResult> {
	const controlsRead = await readSidecar(target, 'controls');
	const stored = await storedRig3d(
		target,
		controlsRead !== null && sidecarOwner(controlsRead.text) === target.stem,
	);
	const { read, irig: irigStored } = stored;
	const client3d = save.rig3d !== undefined;
	const ours = read !== null && stored.owner === target.stem;
	// A sidecar naming this rig while its `.irig` does not exist is left over (a delete that did not
	// finish); its content is nobody's, and this save replaces or removes it.
	const orphan = ours && irigStored === null;

	if (save.baseEtag !== undefined && (irigStored ? irigStored.etag : null) !== save.baseEtag)
		return { ok: false, response: irigConflict(target, save.baseEtag, irigStored?.etag ?? null) };
	const gained = constraintOrderClashes(save.doc).length
		? gainedOrderClashes(save.doc, await storedRigDoc(target, irigStored))
		: [];
	if (gained.length)
		return refuse(
			422,
			'order-clash',
			`Not saved — ${listed(gained.map((x) => `${x.kind} constraint "${x.name}" would never run: it ${x.why}`))}. The runtime runs one constraint per solve order; 🩹 Repair in the Rigger re-numbers them. ${unchanged}`,
			{ clashes: gained },
		);
	if (stored.torn)
		return refuse(
			409,
			'rig3d-torn',
			`Not saved — this rig's 3D data (${RIG3D_SIDECAR}) was written for another version of "${target.stem}.irig": a save is landing right now, or one was cut off between the two. Try again in a moment; if this stays, restore the last good version from 🕘 History. ${unchanged}`,
			{ etag: irigStored?.etag ?? null, rig3dEtag: read?.etag ?? null },
		);
	if (read && stored.owner !== undefined && !ours && client3d)
		return refuse(
			409,
			'rig3d-other-rig',
			`Not saved — the 3D data in this folder belongs to rig "${stored.owner}", not "${target.stem}". ${unchanged}`,
		);
	if (read && stored.owner === undefined && !client3d)
		return refuse(
			409,
			'rig3d-unreadable',
			`Not saved — this folder's ${RIG3D_SIDECAR} (its rig's 3D data) is unreadable: ${listed(stored.problems)}. Restore an earlier version from 🕘 History. ${unchanged}`,
		);
	if (ours && !orphan && !stored.doc && !client3d)
		return refuse(
			409,
			'rig3d-unreadable',
			`Not saved — this rig's 3D data (${RIG3D_SIDECAR}) is unreadable: ${listed(stored.problems)}. Restore an earlier version from 🕘 History. ${unchanged}`,
		);
	const s0 = ours && !orphan ? stored.doc : null;

	let s1: Rig3dDoc | null = s0 ? structuredClone(s0) : null;
	if (client3d) {
		if (
			save.rig3dBaseEtag !== undefined &&
			(read ? read.etag : null) !== save.rig3dBaseEtag &&
			!orphan
		)
			return {
				ok: false,
				response: json(
					{
						ok: false,
						error: 'conflict',
						etag: irigStored?.etag ?? null,
						rig3dEtag: read?.etag ?? null,
						message: `Someone else saved the 3D data of "${target.stem}" while you were editing. Your changes are still here — reload to get their version first.`,
					},
					{ status: 409 },
				),
			};
		if (save.rig3d === null) s1 = null;
		else {
			const sent =
				typeof save.rig3d === 'object' && !Array.isArray(save.rig3d)
					? { ...save.rig3d, rig: target.stem }
					: save.rig3d;
			const problems = rig3dDocProblems(sent);
			if (problems.length)
				return refuse(
					422,
					'rig3d-invalid',
					`Not saved — the 3D data is malformed: ${listed(problems)}. ${unchanged}`,
					{ problems },
				);
			s1 = structuredClone(sent as Rig3dDoc);
			if (s0?.turnaround !== undefined && s1.turnaround !== s0.turnaround)
				return refuse(
					422,
					'turnaround-fixed',
					`Not saved — this rig turns ${s0.turnaround === 'side' ? 'as far as its side views' : 'all the way round'} ("${s0.turnaround}"), which is fixed once chosen: its art and every clip's drawings depend on it. ${unchanged}`,
				);
			// What the bake wrote is the save's record, never the client's.
			for (const [c, clip] of Object.entries(s1.clips ?? {})) {
				const rec = s0?.clips?.[c]?.baked;
				if (rec) clip.baked = rec;
				else delete clip.baked;
			}
		}
	}

	const controls = controlsPlan(
		target,
		storedControls(target, controlsRead, irigStored?.text),
		irigStored,
		save.doc,
		save.controls === undefined
			? undefined
			: { controls: save.controls, baseEtag: save.controlsBaseEtag },
	);
	if (!controls.ok) return controls;
	const controlsDropped = controls.dropped;
	const frame = await framePlan(
		clientKey,
		projectKey,
		target,
		irigStored?.etag ?? null,
		save.frame,
	);
	if (!frame.ok) return frame;
	// A sent frame source points the bundle at its art once the `.irig` it was made for is stored.
	const withArt = async <T extends { ok: true }>(res: T): Promise<T & { artSwitched?: boolean }> =>
		frame.doc
			? { ...res, artSwitched: await switchFrameArt(clientKey, projectKey, target, frame.doc) }
			: res;

	const plan = (next?: string | null): SidecarPlans => ({
		rig3d: { read, ours, ...(next === undefined ? {} : { next }) },
		controls: controls.plan,
		...(frame.plan ? { frame: frame.plan } : {}),
	});
	if (!s1) {
		// `rig3d: null` turns the rig's 3D off (§9): its sidecar goes, and every clip stays as it is
		// in the `.irig` — the bakes, now plain 2D clips.
		const off = client3d && save.rig3d === null && ours;
		const text = JSON.stringify(save.doc);
		const res = await writeIrig(
			clientKey,
			projectKey,
			target,
			text,
			save.baseEtag,
			plan(orphan || off ? null : undefined),
		);
		const detached = off && !orphan ? Object.keys(s0?.clips ?? {}) : [];
		return res.ok ? withArt({ ...res, rebaked: [], detached, unmet: [], controlsDropped }) : res;
	}

	const followers = followersOf(s1);
	const clips: Record<string, Rig3dClip> = s1.clips ?? {};
	const detached: string[] = [];
	const edited: { clip: string; parts: string[] }[] = [];
	let before: Record<string, unknown> | null | undefined;
	// A clip whose baked parts match no bake of it was changed in 2D (a re-bake follows anyway: its
	// parts no longer match the record).
	for (const c of Object.keys(clips)) {
		const rec = s0?.clips?.[c]?.baked;
		if (!rec) continue;
		const incoming = bakedParts(save.doc, c, rec, followers);
		const h = hashOf(incoming);
		if (h === rec.hash || rec.earlier?.includes(h)) continue;
		const resolution = save.resolve?.[c];
		if (resolution === 'detach') {
			delete clips[c];
			detached.push(c);
		} else if (resolution !== 'rebake') {
			before ??= parsedIrig(irigStored?.text);
			edited.push({
				clip: c,
				parts: !incoming.clip
					? ['the whole clip, deleted or renamed']
					: before
						? partsDiffer(bakedParts(before, c, rec, followers), incoming)
						: [],
			});
		}
	}
	if (edited.length)
		return refuse(
			409,
			'baked-edited',
			`Not saved — ${edited
				.map(
					(e) =>
						`clip "${e.clip}" is baked from 3D keys, and this save changes what the bake wrote${e.parts.length ? ` (${e.parts.join(', ')})` : ''}`,
				)
				.join(
					'; ',
				)}. The Rigger cannot edit a 3D clip in 2D yet: undo those changes (or reload), then save. ${unchanged}`,
			{ clips: edited },
		);
	// A transition whose clip was detached cannot be baked again: it is detached with it.
	for (const [c, clip] of Object.entries(clips)) {
		const tr = clip.transition;
		if (tr && !(Object.hasOwn(clips, tr.from) && Object.hasOwn(clips, tr.to))) {
			delete clips[c];
			detached.push(c);
		}
	}

	const rig = rigOf(save.doc, s1);
	const problems = new Set([
		...rig3dIrigProblems(s1, save.doc),
		...rig2p5dProblems(rig, { name: 'setup', duration: 1, bones: {} }),
	]);
	const plans: ClipPlan[] = [];
	if (!problems.size)
		for (const c of Object.keys(clips)) {
			const p = clipOf(rig, save.doc, s1, c);
			plans.push(p);
			for (const x of [...p.problems, ...rig2p5dProblems(rig, p.clip)]) problems.add(x);
		}
	if (problems.size)
		return refuse(
			422,
			'rig3d-invalid',
			`Not saved — this rig's 3D data (${RIG3D_SIDECAR}) does not fit it: ${listed([...problems])}. ${unchanged}`,
			{ problems: [...problems] },
		);

	let doc = save.doc;
	const rebaked: string[] = [];
	const unmet: Rig3dUnmet[] = [];
	const at = new Date().toISOString();
	for (const p of plans) {
		const c = p.clip.name;
		const rec = clips[c].baked;
		const input = hashOf({ rig, clip: p.clip });
		const scope = { bones: p.owned, slots: p.slots };
		const current =
			rec !== undefined &&
			rec.input === input &&
			canonicalJson(rec.bones) === canonicalJson(p.owned) &&
			canonicalJson(rec.slots) === canonicalJson(p.slots) &&
			rec.hash === hashOf(bakedParts(doc, c, scope, followers));
		if (current) continue;
		let bake: ReturnType<typeof bake2p5d>;
		try {
			bake = bake2p5d(rig, p.clip);
		} catch (e) {
			return refuse(
				422,
				'rig3d-invalid',
				`Not saved — clip "${c}" could not be baked: ${(e as Error).message}. ${unchanged}`,
			);
		}
		doc = withBake(doc, c, p, bake, followers);
		const hash = hashOf(bakedParts(doc, c, scope, followers));
		const earlier = [rec?.hash, ...(rec?.earlier ?? [])].filter(
			(h, i, all): h is string => h !== undefined && h !== hash && all.indexOf(h) === i,
		);
		clips[c].baked = {
			hash,
			earlier: earlier.slice(0, RIG3D_EARLIER),
			input,
			at,
			unmet: bake.report.unmet.length,
			bones: p.owned,
			slots: p.slots,
		};
		rebaked.push(c);
		unmet.push(...bake.report.unmet.map((u) => ({ clip: c, ...u })));
	}

	const problem = irigDocProblem(doc);
	if (problem)
		return refuse(
			422,
			'invalid-skeleton',
			`Not saved — the baked rig would not load: ${problem}. ${unchanged}`,
		);
	// `writeIrig` marks it with this `.irig` and writes it only if that changes its text.
	const res = await writeIrig(
		clientKey,
		projectKey,
		target,
		JSON.stringify(doc),
		save.baseEtag,
		plan(JSON.stringify(s1)),
	);
	return res.ok ? withArt({ ...res, rebaked, detached, unmet, controlsDropped }) : res;
}

/**
 * The rig as it is stored, for what a save may keep: its `.irig`, else the artist's source `.json`
 * beside it (the rig's first save imports it); null when there is neither, or it cannot be read.
 */
async function storedRigDoc(
	target: IrigTarget,
	irig: { etag: string | null; text?: string } | null,
): Promise<Record<string, unknown> | null> {
	if (irig) return parsedIrig(irig.text ?? (await getObjectTextWithEtag(target.key))?.text);
	return parsedIrig((await getObjectTextWithEtag(target.key.replace(/\.irig$/, '.json')))?.text);
}

/** The `.irig` as stored, to name what a 2D edit changed; null when it cannot be read. */
function parsedIrig(text: string | undefined): Record<string, unknown> | null {
	if (text === undefined) return null;
	try {
		const doc: unknown = JSON.parse(text);
		return typeof doc === 'object' && doc !== null ? (doc as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}
