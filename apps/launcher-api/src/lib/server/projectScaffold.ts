/**
 * Writes the canonical per-project R2 skeleton for a `(client, project)` pair.
 * Idempotent: every key is `HEAD`-checked first and only written when missing,
 * so calling `scaffoldProject` repeatedly safely backfills new seed files
 * without trampling existing data.
 */
import { type GameTemplate, engineOwnedOnly, getFullSceneSet } from 'engine-layout';
import { normalizeDoc } from './localization';
import {
	SUB,
	atlasConfigKey,
	editorDocKey,
	localizationDocKey,
	sheetConfigKey,
} from './projectPaths';
import { projectGameType } from './projects';
import { objectExists, putObjectText } from './r2';
import { loadTemplate, seedScenesFromTemplate } from './templateStorage';

interface Seed {
	key: string;
	body: string;
	contentType: string;
}

function buildSeeds(
	client: string,
	project: string,
	gameType: string,
	template: GameTemplate | undefined,
): Seed[] {
	const atlasConfig = { version: 1, output_prefix: project };
	const sheetConfig = { version: 1 };
	const strings = normalizeDoc({});
	// §19.3: seed the editor doc from the engine-owned projection of the kind's
	// full scene set (correct screens + engine pieces, no artist art) — covers
	// `lines` + `bookOf`. Kinds without a scene set (ways/cluster/scatter today)
	// fall back to the empty template skeleton so nothing regresses.
	const reference = getFullSceneSet(gameType);
	const seededScenes = reference
		? engineOwnedOnly(reference).scenes
		: seedScenesFromTemplate(template);
	const scenes = {
		version: 1,
		projectKey: project,
		gameType: reference ? gameType : template?.gameType,
		scenes: seededScenes,
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
	];
}

/** Write any missing seed files for `(client, project)` into R2. */
export async function scaffoldProject(client: string, project: string): Promise<void> {
	const gameType = await projectGameType(project);
	const template = await loadTemplate(gameType);
	for (const seed of buildSeeds(client, project, gameType, template)) {
		if (await objectExists(seed.key)) continue;
		await putObjectText(seed.key, seed.body, seed.contentType);
	}
}
