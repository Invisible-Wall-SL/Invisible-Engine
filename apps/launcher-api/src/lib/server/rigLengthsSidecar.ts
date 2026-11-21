import { canonicalJson } from '../rig3d';
import { mergeRigLengths } from '../rigCaptureFit';
import { ConflictError, getObjectTextWithEtag, headObject, putObjectText } from './r2';
import type { IrigTarget } from './riggerIrigWrite';
import { parseRigFit, type RigFit } from './rigTemplateFit';
import {
	RIG_TEMPLATE_SIDECAR,
	parseTemplateRef,
	rigTemplateById,
	rigTemplateSummary,
	sidecarTemplate,
	templateFitProblem,
	type RigTemplateSummary,
} from './rigTemplates';
import { userRigTemplate } from './rigTemplateStore';

/** Reads and writes one keeping of the lengths retries when another write lands in between. */
const ATTEMPTS = 4;

export type KeepLengthsResult =
	| { ok: true; template: RigTemplateSummary; changed: boolean }
	| { ok: false; status: number; message: string };

/**
 * The rig's `template.json` fit with the limb lengths of its SAVED `.irig` (⤢ Fit rig to the
 * capture, docs/design/frame-to-rig.md §4.6a), so `/api/rigger/template` answers the template on
 * the rig's own limbs and the Controls and the motion solve of every tab follow them. Derived from
 * the stored `.irig`, never from what a client says, so the two cannot disagree for long: every
 * keeping writes what the stored rig has now, and the last one wins with the same answer.
 *
 * Read-modify-write under a precondition: `template.json` is written `If-Match` the ETag it was read
 * at, and the `.irig` is read again after it — a save of the rig or another keeping landing in
 * between makes it read both again and derive again. Only the limb lengths change: the rest of the
 * fit (a frame-made rig's pose, props and bends) and of the file are kept as they are.
 */
export async function keepRigLengths(
	target: IrigTarget,
	bundlePrefix: string,
): Promise<KeepLengthsResult> {
	const key = `${bundlePrefix}/${RIG_TEMPLATE_SIDECAR}`;
	const no = (status: number, message: string) => ({ ok: false as const, status, message });
	for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
		const irig = await getObjectTextWithEtag(target.key);
		if (!irig) return no(404, `"${target.stem}.irig" is not saved yet.`);
		const side = await getObjectTextWithEtag(key);
		const ref = side ? parseTemplateRef(side.text) : null;
		if (!side || !ref) return no(404, 'This rig was not made from a rig template.');
		const builtin = rigTemplateById(ref.id, ref.version);
		const user = builtin ? null : await userRigTemplate(ref.id, ref.version);
		const t = builtin ?? user?.template;
		if (!t) return no(404, `Its template "${ref.id}" v${ref.version} no longer exists.`);

		let raw: Record<string, unknown>;
		let bones: { name: string; x?: number; y?: number }[];
		try {
			raw = JSON.parse(side.text) as Record<string, unknown>;
			const doc = JSON.parse(irig.text) as { bones?: unknown };
			bones = Array.isArray(doc.bones) ? (doc.bones as typeof bones) : [];
		} catch {
			return no(422, `The saved rig or its ${RIG_TEMPLATE_SIDECAR} is not JSON.`);
		}
		let kept: RigFit | null = null;
		if (raw.fit !== undefined) {
			const parsed = parseRigFit(raw.fit);
			if ('problem' in parsed)
				return no(422, `Its ${RIG_TEMPLATE_SIDECAR} keeps a fit that does not read: ${parsed.problem}.`);
			kept = parsed.fit;
		}
		const next = mergeRigLengths(t, kept, bones);
		const answer = (text: string, changed: boolean) => ({
			ok: true as const,
			template: rigTemplateSummary(sidecarTemplate(t, text), user?.saved),
			changed,
		});
		if (canonicalJson(next) === canonicalJson(kept)) return answer(side.text, false);
		if (next) {
			const bad = templateFitProblem(t, next);
			if (bad) return no(422, `The rig's limb lengths do not fit its template: ${bad}.`);
		}
		const rest = { ...raw };
		delete rest.fit;
		const text = JSON.stringify(next ? { ...rest, fit: next } : rest);
		if (side.etag === null)
			return no(409, `${RIG_TEMPLATE_SIDECAR} has no version to write over safely; reload and save again.`);
		try {
			await putObjectText(key, text, 'application/json', { ifMatch: side.etag });
		} catch (e) {
			if (e instanceof ConflictError) continue;
			throw e;
		}
		const now = await headObject(target.key);
		if (now?.etag !== irig.etag) continue;
		return answer(text, true);
	}
	return no(409, `"${target.stem}" kept changing while its template's lengths were written; save again.`);
}
