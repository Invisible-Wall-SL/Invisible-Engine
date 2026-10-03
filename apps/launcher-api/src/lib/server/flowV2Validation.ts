/**
 * The publish gate for a project's Invisible Flow v2 document: runs `validateFlowDoc` over the
 * STORED flow with the same scene projection the `/flow-v2` editor's Validation panel uses
 * (`flowV2Projection.ts`), so a flow is refused at publish exactly when the editor shows it red.
 *
 * Two deliberate differences from the editor, both towards "what ships":
 *  - the function library is the one the export embeds (`loadFlowV2Library() ?? empty`), not the
 *    editor's built-in sample fallback — a call into a function the game won't carry is an error;
 *  - only `error` severity blocks. Warnings and hints are the editor's business.
 *
 * The vocabulary is composed exactly as the editor and the game compose it: the kind's, plus the
 * project's Game Config add-ons (`withAddOns`), plus its sounds and scene cues.
 */
import {
	containersMissingScene,
	templateVocabulary,
	validateFlowDoc,
	withAddOns,
	type FlowAddOns,
	type FlowDoc,
	type FlowIssue,
	type FunctionLibraryDoc,
} from 'engine-flow-v2';
import type { ComponentDef, Scene, SoundsDoc } from 'engine-layout';
import { flowAddOnsOf, type GameConfigDoc } from 'game-config';
import { collectContainerTaps } from '$lib/containerTaps';
import { projectContainerEvents, syncFlowContainers } from '$lib/flowV2Projection';
import { collectSceneCueNames, withSceneCues } from '$lib/sceneCues';
import { soundOptionsFor, withProjectSounds } from '$lib/soundOptions';
import { listComponents } from './componentStorage';
import { loadDoc } from './editorStorage';
import { isAuthoredFlowV2 } from './flowV2Export';
import { loadFlowV2Library } from './flowV2LibraryStorage';
import { loadFlowV2Doc } from './flowV2Storage';
import { loadGameConfigDoc } from './gameConfigStorage';
import { loadSoundsDoc } from './soundsStorage';

export type FlowPublishCheck =
	/** No stored v2 flow (or an empty graph): the game runs the coded path, which since the free-spin
	 *  screens moved into the flow has no free-spin intro or outro. */
	{ status: 'absent' } | { status: 'valid' } | { status: 'invalid'; errors: FlowIssue[] };

/**
 * Validate a v2 FlowDoc against a project's scenes, sound library and function library — pure, so
 * an offline check can run it over scaffold scenes. The doc is cloned before the container sync.
 * `components` are the defs the scenes place, whose own cue names a flow may fire too. `addOns` are
 * the project's Game Config add-ons (`flowAddOnsOf`); absent ⇒ the kind's vocabulary alone.
 */
export function validateFlowV2Against(
	stored: FlowDoc,
	scenes: readonly Scene[],
	sounds: SoundsDoc | null,
	library: FunctionLibraryDoc,
	components: readonly ComponentDef[] = [],
	addOns?: FlowAddOns,
): FlowIssue[] {
	const doc = JSON.parse(JSON.stringify(stored)) as FlowDoc;
	syncFlowContainers(doc, scenes);
	const vocab = withSceneCues(
		withProjectSounds(
			withAddOns(templateVocabulary(doc.templateId), addOns),
			soundOptionsFor(sounds),
		),
		collectSceneCueNames(scenes, components, doc.templateId, addOns),
	);
	return validateFlowDoc(
		doc,
		vocab,
		library,
		projectContainerEvents(doc.containers, scenes),
		collectContainerTaps(doc.containers, scenes),
		scenes.map((s) => s.id),
	);
}

/** {@link validateFlowV2Against} with the project's stored scenes, sounds, Game Config add-ons and
 *  the shipped library. */
export async function validateFlowV2ForProject(
	clientKey: string,
	projectKey: string,
	doc: FlowDoc,
): Promise<FlowIssue[]> {
	const [layout, sounds, library, components, config] = await Promise.all([
		loadDoc(clientKey, projectKey),
		loadSoundsDoc(clientKey, projectKey),
		loadFlowV2Library(),
		listComponents({ projectKey }),
		loadGameConfigDoc(clientKey, projectKey),
	]);
	return validateFlowV2Against(
		doc,
		layout.scenes ?? [],
		sounds,
		library ?? { version: 2, functions: [] },
		components,
		flowAddOnsOf(config),
	);
}

/** The publish-time verdict on a project's stored v2 flow. */
export async function checkFlowV2ForPublish(
	clientKey: string,
	projectKey: string,
): Promise<FlowPublishCheck> {
	const doc = await loadFlowV2Doc(clientKey, projectKey);
	if (!doc || !isAuthoredFlowV2(doc)) return { status: 'absent' };
	const errors = (await validateFlowV2ForProject(clientKey, projectKey, doc)).filter(
		(i) => i.severity === 'error',
	);
	return errors.length ? { status: 'invalid', errors } : { status: 'valid' };
}

/**
 * The verdict on the flow a runtime bundle actually SHIPS — its embedded v2 flow + library, checked
 * against its own scenes and the add-ons of the config it ships (none shipped ⇒ the game runs its
 * compiled config, which carries none). Publish runs this on the bundle it is about to freeze,
 * because the stored-doc check above ran before a ~20s assemble, and an autosave in between would
 * otherwise reach players unvalidated.
 */
export async function checkShippedFlowV2(
	clientKey: string,
	projectKey: string,
	shipped: {
		flowV2?: FlowDoc;
		flowV2Library?: FunctionLibraryDoc;
		scenes: readonly Scene[];
		components?: readonly ComponentDef[];
		config?: GameConfigDoc;
	},
): Promise<FlowPublishCheck> {
	if (!shipped.flowV2) return { status: 'absent' };
	const errors = validateFlowV2Against(
		shipped.flowV2,
		shipped.scenes,
		await loadSoundsDoc(clientKey, projectKey),
		shipped.flowV2Library ?? { version: 2, functions: [] },
		shipped.components,
		flowAddOnsOf(shipped.config),
	).filter((i) => i.severity === 'error');
	return errors.length ? { status: 'invalid', errors } : { status: 'valid' };
}

/**
 * The containers a flow names whose screen its layout does not have (container ids): they draw
 * nothing in-game, and a step waiting on one never continues. Never blocking: an author may be
 * mid-edit. No flow, or no scenes, ⇒ `[]`.
 */
export function flowScreensMissing(flow: FlowDoc | undefined, scenes: readonly Scene[]): string[] {
	if (!flow) return [];
	return containersMissingScene(
		flow.containers,
		scenes.map((s) => s.id),
	).map((c) => c.id);
}

/** One line per error, for a refusal message or a build log. Capped so a wreck stays readable. */
export function describeFlowErrors(errors: FlowIssue[], max = 8): string[] {
	const lines = errors.slice(0, max).map((e) => e.message);
	if (errors.length > max) lines.push(`…and ${errors.length - max} more`);
	return lines;
}

/** The refusal an author sees when a publish or bake stops on an invalid flow. */
export function invalidFlowMessage(errors: FlowIssue[]): string {
	const n = errors.length;
	return (
		`The game's flow has ${n} error${n === 1 ? '' : 's'} (see the Validation panel in ` +
		`Invisible Flow): ${describeFlowErrors(errors, 3).join('; ')}.`
	);
}
