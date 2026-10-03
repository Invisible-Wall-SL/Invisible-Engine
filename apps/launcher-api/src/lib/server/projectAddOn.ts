/**
 * The Game Maker's pots overlay ADD-ON (docs/design/pots-overlay.md §4, Game Maker row): the
 * `potsOverlay` block merged into a project's Game Config, then the parts a playable overlay needs
 * seeded into the project's other docs — CREATE-ONLY, never overwriting anything authored.
 *
 * Each doc is its own conditional write (`If-Match` the ETag it was read with, or
 * `If-None-Match: *` when absent; docs/design/multi-user-concurrency.md). The config goes first: it
 * is the source of truth every other part is derived from. A later part that loses its race is
 * reported, not retried, and the seeds are idempotent, so running the action again on a project
 * that already has the overlay fills in only what is still missing.
 *
 * What is seeded:
 *  - **Symbols:** placeholder art for every token and, when the Hold and Win block is the overlay's
 *    bonus, its role symbols ({@link potsOverlaySymbolsSeed}).
 *  - **Layout:** the Scene Editor's "＋ Add overlay screens" merge, server-side, on the run that adds
 *    the config — only the add-on screens the layout lacks; a project with no layout yet gets the
 *    scaffold's. Every run adds a Pot Meter for a pot that has none on any screen.
 *  - **Flow (opt-in):** the `/flow-v2` "＋ Add overlay steps" graft on a STORED flow. Unauthored, the
 *    coded defaults play, so this is never done unasked.
 *  - **Win Text:** nothing. The doc is sparse: every pot, jackpot and respin line has a coded default
 *    that `/win-text` and Localization already offer once the config has the block, and writing the
 *    defaults in would freeze them as authored copy.
 *
 * Nothing is written while another session holds an edit lease on a doc it would write
 * ({@link leaseBlocker}).
 */
import { graftAddOnSteps } from 'engine-flow-v2';
import {
	addOnSceneIds,
	getFullSceneSet,
	mergeMissingScreens,
	type LayoutDoc,
	type LayoutNode,
} from 'engine-layout';
import {
	POTS_OVERLAY_PRESET_IDS,
	addPotsOverlay,
	flowAddOnsOf,
	gameConfigErrors,
	normalizeGameConfigDoc,
	type AddOnRenames,
	type GameConfigDoc,
	type PotsOverlayPresetId,
} from 'game-config';
import { sceneSetOptionsFor } from '$lib/addOns';
import { TOOLS } from '$lib/roles';
import type {
	AddOnOutcome,
	AddOnPart,
	AddOnPartStatus,
	AddOnSeedReport,
} from '$lib/potsOverlayAddOn';
import { loadDocWithEtag, saveDoc } from './editorStorage';
import { loadFlowV2DocWithEtag, saveFlowV2Doc } from './flowV2Storage';
import { resolveGameConfig } from './gameConfigDefaults';
import { InvalidGameConfigError, saveGameConfigDoc } from './gameConfigStorage';
import { liveLeases, type LiveLease } from './lease';
import { scaffoldLayoutDoc } from './projectScaffold';
import { projectGameType } from './projects';
import { ConflictError } from './r2';
import { invalidateRuntimeBundle } from './runtimeBundleCache';
import { potsOverlaySymbolsSeed } from './symbolDefaults';
import { loadSymbolsDocWithEtag, saveSymbolsDoc } from './symbolsStorage';

export type { AddOnOutcome, AddOnPart, AddOnPartStatus, AddOnSeedReport };

/**
 * The tools that own the docs the add-on writes — the Game Config, Symbols and the Scene Editor,
 * plus Flow when the graft is asked for — that `hasTool` does not grant, by name. The Game Maker
 * grant alone must not reach a doc its own tool would refuse.
 */
export function addOnToolsMissing(hasTool: (tool: string) => boolean, flow: boolean): string[] {
	const needed = ['gameConfig', 'symbols', 'editor', ...(flow ? ['flow'] : [])];
	return needed.filter((tool) => !hasTool(tool)).map((tool) => TOOLS[tool]?.name ?? tool);
}

/**
 * The presets that add cleanly to `doc`: the add is not refused and the result has no validator
 * error. A preset that does not fit the game (3 Pots names specials a Classic Hold and Win game
 * lacks) is not offered rather than refused after the click. Empty once the overlay is there.
 */
export function cleanOverlayPresets(doc: GameConfigDoc | null): PotsOverlayPresetId[] {
	if (!doc) return [];
	return POTS_OVERLAY_PRESET_IDS.filter((id) => {
		const result = addPotsOverlay(doc, id);
		if (!result.ok) return false;
		const next = normalizeGameConfigDoc(result.doc);
		return next !== null && next !== undefined && !gameConfigErrors(next).length;
	});
}

