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
 * The vocabulary is composed by the editor's own function (`composeFlowV2Vocab`): the kind's, less
 * what the Game Config's outcome forbids (`withOutcome`), plus the project's Game Config add-ons
 * (`withAddOns`, as the game composes them), plus its sounds and scene cues. It passes no symbols,
 * so the gate never judges a symbol literal: `symbol-not-in-play` is the editor's warning, never a
 * refusal.
 */
import type { CustomElementFx } from 'constants-shared/elementFx';
import {
	containersMissingScene,
	flowTemplateMismatch,
	respinTabIssues,
	spinsTabIssues,
	startupTapIssues,
	docNamesInstance,
	validateFlowDoc,
	type FlowAddOns,
	type FlowDoc,
	type FlowIssue,
	type FunctionLibraryDoc,
} from 'engine-flow-v2';
import {
	collectComponentPins,
	type ComponentDef,
	type GameSettings,
	type Scene,
	type SoundsDoc,
} from 'engine-layout';
import { flowAddOnsOf, resolveOutcome, type GameConfigDoc, type GameOutcome } from 'game-config';
import { collectArmedOnMountTaps, collectContainerTaps } from '$lib/containerTaps';
import {
	instanceDefResolver,
	projectContainerEvents,
	projectFlowInstances,
	projectSpawnLayers,
	syncFlowContainers,
} from '$lib/flowV2Projection';
import { composeFlowV2Vocab } from '$lib/flowV2Vocab';
import { collectElementFxTargets } from '$lib/elementFxTargets';
import { collectSceneCueNames } from '$lib/sceneCues';
import { soundOptionsFor } from '$lib/soundOptions';
import { listComponents, loadComponent } from './componentStorage';
import { loadDoc } from './editorStorage';
import { isAuthoredFlowV2 } from './flowV2Export';
import { loadFlowV2Library } from './flowV2LibraryStorage';
import { loadFlowV2Doc } from './flowV2Storage';
import { loadGameConfigDoc } from './gameConfigStorage';
import { loadSoundsDoc } from './soundsStorage';

export type FlowPublishCheck =
	/** No stored v2 flow (or an empty graph): the game runs the coded path, which since the free-spin
	 *  screens moved into the flow has no free-spin intro or outro. */
	| { status: 'absent' }
	| { status: 'valid'; templateId: string }
	| { status: 'invalid'; templateId: string; errors: FlowIssue[] };

/**
 * Validate a v2 FlowDoc against a project's scenes, sound library and function library — pure, so
 * an offline check can run it over scaffold scenes. The doc is cloned before the container sync.
 * `components` are the defs the scenes place (latest, plus the pinned versions the caller loaded —
 * `withPlacedComponentVersions`), whose own cue names a flow may fire too and whose interfaces the
 * placed instances' Flow nodes are judged against (§6.3). `addOns` are the project's Game Config
 * add-ons (`flowAddOnsOf`); absent ⇒ the kind's vocabulary alone. `customFxKinds` are the custom
 * Element FX the game ships (`custom:<id>`), for the kind dropdown's list.
 */
export function validateFlowV2Against(
	stored: FlowDoc,
	scenes: readonly Scene[],
	sounds: SoundsDoc | null,
	library: FunctionLibraryDoc,
	components: readonly ComponentDef[] = [],
	addOns?: FlowAddOns,
	customFxKinds: readonly string[] = [],
	/** Who decides the game's rounds (`resolveOutcome` of its config); absent ⇒ the RGS. */
	outcome?: GameOutcome,
	/** The layout doc's settings: its post FX cues are fireable too. */
	settings?: Pick<GameSettings, 'postFx'>,
): FlowIssue[] {
	const doc = JSON.parse(JSON.stringify(stored)) as FlowDoc;
	syncFlowContainers(doc, scenes);
	const vocab = composeFlowV2Vocab(doc.templateId, {
		addOns,
		outcome,
		sounds: soundOptionsFor(sounds),
		sceneCues: collectSceneCueNames(scenes, components, doc.templateId, addOns, settings),
		fxTargets: collectElementFxTargets(scenes, components),
		customFxKinds,
	});
	return [
		// First: the refusal names only the first few errors, and this one bricks the game.
		...startupTapIssues(doc, library, collectArmedOnMountTaps(doc.containers, scenes)),
		...validateFlowDoc(
			doc,
			vocab,
			library,
			projectContainerEvents(doc.containers, scenes),
			collectContainerTaps(doc.containers, scenes),
			scenes.map((s) => s.id),
			projectFlowInstances(doc.containers, scenes, instanceDefResolver(components)),
			outcome,
			projectSpawnLayers(doc.containers, scenes, instanceDefResolver(components)),
		),
		...respinTabIssues(doc, addOns),
		...spinsTabIssues(
			doc,
			addOns,
			scenes.map((s) => s.id),
		),
	];
}

/**
 * The project's defs plus the exact VERSIONS its placements pin (`collectComponentPins`), so an
 * instance node is judged against the interface the placement actually renders, not latest — the
 * bundle ships those versions the same way (`resolveReferencedDefs`). A pin the store has lost loads
 * nothing, and the projection then reports it (`instance-missing`).
 */
