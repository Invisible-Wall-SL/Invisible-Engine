import { conflictJson } from './conflict';
import {
	ConflictError,
	deleteObjects,
	getObjectText,
	getObjectTextWithEtag,
	listAllKeys,
	precondition,
	putObjectText,
} from './r2';
import { mergeRigLengths } from '../rigCaptureFit';
import { rigTemplateSaveProblem } from './rigTemplateCheck';
import { parseRigFit, type RigFit } from './rigTemplateFit';
import {
	parseTemplateRef,
	rigTemplateById,
	rigTemplateProblem,
	rigTemplateSummary,
	sidecarTemplate,
	templateFitProblem,
	type RigTemplate,
	type RigTemplateRef,
	type RigTemplateSaved,
	type RigTemplateSummary,
} from './rigTemplates';

/**
 * The shared store of rig templates made in the Rigger (docs/design/rig-templates.md §7.1).
 *
 * `_shared/rig-templates/<id>/v<n>.json` is one published version, written create-only and never
 * rewritten, so a rig made from v1 keeps v1's controls after v2 exists. `<id>/head.json` names the
 * current version and who saved it; it moves only under the caller's precondition (create-only, or
 * `If-Match` on the head the author confirmed). There is no index object: the list is a prefix
 * listing of heads, so two saves of different templates write different keys and cannot drop each
 * other — the race the rig library's shared index had.
 */

export const RIG_TEMPLATES_PREFIX = '_shared/rig-templates';
export const rigTemplateHeadKey = (id: string) => `${RIG_TEMPLATES_PREFIX}/${id}/head.json`;
export const rigTemplateVersionKey = (id: string, version: number) =>
	`${RIG_TEMPLATES_PREFIX}/${id}/v${version}.json`;

interface Head {
	id: string;
	version: number;
	label: string;
	savedAt: string;
	savedBy: { uid: string; name: string };
	project: string;
}

/** A user template id is an `r2Slug`: lower case, digits and `_` only, so never a built-in's. */
export const USER_TEMPLATE_ID = /^[a-z0-9_]{1,60}$/;

async function readHead(id: string): Promise<{ head: Head; etag: string | null } | null> {
	const got = await getObjectTextWithEtag(rigTemplateHeadKey(id));
	if (!got) return null;
	try {
		const head = JSON.parse(got.text) as Head;
		if (typeof head?.version !== 'number') return null;
		return { head, etag: got.etag };
	} catch {
		return null;
	}
}

const savedOf = (h: Head, etag: string | null): RigTemplateSaved => ({
	savedAt: h.savedAt,
	savedBy: h.savedBy,
	project: h.project,
	etag,
});

/** One stored version, or null when it is gone or no longer reads as a template. */
async function readVersion(id: string, version: number): Promise<RigTemplate | null> {
	const text = await getObjectText(rigTemplateVersionKey(id, version));
	if (!text) return null;
	try {
		const t = JSON.parse(text) as RigTemplate;
		const problem = rigTemplateProblem(t);
		if (problem) {
			console.warn(`[rigTemplates] ${id} v${version} is stored but broken: ${problem}`);
			return null;
		}
		return t;
	} catch {
		return null;
	}
}

/** A user template at `version` (the head's when none), with its head; null when deleted. */
export async function userRigTemplate(
	id: string,
	version?: number,
): Promise<{ template: RigTemplate; saved: RigTemplateSaved } | null> {
	if (!USER_TEMPLATE_ID.test(id)) return null;
	const cur = await readHead(id);
	if (!cur) return null;
	const template = await readVersion(id, version ?? cur.head.version);
	return template ? { template, saved: savedOf(cur.head, cur.etag) } : null;
}