const part = (status: AddOnPartStatus, added: string[] = [], note?: string): AddOnPart => ({
	status,
	added,
	...(note ? { note } : {}),
});

/** `added` when there is something new to write, `present` when there is not. */
const outcome = (added: string[]): AddOnPart => part(added.length ? 'added' : 'present', added);

/** A part's write, with a lost race and any other failure reported rather than thrown. */
async function guarded(write: () => Promise<AddOnPart>): Promise<AddOnPart> {
	try {
		return await write();
	} catch (e) {
		if (e instanceof ConflictError) {
			return part('conflict', [], 'Someone saved it meanwhile. Run the action again.');
		}
		console.error('pots overlay add-on seed failed:', e);
		return part('failed', [], e instanceof Error ? e.message : String(e));
	}
}

const POTS_SCREEN = 'pots';

/** The pot a node draws, if it is a Pot Meter. */
const meterOf = (node: LayoutNode): unknown =>
	node.kind === 'componentInstance' && node.componentId === 'potMeter'
		? node.params?.meter
		: undefined;

/** Every node of `nodes`, containers' children included. */
function* allNodes(nodes: readonly LayoutNode[]): Generator<LayoutNode> {
	for (const node of nodes) {
		yield node;
		if (node.kind === 'container') yield* allNodes(node.children);
	}
}

/** The pots that have a Pot Meter on ANY screen — an author may move one off the Pots screen. */
const meteredPots = (scenes: LayoutDoc['scenes']): Set<unknown> =>
	new Set(scenes.flatMap((scene) => [...allNodes(scene.nodes)].map(meterOf)));

/** `wanted`, or the first `wanted-2`, `wanted-3`… no node of the layout uses. */
function freeNodeId(scenes: LayoutDoc['scenes'], wanted: string): string {
	const ids = new Set(scenes.flatMap((scene) => [...allNodes(scene.nodes)].map((n) => n.id)));
	let id = wanted;
	for (let n = 2; ids.has(id); n++) id = `${wanted}-${n}`;
	return id;
}

export type AddOnLayoutMerge = { doc: LayoutDoc; added: string[]; note?: string };

/**
 * The add-on's screens and Pot Meters merged into a stored layout. `current` is not mutated;
 * `added` names each screen and each Pot Meter node merged.
 *
 * - **`screens`** (the run that adds the config): the Scene Editor's "＋ Add overlay screens" — the
 *   add-on screens the layout lacks; on a Hold and Win game, which has them, only a missing Pots
 *   screen. The Pots screen is skipped when every pot already has a meter somewhere, and a merged
 *   one carries only the pots that have none.
 * - **Always:** a Pot Meter for each pot with no meter on ANY screen, appended to the Pots screen as
 *   the reference places it. Without a Pots screen, nothing, and `note` says so.
 *
 * A re-run passes `screens: false`, so a screen the author deleted is never revived; only a pot left
 * without any meter gets one.
 */
export function mergeAddOnScreens(
	current: LayoutDoc,
	gameType: string,
	config: GameConfigDoc,
	{ screens }: { screens: boolean },
): AddOnLayoutMerge {
	const options = sceneSetOptionsFor(gameType, config);
	const reference = getFullSceneSet(gameType, options);
	const refPots = reference?.scenes.find((s) => s.id === POTS_SCREEN);
	if (!reference) return { doc: current, added: [] };
	const before = meteredPots(current.scenes);
	const unmetered = (options.potIds ?? []).filter((id) => !before.has(id));
	const added: string[] = [];
	let scenes = current.scenes;

	if (screens) {
		const hasPots = scenes.some((s) => s.id === POTS_SCREEN);
		const ids = (
			gameType === 'holdAndWin'
				? refPots && !hasPots
					? [POTS_SCREEN]
					: []
				: addOnSceneIds(gameType, options)
		).filter((id) => id !== POTS_SCREEN || unmetered.length > 0);
		const merged = mergeMissingScreens(scenes, reference.scenes, ids);
		scenes = merged.map((scene) =>
			scene.id === POTS_SCREEN && !hasPots
				? { ...scene, nodes: scene.nodes.filter((n) => !before.has(meterOf(n))) }
				: scene,
		);
		added.push(
			...scenes.filter((s) => !current.scenes.some((c) => c.id === s.id)).map((s) => s.id),
		);
	}

	const metered = meteredPots(scenes);
	const missing = (refPots?.nodes ?? []).filter((n) => {
		const meter = meterOf(n);
		return meter !== undefined && !metered.has(meter);
	});
	let note: string | undefined;
	if (missing.length) {
		const screen = scenes.find((s) => s.id === POTS_SCREEN);
		if (screen) {
			const nodes = [...screen.nodes];
			for (const node of missing) {
				const id = freeNodeId(scenes, node.id);
				nodes.push({ ...structuredClone(node), id });
				added.push(id);
			}
			scenes = scenes.map((s) => (s === screen ? { ...screen, nodes } : s));
			note = 'New Pot Meters are placed beside the existing pots: arrange them in /editor.';
		} else {
			note = `No Pots screen holds the pots ${missing.map(meterOf).join(', ')}: add a Pot Meter for each in /editor.`;
		}
	}
	return { doc: added.length ? { ...current, scenes } : current, added, ...(note ? { note } : {}) };
}

