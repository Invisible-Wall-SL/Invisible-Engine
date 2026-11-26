import { json } from '@sveltejs/kit';
import { canonicalJson } from '../rig3d';
import {
	CONTROLS_SIDECAR,
	checkedControls,
	controlsDocProblems,
	fitControls,
	renameControls,
	renamesBetween,
	type ControlsDoc,
} from '../rigControls';
import { pairMark, sidecarOwner, type IrigTarget, type SidecarPlan } from './riggerIrigWrite';

/**
 * Saving a rig's control layer, `controls.json` (docs/design/rig-controls.md §5.7, C1), with its
 * `.irig` through `saveRig` (`rigger3d.ts`), as one more of the folder's authoring sidecars
 * (`writeIrig`). The sidecar changes no playback, so it is strict where it is written and lenient
 * where it is kept:
 *
 *  - **A client that edits controls** sends the whole sidecar (`controls`, under `controlsBaseEtag`);
 *    it is bound to the rig and refused (`controls-invalid`) unless it is well formed and every
 *    name it uses is in the `.irig` being saved.
 *  - **Every other write** (today's Rigger, Director, a restore's own save) keeps the stored one,
 *    following the `.irig`'s renames into it and dropping what names a bone or constraint the
 *    `.irig` no longer has, with a notice — the Rigger rewrites constraints the same way. One it
 *    cannot read (unparseable, another version) is kept as it is, re-marked.
 *  - **A torn pair is refused** (`controls-torn`), as rig3d.json's is: its mark is of another `.irig`
 *    (a save landing now, or cut off between its writes), and keeping it would resurrect that save's
 *    controls over an `.irig` it never wrote.
 */

/** The stored sidecar as a save or the precondition GET reads it. */
export interface StoredControls {
	read: SidecarPlan['read'];
	/** Its `rig`, or undefined when it cannot be read. */
	owner: string | undefined;
	/** It belongs to this rig. */
	ours: boolean;
	/** Parsed and checked; null with `problems` when it cannot be used. */
	doc: ControlsDoc | null;
	problems: string[];
	/** Its mark is of another version of the `.irig`. */
	torn: boolean;
}

/** `read` as this rig's sidecar, against the stored `.irig` text (when it was read). */
export function storedControls(
	target: IrigTarget,
	read: SidecarPlan['read'],
	irigText: string | undefined,
): StoredControls {
	const owner = read ? sidecarOwner(read.text) : undefined;
	let doc: ControlsDoc | null = null;
	let problems: string[] = [];
	if (read) {
		let value: unknown;
		try {
			value = JSON.parse(read.text);
			problems = controlsDocProblems(value);
		} catch {
			problems = [`${CONTROLS_SIDECAR} is not valid JSON`];
		}
		if (!problems.length) doc = value as ControlsDoc;
	}
	const mark = doc?.irig;
	const torn = irigText !== undefined && mark !== undefined && mark !== pairMark(irigText);
	return { read, owner, ours: read !== null && owner === target.stem, doc, problems, torn };
}

