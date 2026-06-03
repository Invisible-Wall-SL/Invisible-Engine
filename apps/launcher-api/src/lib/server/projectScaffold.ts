/**
 * Writes the canonical per-project R2 skeleton for a `(client, project)` pair.
 * Idempotent: every key is `HEAD`-checked first and only written when missing,
 * so calling `scaffoldProject` repeatedly safely backfills new seed files
 * without trampling existing data.
 */
import { type GameTemplate } from 'engine-layout';
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

function buildSeeds(client: string, project: string, template: GameTemplate | undefined): Seed[] {
	const atlasConfig = { version: 1, output_prefix: project };
	const sheetConfig = { version: 1 };
	const strings = normalizeDoc({});
	const scenes = {
		version: 1,
		projectKey: project,
		gameType: template?.gameType,
		scenes: seedScenesFromTemplate(template),
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
	const template = await loadTemplate(await projectGameType(project));
	for (const seed of buildSeeds(client, project, template)) {
		if (await objectExists(seed.key)) continue;
		await putObjectText(seed.key, seed.body, seed.contentType);
	}
}