export async function withPlacedComponentVersions(
	projectKey: string,
	scenes: readonly Scene[],
	components: readonly ComponentDef[],
	doc?: FlowDoc,
): Promise<ComponentDef[]> {
	// A flow with no instance node judges no interface: no extra read, no new way to fail (the
	// no-instance path stays byte-for-byte the pre-7a one). The editor's loader passes its doc too,
	// and re-reads the projection through `/api/flow-v2/instances` (no doc ⇒ every pin resolved)
	// once the first instance node is placed, so a placement pinned below latest gets its exact
	// interface before its first wire.
	if (doc && !docNamesInstance(doc)) return [...components];
	const pins = collectComponentPins(scenes.flatMap((s) => s.nodes ?? [])).filter(
		(pin) => !components.some((def) => def.id === pin.id && def.version === pin.version),
	);
	const pinned = await Promise.all(
		pins.map((pin) => loadComponent(pin.id, projectKey, pin.version)),
	);
	return [...components, ...pinned.filter((def): def is ComponentDef => def !== undefined)];
}

/** {@link validateFlowV2Against} with the project's stored scenes, sounds, Game Config add-ons and
 *  the shipped library. `config` stands in for the stored Game Config when given. */
export async function validateFlowV2ForProject(
	clientKey: string,
	projectKey: string,
	doc: FlowDoc,
	config?: GameConfigDoc | null,
): Promise<FlowIssue[]> {
	const [layout, sounds, library, components, stored] = await Promise.all([
		loadDoc(clientKey, projectKey),
		loadSoundsDoc(clientKey, projectKey),
		loadFlowV2Library(),
		listComponents({ projectKey }),
		config === undefined ? loadGameConfigDoc(clientKey, projectKey) : config,
	]);
	return validateFlowV2Against(
		doc,
		layout.scenes ?? [],
		sounds,
		library ?? { version: 2, functions: [] },
		await withPlacedComponentVersions(projectKey, layout.scenes ?? [], components, doc),
		flowAddOnsOf(stored),
		[],
		resolveOutcome(stored),
		layout.settings,
	);
}

/** The publish-time verdict on a project's stored v2 flow; `config` as in
 *  {@link validateFlowV2ForProject}. */
export async function checkFlowV2ForPublish(
	clientKey: string,
	projectKey: string,
	config?: GameConfigDoc | null,
): Promise<FlowPublishCheck> {
	const doc = await loadFlowV2Doc(clientKey, projectKey);
	if (!doc || !isAuthoredFlowV2(doc)) return { status: 'absent' };
	const errors = (await validateFlowV2ForProject(clientKey, projectKey, doc, config)).filter(
		(i) => i.severity === 'error',
	);
	const { templateId } = doc;
	return errors.length
		? { status: 'invalid', templateId, errors }
		: { status: 'valid', templateId };
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
		/** The shipped layout doc's settings (its post FX cues). */
		settings?: Pick<GameSettings, 'postFx'>;
		components?: readonly ComponentDef[];
		config?: GameConfigDoc;
		/** The custom Element FX the bundle ships. */
		shaderEffects?: readonly CustomElementFx[];
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
		(shipped.shaderEffects ?? []).map((e) => e.spec.kind),
		resolveOutcome(shipped.config),
		shipped.settings,
	).filter((i) => i.severity === 'error');
	const { templateId } = shipped.flowV2;
	return errors.length
		? { status: 'invalid', templateId, errors }
		: { status: 'valid', templateId };
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

/**
 * The refusal for a flow built for another FAMILY of game than the project's kind — what an
 * `/admin` kind change leaves behind (a Book-of flow in an arcade project), or `null`. It validates
 * clean, because validation reads the doc's own `templateId` vocabulary, yet the runtime the kind
 * boots cannot play it. A slot flow in another slot kind is NOT refused: a cluster, scatter or
 * Hold and Win project scaffolded before it had its own seed legitimately carries `bookOf`, and the
 * runtime plays it (`docs/status/flow.md` open item 9).
 */
export function wrongKindFlowMessage(templateId: string, gameType: string): string | null {
	if (!flowTemplateMismatch(templateId, gameType)) return null;
	return (
		`This project's kind is "${gameType}" but its flow is a "${templateId}" flow (left from a ` +
		`kind change). Re-scaffold it in /admin to replace it with the ${gameType} starter flow (the ` +
		`old flow is kept in Invisible Flow's History…), or change the kind back.`
	);
}

/** Why the flow gate refuses a verdict, or `null` — the publish and the bake's export alike. */
export type FlowGateRefusal = {
	reason: 'flow-wrong-kind' | 'invalid-flow';
	message: string;
	details: string[];
};

/**
 * The flow gate's decision on a verdict for a project of kind `gameType`. A flow of the wrong
 * family is refused first and never overridable: there is no game a player could be shown.
 * `allowInvalidFlow` overrides only validation errors.
 */
export function flowGateRefusal(
	check: FlowPublishCheck,
	gameType: string,
	allowInvalidFlow?: boolean,
): FlowGateRefusal | null {
	if (check.status === 'absent') return null;
	const wrongKind = wrongKindFlowMessage(check.templateId, gameType);
	if (wrongKind) return { reason: 'flow-wrong-kind', message: wrongKind, details: [] };
	if (check.status === 'valid' || allowInvalidFlow) return null;
	return {
		reason: 'invalid-flow',
		message: invalidFlowMessage(check.errors),
		details: describeFlowErrors(check.errors),
	};
}
