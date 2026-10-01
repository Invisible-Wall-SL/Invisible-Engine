/**
 * Writes the canonical per-project R2 skeleton for a `(client, project)` pair.
 * Idempotent: every key is `HEAD`-checked first and only written when missing,
 * so calling `scaffoldProject` repeatedly safely backfills new seed files
 * without trampling existing data.
 */
import { freshDrivenSeedDoc } from 'engine-flow-v2';
import type { HoldAndWinPresetId } from 'game-config';
import type { LayoutDoc } from 'engine-layout';
import { engineOwnedOnly, getFullSceneSet } from 'engine-layout';
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

function buildSeeds(
	client: string,
	project: string,
	gameType: string,
	reference: LayoutDoc | undefined,
): Seed[] {
	const atlasConfig = { version: 1, output_prefix: project };
	const sheetConfig = { version: 1 };
	const strings = normalizeDoc({});
	// §19.3 / §21.6: seed the editor doc from the engine-owned projection of the
	// kind's full scene set (correct screens + engine pieces, no artist art). The
	// `reference` is resolved by the caller from the built-in registry first, then
	// the custom-kind store; the `?? []` is a defensive default for an unknown /
	// legacy type that resolves to neither.
	const scenes = {
		version: 1,
		projectKey: project,
		gameType,
		scenes: reference ? engineOwnedOnly(reference).scenes : [],
	};

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
	const reference = getFullSceneSet(gameType) ?? (await loadKind(gameType))?.doc;
	for (const seed of buildSeeds(client, project, gameType, reference)) {
		if (await objectExists(seed.key)) continue;
		await putObjectText(seed.key, seed.body, seed.contentType);
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