/** The `.irig` text as JSON, or null when it cannot be read. */
function irigDoc(text: string | undefined): Record<string, unknown> | null {
	if (text === undefined) return null;
	try {
		const doc: unknown = JSON.parse(text);
		return typeof doc === 'object' && doc !== null && !Array.isArray(doc)
			? (doc as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

/**
 * The sidecar as the precondition GET answers it, read leniently against the stored `.irig`:
 * `{ etag, doc }` without what names a bone or constraint the `.irig` lacks (listed in `dropped`;
 * old slot groups that could not become folders in `unconverted`),
 * or `{ etag, problems }`; `torn` when its mark is of another `.irig`. Null when the folder has none
 * of this rig's (another rig's is not shown; one that cannot say whose it is, is).
 */
export function controlsView(
	stored: StoredControls,
	irigStored: { etag: string | null; text?: string } | null,
) {
	const { read, owner, doc, problems, torn } = stored;
	if (!read || !irigStored || (owner !== undefined && !stored.ours)) return null;
	const irig = irigDoc(irigStored.text);
	const fit = doc && irig ? fitControls(doc, irig) : null;
	return {
		etag: read.etag,
		...(doc ? { doc: fit ? fit.doc : doc } : { problems }),
		...(fit?.dropped.length ? { dropped: fit.dropped } : {}),
		...(fit?.unconverted.length ? { unconverted: fit.unconverted } : {}),
		...(torn ? { torn } : {}),
	};
}

const refuse = (status: number, error: string, message: string, extra = {}) => ({
	ok: false as const,
	response: json({ ok: false, error, ...extra, message }, { status }),
});
const unchanged = 'The stored rig is unchanged.';

export type ControlsPlan =
	| {
			ok: true;
			plan: SidecarPlan;
			/** What the save dropped from the kept sidecar, as notices. */
			dropped: string[];
	  }
	| { ok: false; response: Response };

/**
 * What a save of `doc` does to the rig's `controls.json`: `sent` is a client's whole sidecar and the
 * ETag it read it at (undefined with force); without it the stored one is kept, reconciled with the
 * `.irig` — the stored one (`irig`, with its text when the sidecar is this rig's) to the one saved.
 */
export function controlsPlan(
	target: IrigTarget,
	stored: StoredControls,
	irig: { etag: string | null; text?: string } | null,
	doc: Record<string, unknown>,
	sent?: { controls: unknown; baseEtag: string | null | undefined },
): ControlsPlan {
	const { read, ours } = stored;
	const etag = irig ? irig.etag : null;
	// Left over by a delete that did not finish: nobody's, and this save replaces or removes it.
	const orphan = ours && irig === null;
	if (ours && !orphan && stored.torn)
		return refuse(
			409,
			'controls-torn',
			`Not saved — this rig's controls (${CONTROLS_SIDECAR}) were written for another version of "${target.stem}.irig": a save is landing right now, or one was cut off between the two. Try again in a moment; if this stays, restore the last good version from 🕘 History. ${unchanged}`,
			{ etag, controlsEtag: read?.etag ?? null },
		);

	if (sent) {
		if (read && stored.owner !== undefined && !ours)
			return refuse(
				409,
				'controls-other-rig',
				`Not saved — the controls in this folder belong to rig "${stored.owner}", not "${target.stem}". ${unchanged}`,
			);
		if (sent.baseEtag !== undefined && (read ? read.etag : null) !== sent.baseEtag && !orphan)
			return refuse(
				409,
				'conflict',
				`Someone else saved the controls of "${target.stem}" while you were editing. Your changes are still here — reload to get their version first.`,
				{ etag, controlsEtag: read?.etag ?? null },
			);
		const checked = checkedControls(sent.controls, target.stem, doc);
		if (!checked.doc)
			return refuse(
				422,
				'controls-invalid',
				`Not saved — the rig's controls are malformed: ${checked.problems.slice(0, 6).join('; ')}${checked.problems.length > 6 ? `; and ${checked.problems.length - 6} more` : ''}. ${unchanged}`,
				{ problems: checked.problems },
			);
		return { ok: true, plan: { read, ours, next: JSON.stringify(checked.doc) }, dropped: [] };
	}

	if (!ours) return { ok: true, plan: { read, ours }, dropped: [] };
	if (orphan) return { ok: true, plan: { read, ours, next: null }, dropped: [] };
	if (!stored.doc) return { ok: true, plan: { read, ours }, dropped: [] };
	const before = irigDoc(irig?.text);
	const renamed = before ? renameControls(stored.doc, renamesBetween(before, doc)) : stored.doc;
	const fit = fitControls(renamed, doc);
	// Rebuilt entries may list their fields in another order: only a change of content is written.
	const same = canonicalJson(fit.doc) === canonicalJson(stored.doc);
	return {
		ok: true,
		plan: { read, ours, ...(same ? {} : { next: JSON.stringify(fit.doc) }) },
		dropped: fit.dropped,
	};
}