/** A doc the add-on writes, by the lease its own tool takes on it (`LeaseState` on each page). */
type LeaseTarget = { toolId: string; docKey: string; path: string };

const ADD_ON_LEASE_TARGETS: readonly LeaseTarget[] = [
	{ toolId: 'gameConfig', docKey: 'gameConfig', path: '/config' },
	{ toolId: 'symbols', docKey: 'symbols', path: '/symbols' },
	{ toolId: 'editor', docKey: 'editor', path: '/editor' },
];
const FLOW_LEASE_TARGET: LeaseTarget = { toolId: 'flow', docKey: 'flow', path: '/flow-v2' };

const leaseTargets = (flow: boolean): readonly LeaseTarget[] =>
	flow ? [...ADD_ON_LEASE_TARGETS, FLOW_LEASE_TARGET] : ADD_ON_LEASE_TARGETS;

/**
 * Who stops the add-on: the first live lease on a doc it writes held by ANOTHER session, as
 * "<who> is editing <path>". The caller's own tabs never block it. `null` ⇒ write. Pure.
 */
export function leaseBlocker(
	leases: readonly LiveLease[],
	mySessionId: string,
	targets: readonly LeaseTarget[],
): string | null {
	for (const target of targets) {
		const held = leases.find(
			(l) =>
				l.toolId === target.toolId &&
				l.docKey === target.docKey &&
				l.holderSessionId !== mySessionId,
		);
		if (held) {
			return `${held.holderName ?? 'Someone'} is editing ${target.path} for this project. Try again once they close it.`;
		}
	}
	return null;
}

async function seedSymbols(client: string, project: string, config: GameConfigDoc) {
	const { doc, etag, corrupt } = await loadSymbolsDocWithEtag(client, project);
	if (corrupt)
		return part('skipped', [], 'The Symbols doc could not be read. Open it in /symbols.');
	const seed = potsOverlaySymbolsSeed(config, doc);
	const note = seed.missingArt.length
		? `No placeholder art for ${seed.missingArt.join(', ')}: bind it in /symbols.`
		: undefined;
	if (!seed.added.length) return part(note ? 'skipped' : 'present', [], note);
	await saveSymbolsDoc(client, project, seed.doc, etag);
	return part('added', seed.added, note);
}

async function seedLayout(
	client: string,
	project: string,
	config: GameConfigDoc,
	screens: boolean,
) {
	const kind = await projectGameType(project);
	const { doc, etag, corrupt } = await loadDocWithEtag(client, project, kind);
	if (corrupt) return part('skipped', [], 'The layout could not be read. Open it in /editor.');
	const gameType = doc.gameType ?? kind;
	const reference = getFullSceneSet(gameType, sceneSetOptionsFor(gameType, config));
	if (!reference) {
		return part(
			'skipped',
			[],
			'This kind has no built-in scene set: add the overlay screens in /editor.',
		);
	}
	if (etag === null) {
		const seeded = { ...doc, ...scaffoldLayoutDoc(project, gameType, reference) };
		await saveDoc(client, project, seeded, null);
		return part(
			'added',
			seeded.scenes.map((s) => s.id),
		);
	}
	const merged = mergeAddOnScreens(doc, gameType, config, { screens });
	if (merged.added.length) await saveDoc(client, project, merged.doc, etag);
	return merged.added.length
		? part('added', merged.added, merged.note)
		: part(merged.note ? 'skipped' : 'present', [], merged.note);
}

async function graftFlow(client: string, project: string, config: GameConfigDoc) {
	const { doc, etag } = await loadFlowV2DocWithEtag(client, project);
	if (!doc) {
		return part(
			'skipped',
			[],
			etag === null
				? 'The project has no stored flow, so the coded defaults play the overlay.'
				: 'The stored flow could not be read. Open it in /flow-v2.',
		);
	}
	const graft = graftAddOnSteps(doc, flowAddOnsOf(config));
	if (graft.added.length) await saveFlowV2Doc(client, project, graft.doc, etag);
	return outcome(graft.added);
}

