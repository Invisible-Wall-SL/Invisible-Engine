import { error } from '@sveltejs/kit';
import { IRIG_VERSION } from 'engine-rig';
import { CONTROLS_SIDECAR, CONTROLS_VERSION } from '../rigControls';
import { refuseOnThrow } from './refuseOnThrow';
import { pairMark } from './riggerIrigWrite';
import { r2Slug, sharedRigKey } from './projectPaths';
import { getObjectText } from './r2';
import { asIrigDocument, irigDocProblem } from './riggerIrig';
import { rigTemplateForNewRig } from './rigTemplateStore';
import { parseRigFit, type RigFit } from './rigTemplateFit';
import { parseSheetMapping, sheetRig } from './rigSheetFit';
import {
	templateFitProblem,
	templateRig,
	type TemplateArt,
	type TemplateRegion,
	type TemplateRig,
} from './rigTemplates';
import {
	moduleChoiceProblem,
	parseModuleChoice,
	templateWithModules,
	type RigModuleChoice,
} from './rigTemplateModules';
import type { SheetMapping } from '../rigSheetMap';

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
	/** A rig made from a sheet mapped to its template: the mapping as kept, and what it made. */
	sheet: { mapping: SheetMapping; scale: number; face: string; hidden: string[] } | null;
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
 * A request's `sheet` (🗺 From my sheet, docs/design/frame-to-rig.md §13): undefined when it has
 * none, else the mapping, strictly read (a 400 otherwise).
 */
export function requestSheet(raw: unknown): SheetMapping | undefined {
	if (raw === undefined) return undefined;
	const parsed = parseSheetMapping(raw);
	if ('problem' in parsed) throw error(400, `bad sheet mapping: ${parsed.problem}`);
	return parsed.mapping;
}

/** A request's `modules` (docs/design/rig-modules.md): undefined when none, else the choice (a 400 otherwise). */
export function requestModules(raw: unknown): RigModuleChoice | undefined {
	const parsed = parseModuleChoice(raw);
	if (parsed === null) throw error(400, 'bad modules: { module: option }');
	return parsed;
}

/**
 * What `new` and `upload` write: a template rig over `regions` when `templateId` is set (a built-in,
 * or a template made in the Rigger at its current version), fitted to the character when `fit` is
 * given, else `resolveRigSkeletonBody(rigId)`. A template and a saved rig together are refused (400):
 * both are a whole skeleton; so is a fit without a template, or one that does not fit it. With a
 * `sheet` mapping the fit and each part's art are the mapping's (`sheetRig`), never a request's. With
 * `modules` (a sheet's are its mapping's) the template is built with that module set. A rig that would
 * not load, or a build that throws over this art, is a 422 saying why.
 */
export async function resolveNewRigBody(
	rigId: string,
	templateId: string,
	regions: readonly TemplateRegion[],
	fit?: RigFit,
	sheet?: SheetMapping,
	modules?: RigModuleChoice,
): Promise<NewRigBody> {
	if ((fit || sheet) && !templateId) throw error(400, 'a fit is made to a template: pick one');
	if (!templateId)
		return { skeleton: await resolveRigSkeletonBody(rigId), template: null, sheet: null };
	if (rigId) throw error(400, 'pick a saved rig or a template, not both');
	if (fit && sheet) throw error(400, "a sheet's rig is fitted from its mapping: send no fit");
	const whole = await rigTemplateForNewRig(templateId);
	if (!whole) throw error(404, `no rig template "${templateId}"`);
	const choice = sheet ? (sheet.template.modules ?? {}) : (modules ?? {});
	const unchosen = moduleChoiceProblem(whole, choice);
	if (unchosen) throw error(400, unchosen);
	const t = templateWithModules(whole, choice);
	return refuseOnThrow(`The "${t.label}" template could not be made over this art`, () => {
		let art: Record<string, TemplateArt> | undefined;
		let made: NewRigBody['sheet'] = null;
		if (sheet) {
			const fitted = sheetRig(t, regions, sheet);
			if (!fitted.ok)
				throw error(400, `The sheet does not fit the "${t.label}" template: ${fitted.problem}.`);
			({ fit, art } = fitted.value);
			made = {
				mapping: {
					...sheet,
					template: {
						id: t.id,
						version: t.version,
						...(t.choice && Object.keys(t.choice).length ? { modules: { ...t.choice } } : {}),
					},
				},
				scale: fitted.value.scale,
				face: fitted.value.face,
				hidden: fitted.value.hidden,
			};
		}
		const misfit = fit ? templateFitProblem(t, fit) : null;
		if (misfit) throw error(400, `The fit does not fit the "${t.label}" template: ${misfit}.`);
		const rig = templateRig(t, regions, fit, art);
		const problem = irigDocProblem(rig.skeleton);
		if (problem)
			throw error(422, `The "${t.label}" rig would not load (${problem}), so none was created.`);
		return { skeleton: rig.skeleton, template: rig, sheet: made };
	});
}

/**
 * The `controls.json` a rig named `stem` made from a template starts with (rig-controls §6.1): the
 * template's control layer bound to the rig and marked as written with `irigText`, the `.irig` the
 * create claimed — so the first open reads it as this rig's, not a torn one. Null when there is none.
 */
export function newRigControls(
	template: TemplateRig | null,
	stem: string,
	irigText: string,
): { file: string; text: string } | null {
	if (!template?.controls) return null;
	const doc = {
		controls: CONTROLS_VERSION,
		rig: stem,
		...template.controls,
		irig: pairMark(irigText),
	};
	return { file: CONTROLS_SIDECAR, text: JSON.stringify(doc) };
}
