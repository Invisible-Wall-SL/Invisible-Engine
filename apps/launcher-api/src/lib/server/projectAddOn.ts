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
 *  - **Layout:** the Scene Editor's "＋ Add overlay screens" merge, server-side — only the add-on
 *    screens the layout lacks; a project with no layout yet gets the scaffold's.
 *  - **Flow (opt-in):** the `/flow-v2` "＋ Add overlay steps" graft on a STORED flow. Unauthored, the
 *    coded defaults play, so this is never done unasked.
 *  - **Win Text:** nothing. The doc is sparse: every pot, jackpot and respin line has a coded default
 *    that `/win-text` and Localization already offer once the config has the block, and writing the
 *    defaults in would freeze them as authored copy.
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
	addPotsOverlay,
	flowAddOnsOf,
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
import { scaffoldLayoutDoc } from './projectScaffold';
import { projectGameType } from './projects';
import { ConflictError } from './r2';
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

const meters = (nodes: readonly LayoutNode[], into = new Set<unknown>()): Set<unknown> => {
	for (const node of nodes) {
		into.add(meterOf(node));
		if (node.kind === 'container') meters(node.children, into);
	}
	return into;
};

/**
 * A Hold and Win game already has the overlay's screens; what it lacks is a Pot Meter for each
 * overlay pot beside its own meters. Each missing one is appended to its Pots screen as the
 * reference places it (the screen itself, when the layout has none). Existing nodes are never moved
 * or edited; `added` names each new node.
 */
function mergeMissingPotMeters(
	current: LayoutDoc,
	reference: LayoutDoc,
): { doc: LayoutDoc; added: string[] } {
	const ref = reference.scenes.find((s) => s.id === POTS_SCREEN);
	if (!ref) return { doc: current, added: [] };
	const screen = current.scenes.find((s) => s.id === POTS_SCREEN);
	if (!screen) {
		const scenes = mergeMissingScreens(current.scenes, reference.scenes, [POTS_SCREEN]);
		return { doc: { ...current, scenes }, added: [POTS_SCREEN] };
	}
	const present = meters(screen.nodes);
	const ids = new Set(screen.nodes.map((n) => n.id));
	const missing = ref.nodes.filter((n) => !present.has(meterOf(n)) && !ids.has(n.id));
	if (!missing.length) return { doc: current, added: [] };
	const nodes = [...screen.nodes, ...structuredClone(missing)];
	return {
		doc: {
			...current,
			scenes: current.scenes.map((s) => (s === screen ? { ...screen, nodes } : s)),
		},
		added: missing.map((n) => n.id),
	};
}

/**
 * The layout with the add-on screens it lacks merged in — the Scene Editor's "＋ Add overlay
 * screens", applied to a stored doc; on a Hold and Win game, the Pot Meters its Pots screen lacks
 * ({@link mergeMissingPotMeters}). `current` is not mutated; `added` names what was merged.
 */
export function mergeAddOnScreens(
	current: LayoutDoc,
	gameType: string,
	config: GameConfigDoc,
): { doc: LayoutDoc; added: string[] } {
	const options = sceneSetOptionsFor(gameType, config);
	const reference = getFullSceneSet(gameType, options);
	if (!reference) return { doc: current, added: [] };
	if (gameType === 'holdAndWin') {
		return options.potIds ? mergeMissingPotMeters(current, reference) : { doc: current, added: [] };
	}
	const ids = addOnSceneIds(gameType, options);
	if (!ids.length) return { doc: current, added: [] };
	const scenes = mergeMissingScreens(current.scenes, reference.scenes, ids);
	const added = scenes.filter((s) => !current.scenes.some((c) => c.id === s.id)).map((s) => s.id);
	return { doc: added.length ? { ...current, scenes } : current, added };
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

async function seedLayout(client: string, project: string, config: GameConfigDoc) {
	const kind = await projectGameType(project);
	const { doc, etag, corrupt } = await loadDocWithEtag(client, project, kind);
	if (corrupt) return part('skipped', [], 'The layout could not be read. Open it in /editor.');
	const gameType = doc.gameType ?? kind;
	const options = sceneSetOptionsFor(gameType, config);
	const reference = getFullSceneSet(gameType, options);
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
	const merged = mergeAddOnScreens(doc, gameType, config);
	if (!merged.added.length) return outcome([]);
	await saveDoc(client, project, merged.doc, etag);
	return gameType === 'holdAndWin' && !merged.added.includes(POTS_SCREEN)
		? part('added', merged.added, 'Placed beside the existing pots: arrange them in /editor.')
		: outcome(merged.added);
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
 * carry the block). Idempotent and create-only; each part reports separately.
 */
export async function seedPotsOverlayParts(
	client: string,
	project: string,
	config: GameConfigDoc,
	opts: { flow?: boolean } = {},
): Promise<AddOnSeedReport> {
	const seeds: AddOnSeedReport = {
		symbols: await guarded(() => seedSymbols(client, project, config)),
		layout: await guarded(() => seedLayout(client, project, config)),
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
	opts: { preset?: PotsOverlayPresetId; flow?: boolean } = {},
): Promise<AddOnOutcome> {
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
	const none: AddOnRenames = { symbols: {}, pots: {} };
	if (!opts.preset) {
		if (!resolved.doc.potsOverlay) {
			return { ok: false, status: 400, error: 'This project has no pots overlay yet.' };
		}
		const seeds = await seedPotsOverlayParts(client, project, resolved.doc, opts);
		return { ok: true, configAdded: false, renamed: none, seeds };
	}
	const added = addPotsOverlay(resolved.doc, opts.preset);
	if (!added.ok) return { ok: false, status: 409, error: added.reason };
	let saved: GameConfigDoc;
	try {
		saved = (await saveGameConfigDoc(client, project, added.doc, resolved.etag)).doc;
	} catch (e) {
		if (e instanceof ConflictError) {
			return {
				ok: false,
				status: 409,
				error: 'The Game Config was saved by someone else meanwhile. Run the action again.',
			};
		}
		if (e instanceof InvalidGameConfigError) {
			return { ok: false, status: 400, error: `The config would not save: ${e.message}` };
		}
		throw e;
	}
	const seeds = await seedPotsOverlayParts(client, project, saved, opts);
	return { ok: true, configAdded: true, renamed: added.renamed, seeds };
}
