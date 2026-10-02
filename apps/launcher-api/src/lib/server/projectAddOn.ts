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
import { addOnSceneIds, getFullSceneSet, mergeMissingScreens, type LayoutDoc } from 'engine-layout';
import {
	addPotsOverlay,
	flowAddOnsOf,
	type AddOnRenames,
	type GameConfigDoc,
	type PotsOverlayPresetId,
} from 'game-config';
import { sceneSetOptionsFor } from '$lib/addOns';
import { loadDocWithEtag, saveDoc } from './editorStorage';
import { loadFlowV2DocWithEtag, saveFlowV2Doc } from './flowV2Storage';
import { resolveGameConfig } from './gameConfigDefaults';
import { InvalidGameConfigError, saveGameConfigDoc } from './gameConfigStorage';
import { scaffoldLayoutDoc } from './projectScaffold';
import { projectGameType } from './projects';
import { ConflictError } from './r2';
import { potsOverlaySymbolsSeed } from './symbolDefaults';
import { loadSymbolsDocWithEtag, saveSymbolsDoc } from './symbolsStorage';

/**
 * - `added`: written now (`added` names what);
 * - `present`: the doc already had every part;
 * - `conflict`: someone saved the doc between this read and its write — run the action again;
 * - `skipped`: nothing could be written (`note` says why);
 * - `failed`: the write threw (`note` carries the error).
 */
export type AddOnPartStatus = 'added' | 'present' | 'conflict' | 'skipped' | 'failed';

export type AddOnPart = { status: AddOnPartStatus; added: string[]; note?: string };

export type AddOnSeedReport = {
	symbols: AddOnPart;
	layout: AddOnPart;
	winText: AddOnPart;
	/** Present only when the graft was asked for. */
	flow?: AddOnPart;
};

export type AddOnOutcome =
	| { ok: true; configAdded: boolean; renamed: AddOnRenames; seeds: AddOnSeedReport }
	| { ok: false; status: 400 | 409; error: string };

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

/**
 * The layout with the add-on screens it lacks merged in — the Scene Editor's "＋ Add overlay
 * screens", applied to a stored doc. `current` is not mutated; `added` names the merged screens.
 */
export function mergeAddOnScreens(
	current: LayoutDoc,
	gameType: string,
	config: GameConfigDoc,
): { doc: LayoutDoc; added: string[] } {
	const options = sceneSetOptionsFor(gameType, config);
	const reference = getFullSceneSet(gameType, options);
	const ids = addOnSceneIds(gameType, options);
	if (!reference || !ids.length) return { doc: current, added: [] };
	const scenes = mergeMissingScreens(current.scenes, reference.scenes, ids);
	const added = scenes.filter((s) => !current.scenes.some((c) => c.id === s.id)).map((s) => s.id);
	return { doc: added.length ? { ...current, scenes } : current, added };
}

async function seedSymbols(client: string, project: string, config: GameConfigDoc) {
	const { doc, etag } = await loadSymbolsDocWithEtag(client, project);
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
	const { doc, etag } = await loadDocWithEtag(client, project, kind);
	const gameType = doc.gameType ?? kind;
	const options = sceneSetOptionsFor(gameType, config);
	if (!addOnSceneIds(gameType, options).length) {
		return gameType === 'holdAndWin'
			? part(
					'present',
					[],
					'A Hold and Win game has the Pots screen already: add a Pot Meter for each new pot in /editor.',
				)
			: part(
					'skipped',
					[],
					'This kind has no built-in scene set: add the overlay screens in /editor.',
				);
	}
	if (etag === null) {
		const reference = getFullSceneSet(gameType, options);
		const seeded = { ...doc, ...scaffoldLayoutDoc(project, gameType, reference) };
		await saveDoc(client, project, seeded, null);
		return part(
			'added',
			seeded.scenes.map((s) => s.id),
		);
	}
	const merged = mergeAddOnScreens(doc, gameType, config);
	if (merged.added.length) await saveDoc(client, project, merged.doc, etag);
	return outcome(merged.added);
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