/** Every user template at its head version, by label. */
export async function listUserRigTemplates(): Promise<RigTemplateSummary[]> {
	const heads = (await listAllKeys(`${RIG_TEMPLATES_PREFIX}/`)).filter((k) =>
		k.endsWith('/head.json'),
	);
	const out = await Promise.all(
		heads.map(async (k) => {
			const id = k.slice(RIG_TEMPLATES_PREFIX.length + 1, -'/head.json'.length);
			const got = await userRigTemplate(id);
			return got ? rigTemplateSummary(got.template, got.saved) : null;
		}),
	);
	return out
		.filter((s): s is RigTemplateSummary => s !== null)
		.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * `text` (a bundle's `template.json` for template `t`) with its fit's limb lengths set to the rig's
 * (⤢ Fit rig to the capture, docs/design/frame-to-rig.md §4.6a). Derived from the saved rig on every
 * read and never stored, so the template the Rigger drives a rig with has the limbs of the rig as it
 * is saved, whichever save, overwrite or 🕘 restore wrote it last. The rest of the fit (a frame-made
 * rig's pose, props and bends) is kept; `text` as it is when its fit does not read, or the rig's
 * lengths do not fit the template.
 */
export function sidecarOnRig(
	t: RigTemplate,
	text: string,
	rigBones: readonly { name: string; x?: number; y?: number }[],
): string {
	let raw: Record<string, unknown>;
	try {
		raw = JSON.parse(text) as Record<string, unknown>;
	} catch {
		return text;
	}
	let kept: RigFit | null = null;
	if (raw.fit !== undefined) {
		const parsed = parseRigFit(raw.fit);
		if ('problem' in parsed) return text;
		kept = parsed.fit;
	}
	const next = mergeRigLengths(t, kept, rigBones);
	if (next && templateFitProblem(t, next)) return text;
	const rest = { ...raw };
	delete rest.fit;
	return JSON.stringify(next ? { ...rest, fit: next } : rest);
}

/**
 * The template a bundle's `template.json` names, at the version the rig was made from, fitted as
 * the rig was when it was made from a frame (`sidecarTemplate`); with `rigBones` (the saved rig's),
 * on that rig's own limb lengths (`sidecarOnRig`).
 */
export async function rigTemplateForSidecar(
	text: string | null,
	rigBones?: readonly { name: string; x?: number; y?: number }[],
): Promise<RigTemplateSummary | null> {
	const ref = parseTemplateRef(text);
	if (!ref || text === null) return null;
	const on = (t: RigTemplate) => (rigBones ? sidecarOnRig(t, text, rigBones) : text);
	const builtin = rigTemplateById(ref.id, ref.version);
	if (builtin) return rigTemplateSummary(sidecarTemplate(builtin, on(builtin)));
	const got = await userRigTemplate(ref.id, ref.version);
	return got
		? rigTemplateSummary(sidecarTemplate(got.template, on(got.template)), got.saved)
		: null;
}

/** The template ＋ New rig builds from: a built-in, or a user template's head version. */
export async function rigTemplateForNewRig(id: string): Promise<RigTemplate | null> {
	return rigTemplateById(id) ?? (await userRigTemplate(id))?.template ?? null;
}

export type TemplateWriteResult =
	| { ok: true; ref: RigTemplateRef; etag: string | null }
	| { ok: false; response: Response }
	| { ok: false; problem: string };

function headConflict(
	id: string,
	kind: 'exists' | 'conflict',
	cur: { head: Head; etag: string | null } | null,
): Response {
	const h = cur?.head;
	const who = h ? ` by ${h.savedBy.name || 'someone'} from project "${h.project}"` : '';
	const when = h ? ` (version ${h.version}, ${h.savedAt.slice(0, 16).replace('T', ' ')} UTC)` : '';
	return conflictJson(
		kind === 'exists'
			? `There is already a template "${h?.label ?? id}" saved${who}${when}. Saving makes your rig its next version for everyone; rigs already made from it keep theirs.`
			: cur
				? `Someone else just saved the template "${h?.label ?? id}"${who}${when}. Nothing was saved.`
				: `The template "${id}" was deleted while you were editing. Nothing was saved.`,
		{
			code: kind,
			extra: {
				id,
				etag: cur?.etag ?? null,
				version: h?.version ?? null,
				label: h?.label ?? null,
				project: h?.project ?? null,
				savedBy: h?.savedBy ?? null,
				savedAt: h?.savedAt ?? null,
			},
		},
	);
}

/**
 * Store `template` as the next version of `id`. `baseEtag` null creates (a taken id is 409
 * `exists`); a string must be the current head's etag (else 409 `conflict`). The template is
 * checked first (contract, then the rigs it makes), and nothing is written when it fails.
 */
export async function saveUserRigTemplate(
	id: string,
	template: RigTemplate,
	baseEtag: string | null,
	by: { uid: string; name: string; project: string },
): Promise<TemplateWriteResult> {
	const problem = rigTemplateSaveProblem(template);
	if (problem) return { ok: false, problem };
	const cur = await readHead(id);
	if (baseEtag === null && cur) return { ok: false, response: headConflict(id, 'exists', cur) };
	if (baseEtag !== null && cur?.etag !== baseEtag)
		return { ok: false, response: headConflict(id, 'conflict', cur) };
	// One past every version in the folder, not only the head's: a save that died between its version
	// and its head left an orphan this steps over.
	const taken = (await listAllKeys(`${RIG_TEMPLATES_PREFIX}/${id}/`))
		.map((k) => /\/v(\d+)\.json$/.exec(k)?.[1])
		.filter((v): v is string => v !== undefined)
		.map(Number);
	const version = Math.max(cur?.head.version ?? 0, ...taken) + 1;
	const stored: RigTemplate = { ...template, id, version };
	const head: Head = {
		id,
		version,
		label: template.label,
		savedAt: new Date().toISOString(),
		savedBy: { uid: by.uid, name: by.name },
		project: by.project,
	};
	try {
		await putObjectText(
			rigTemplateVersionKey(id, version),
			JSON.stringify(stored),
			'application/json',
			precondition(null),
		);
		const etag = await putObjectText(
			rigTemplateHeadKey(id),
			JSON.stringify(head),
			'application/json',
			precondition(baseEtag),
		);
		return { ok: true, ref: { id, version }, etag };
	} catch (e) {
		if (!(e instanceof ConflictError)) throw e;
		return { ok: false, response: headConflict(id, 'conflict', await readHead(id)) };
	}
}

/**
 * Delete a user template when its head is still the one the author confirmed (`etag`). The head
 * goes first, so the template leaves the list and every rig's Controls section at once; a failure
 * after it leaves version files nobody reads.
 */
export async function deleteUserRigTemplate(
	id: string,
	etag: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
	const cur = await readHead(id);
	if (!cur || cur.etag !== etag) return { ok: false, response: headConflict(id, 'conflict', cur) };
	await deleteObjects([rigTemplateHeadKey(id)]);
	await deleteObjects(
		(await listAllKeys(`${RIG_TEMPLATES_PREFIX}/${id}/`)).filter((k) => /\/v\d+\.json$/.test(k)),
	);
	return { ok: true };
}
