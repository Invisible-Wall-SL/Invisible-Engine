/**
 * Writes the canonical per-project R2 skeleton for a `(client, project)` pair.
 * Idempotent: every key is `HEAD`-checked first and only created when missing
 * (`If-None-Match: *`), so calling `scaffoldProject` repeatedly safely backfills new seed files
 * without trampling existing data.
 */
import { freshDrivenSeedDoc } from 'engine-flow-v2';
import type { HoldAndWinPresetId } from 'game-config';
import type { LayoutDoc } from 'engine-layout';
import { engineOwnedOnly, getFullSceneSet } from 'engine-layout';
import { sceneSetOptionsFor } from '$lib/addOns';
import { gameConfigSeedFor } from './gameConfigDefaults';
import { ConflictError, loadGameConfigDocWithEtag, saveGameConfigDoc } from './gameConfigStorage';
import { normalizeDoc } from './localization';
import { loadKind } from './kindStorage';
import {
	SUB,
	atlasConfigKey,
	editorDocKey,
	flowV2DocKey,
	gameConfigDocKey,
	localizationDocKey,
	sheetConfigKey,
	symbolsDocKey,
} from './projectPaths';
import { projectGameType } from './projects';
import { objectExists, putObjectText } from './r2';
import { holdAndWinSymbolsSeed } from './symbolDefaults';
import { saveSymbolsDoc } from './symbolsStorage';

interface Seed {
	key: string;
	body: string;
	contentType: string;
}

/**
 * §19.3 / §21.6: the editor doc a project is seeded with — the engine-owned projection of the kind's
 * full scene set (correct screens + engine pieces, no artist art). The `reference` is resolved by the
 * caller from the built-in registry first, then the custom-kind store; no reference (an unknown or
 * legacy type that resolves to neither) seeds no screens.
 */
export function scaffoldLayoutDoc(
	project: string,
	gameType: string,
	reference: LayoutDoc | undefined,
): Pick<LayoutDoc, 'version' | 'projectKey' | 'gameType' | 'scenes'> {
	return {
		version: 1,
		projectKey: project,
		gameType,
		scenes: reference ? engineOwnedOnly(reference).scenes : [],
	};
}

function buildSeeds(
	client: string,
	project: string,
	gameType: string,
	reference: LayoutDoc | undefined,
): Seed[] {
	const atlasConfig = { version: 1, output_prefix: project };
	const sheetConfig = { version: 1 };
	const strings = normalizeDoc({});
	const scenes = scaffoldLayoutDoc(project, gameType, reference);

	return [
		{
			key: atlasConfigKey(client, project),
			body: JSON.stringify(atlasConfig, null, 2),
			contentType: 'application/json',
		},
		{
			key: `${SUB.manifests(client, project)}/.keep`,
			body: '',
			contentType: 'text/plain; charset=utf-8',
		},
		{
			key: `${SUB.input(client, project)}/refs/.keep`,
			body: '',
			contentType: 'text/plain; charset=utf-8',
		},
		{
			key: sheetConfigKey(client, project),
			body: JSON.stringify(sheetConfig, null, 2),
			contentType: 'application/json',
		},
		{
			key: localizationDocKey(client, project),
			body: JSON.stringify(strings, null, 2),
			contentType: 'application/json',
		},
		{
			key: editorDocKey(client, project),
			body: JSON.stringify(scenes, null, 2),
			contentType: 'application/json',
		},
		// The game type's starter flow — the SAME doc `/flow-v2` opens an unsaved project on. It has to
		// be STORED, not just offered by the editor: the free-spin intro/outro are the flow's screens
		// now, so a project nobody opened in Invisible Flow would publish without them.
		{
			key: flowV2DocKey(client, project),
			body: JSON.stringify(freshDrivenSeedDoc(gameType), null, 2),
			contentType: 'application/json',
		},
	];
}

/**
 * Write any missing seed files for `(client, project)` into R2. `holdAndWinPreset` picks which
 * preset a `holdAndWin` project's Game Config is seeded from (default: Pots).
 */
export async function scaffoldProject(
	client: string,
	project: string,
	opts: { holdAndWinPreset?: HoldAndWinPresetId } = {},
): Promise<void> {
	const gameType = await projectGameType(project);
	// Resolve the reference `LayoutDoc` from the built-in registry first, then the
	// custom-kind store (§21.6). `loadKind` is async, so resolve here (already async)
	// and hand the result to the sync `buildSeeds`.
	// The STORED Game Config shapes the set (a re-scaffold, or a config written before the layout): a
	// respin board that expands reserves the grown area, and an add-on merges in its screens.
	const { doc: stored } = await loadGameConfigDocWithEtag(client, project);
	const reference =
		getFullSceneSet(gameType, sceneSetOptionsFor(gameType, stored)) ??
		(await loadKind(gameType))?.doc;
	// The HEAD skips the PUT in the common case; `If-None-Match: *` closes the window between the two,
	// so an author's first save that lands in it (a re-scaffold of a live project) is never replaced.
	for (const seed of buildSeeds(client, project, gameType, reference)) {
		if (await objectExists(seed.key)) continue;
		try {
			await putObjectText(seed.key, seed.body, seed.contentType, { ifNoneMatch: '*' });
		} catch (e) {
			if (!(e instanceof ConflictError)) throw e;
		}
	}
	// The kind's default Game Config, written through the config store (validated, backed up,
	// `If-None-Match: *`) so a concurrent first save in `/config` wins rather than being clobbered.
	const config = gameConfigSeedFor(gameType, opts.holdAndWinPreset);
	if (config && !(await objectExists(gameConfigDocKey(client, project)))) {
		try {
			await saveGameConfigDoc(client, project, config, null);
		} catch (e) {
			if (!(e instanceof ConflictError)) throw e;
		}
	}
	// Its symbols, from the STORED config — the preset just seeded, or what an older project authored
	// (the /admin Re-scaffold backfill) — create-only, like the config.
	if (gameType === 'holdAndWin' && !(await objectExists(symbolsDocKey(client, project)))) {
		const { doc } = await loadGameConfigDocWithEtag(client, project);
		const symbols = holdAndWinSymbolsSeed(doc);
		if (symbols) {
			try {
				await saveSymbolsDoc(client, project, symbols, null);
			} catch (e) {
				if (!(e instanceof ConflictError)) throw e;
			}
		}
	}
}
