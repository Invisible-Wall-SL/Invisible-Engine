import { error } from '@sveltejs/kit';
import { IRIG_VERSION } from 'engine-rig';
import { r2Slug, sharedRigKey } from './projectPaths';
import { getObjectText } from './r2';
import { asIrigDocument, irigDocProblem } from './riggerIrig';
import { rigTemplateForNewRig } from './rigTemplateStore';
import { parseRigFit, type RigFit } from './rigTemplateFit';
import {
	templateFitProblem,
	templateRig,
	type TemplateRegion,
	type TemplateRig,
} from './rigTemplates';

/** The minimal blank rig both `new` and `upload` write when no rig is applied, as irig v1. */
function blankSkeleton(): Record<string, unknown> {
	return {
		irig: IRIG_VERSION,
		skeleton: {},
		bones: [{ name: 'root' }],
		slots: [],
		skins: [{ name: 'default', attachments: {} }],
		animations: {},
	};
}

/**
 * Resolve the `.irig` body to write when creating a new rig: irig v1 (docs/design/irig-format.md,
 * Phase 3). When `rigId` is empty the result is a blank rig. When supplied it is the deep-cloned
 * `skeleton` of the saved library rig at `_shared/rigs/<id>.json`, imported when it is a 4.2
 * skeleton. An import that would change a value (a wrong type the 4.2 reader coerces) keeps the 4.2
 * skeleton instead, with its Rig version forced to 4.2, so the rig loads as it always has; an import
 * that only drops keys the 4.2 reader ignores changes nothing. The applied skeleton's attachment
 * region names are NOT
 * remapped to the new atlas — they intentionally stay as authored and won't resolve
 * until the user re-attaches the new object's art (documented behavior); the bones,
 * animations, and constraints come over intact. Throws 404 when the rig is missing, and 422
 * when it would not load — a library rig can predate the checks on the library save, and must
 * not become a new `.irig` that opens as "Load failed".
 */
export async function resolveRigSkeletonBody(rigId: string): Promise<Record<string, unknown>> {
	const id = rigId ? r2Slug(rigId) : '';
	if (!id) return blankSkeleton();
	if (id.includes('..') || id.includes('/')) throw error(400, 'bad rigId');

	const raw = await getObjectText(sharedRigKey(id));
	if (raw === null) throw error(404, 'saved rig not found');
	let entry: { skeleton?: unknown };
	try {
		entry = JSON.parse(raw) as { skeleton?: unknown };
	} catch {
		throw error(500, 'saved rig is not valid JSON');
	}
	const skel = entry.skeleton;
	if (!skel || typeof skel !== 'object' || Array.isArray(skel)) {
		throw error(500, 'saved rig has no skeleton');
	}
	const cloned = asIrigOrSpine42(JSON.parse(JSON.stringify(skel)) as Record<string, unknown>);
	const problem = irigDocProblem(cloned);
	if (problem) {
		throw error(422, `The saved rig "${id}" would not load (${problem}), so no rig was created.`);
	}
	return cloned;
}

/**
 * A 4.2 skeleton as irig v1 when the import changes no value, else the 4.2 skeleton with its
 * version forced to 4.2 so it loads as it always has.
 */
export function asIrigOrSpine42(skel: Record<string, unknown>): Record<string, unknown> {
	const irig = asIrigDocument(skel);
	if (irig) return irig;
	const skelBlock = (skel.skeleton ?? {}) as Record<string, unknown>;
	return { ...skel, skeleton: { ...skelBlock, spine: '4.2' } };
}

/** The `.irig` body for a new rig, and the template fit when it was made from a template. */
export interface NewRigBody {
	skeleton: Record<string, unknown>;
	template: TemplateRig | null;
}

/**
 * A request's `fit` (docs/design/frame-to-rig.md §4.6): undefined when it has none, else the fit,
 * strictly read — a field it does not know or a value that is not a finite number is a 400.
 */
export function requestFit(raw: unknown): RigFit | undefined {
	if (raw === undefined) return undefined;
	const parsed = parseRigFit(raw);
	if ('problem' in parsed) throw error(400, `bad fit: ${parsed.problem}`);
	return parsed.fit;
}

/**
 * What `new` and `upload` write: a template rig over `regions` when `templateId` is set (a built-in,
 * or a template made in the Rigger at its current version), fitted to the character when `fit` is
 * given, else `resolveRigSkeletonBody(rigId)`. A template and a saved rig together are refused (400):
 * both are a whole skeleton; so is a fit without a template, or one that does not fit it.
 */
export async function resolveNewRigBody(
	rigId: string,
	templateId: string,
	regions: readonly TemplateRegion[],
	fit?: RigFit,
): Promise<NewRigBody> {
	if (fit && !templateId) throw error(400, 'a fit is made to a template: pick one');
	if (!templateId) return { skeleton: await resolveRigSkeletonBody(rigId), template: null };
	if (rigId) throw error(400, 'pick a saved rig or a template, not both');
	const t = await rigTemplateForNewRig(templateId);
	if (!t) throw error(404, `no rig template "${templateId}"`);
	const misfit = fit ? templateFitProblem(t, fit) : null;
	if (misfit) throw error(400, `The fit does not fit the "${t.label}" template: ${misfit}.`);
	const made = templateRig(t, regions, fit);
	const problem = irigDocProblem(made.skeleton);
	if (problem) throw error(500, `The "${t.label}" template would not load (${problem}).`);
	return { skeleton: made.skeleton, template: made };
}