/**
 * Seed every part an overlay needs that the project does not have yet, from `config` (which must
 * carry the block). Idempotent and create-only; each part reports separately. The layout's screens
 * are merged only with `configAdded` (the run that adds the overlay); a re-run fills in only Pot
 * Meters, so a screen the author deleted since stays deleted ({@link mergeAddOnScreens}).
 */
export async function seedPotsOverlayParts(
	client: string,
	project: string,
	config: GameConfigDoc,
	opts: { flow?: boolean; configAdded?: boolean } = {},
): Promise<AddOnSeedReport> {
	const seeds: AddOnSeedReport = {
		symbols: await guarded(() => seedSymbols(client, project, config)),
		layout: await guarded(() => seedLayout(client, project, config, opts.configAdded === true)),
		winText: part(
			'present',
			[],
			'The pot lines play their coded defaults. Name the pots in /win-text to change them.',
		),
	};
	if (opts.flow) seeds.flow = await guarded(() => graftFlow(client, project, config));
	return seeds;
}

/**
 * Add the pots overlay preset `preset` to the project, then seed its parts. Without a preset, the
 * project must already have the overlay, and only its missing parts are seeded — the re-run after
 * a conflict.
 *
 * The config is the project's RESOLVED one: a project that never saved `/config` gets its kind's
 * template with the overlay merged in, stored as its first authored config.
 */
export async function applyPotsOverlayAddOn(
	client: string,
	project: string,
	opts: { preset?: PotsOverlayPresetId; flow?: boolean; sessionId: string },
): Promise<AddOnOutcome> {
	const flow = opts.flow === true;
	const gameType = await projectGameType(project);
	const resolved = await resolveGameConfig(client, project, gameType);
	if (!resolved.doc) {
		return { ok: false, status: 400, error: 'This project has no Game Config to add to.' };
	}
	// A stored config that does not parse resolves to the TEMPLATE with the stored object's ETag, so
	// its `If-Match` would pass and replace the author's config with the template. Never unasked.
	if (resolved.source === 'template' && resolved.etag !== null) {
		return {
			ok: false,
			status: 409,
			error: 'The stored Game Config could not be read. Open it in /config first.',
		};
	}
	// An author with one of these docs open would only meet the change as a refused save, so nothing
	// is written while anyone else holds a lease on one. `If-Match` stays the floor behind it.
	const targets = leaseTargets(flow);
	const editing = leaseBlocker(
		await liveLeases(
			targets.map(({ toolId, docKey }) => ({
				toolId,
				docKey,
				clientKey: client,
				projectKey: project,
			})),
		),
		opts.sessionId,
		targets,
	);
	if (editing) return { ok: false, status: 409, error: editing };

	const none: AddOnRenames = { symbols: {}, pots: {} };
	if (!opts.preset) {
		if (!resolved.doc.potsOverlay) {
			return { ok: false, status: 400, error: 'This project has no pots overlay yet.' };
		}
		const seeds = await seedPotsOverlayParts(client, project, resolved.doc, { flow });
		if (Object.values(seeds).some((p) => p?.status === 'added')) invalidateRuntimeBundle(project);
		return { ok: true, configAdded: false, renamed: none, seeds };
	}
	const added = addPotsOverlay(resolved.doc, opts.preset);
	if (!added.ok) return { ok: false, status: 409, error: added.reason };
	let saved: GameConfigDoc;
	try {
		// `always`: the bytes before the overlay are a restore point in /config's backups.
		saved = (await saveGameConfigDoc(client, project, added.doc, resolved.etag, 'always')).doc;
	} catch (e) {
		if (e instanceof ConflictError) {
			return {
				ok: false,
				status: 409,
				error: 'The Game Config was saved by someone else meanwhile. Run the action again.',
			};
		}
		if (e instanceof InvalidGameConfigError) {
			const first = e.issues.find((i) => i.severity === 'error') ?? e.issues[0];
			return {
				ok: false,
				status: 400,
				error: `This preset doesn't fit this game${first ? `: ${first.message}` : '.'}`,
			};
		}
		throw e;
	}
	const seeds = await seedPotsOverlayParts(client, project, saved, { flow, configAdded: true });
	// The config is an input to the runtime bundle, so a live game picks the overlay up at once.
	invalidateRuntimeBundle(project);
	return { ok: true, configAdded: true, renamed: added.renamed, seeds };
}
