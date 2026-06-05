import { error, json } from '@sveltejs/kit';
import {
	validateManifestAgainstGame,
	type AtlasManifestShape,
	type GameFrames,
} from '$lib/server/atlasManifestCheck';
import { SUB } from '$lib/server/projectPaths';
import { getObjectText } from '$lib/server/r2';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Validate a project's Atlas Maker manifest against the AUTHORITATIVE game config
 * (the committed TexturePacker sheet deployed under `deploy/`). Returns a drift
 * report: `missing` keys are the ones the game needs but the manifest lacks →
 * blank symbols in-game (the failure this endpoint exists to surface).
 *
 * Auth + role gated like the other scoped tool endpoints (`atlasTool`); the
 * active `(client, project)` is SESSION-bound, never a request param. The query
 * supplies only the sheet `name` (e.g. `symbolsStatic`).
 */
function pickString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'atlasTool',
		forbiddenMessage: 'Your role does not have access to the Invisible Atlas Maker.',
	});

	const name = url.searchParams.get('name');
	if (!name || !/^[A-Za-z0-9_-]+$/.test(name)) {
		throw error(400, 'missing or invalid name');
	}

	const manifestKey = `${SUB.manifests(clientKey, projectKey)}/atlas_manifest_${name}.json`;
	const manifestText = await getObjectText(manifestKey);
	if (!manifestText) throw error(404, `No atlas manifest for "${name}" in this project.`);

	let manifest: AtlasManifestShape;
	try {
		manifest = JSON.parse(manifestText) as AtlasManifestShape;
	} catch {
		throw error(422, 'Atlas manifest is not valid JSON.');
	}

	// The game's TexturePacker sheet lives under deploy/, mirroring the game's
	// `static/assets/` layout: `deploy/<deploy_path>/<basename>.json`. `deploy_path`
	// defaults to flat deploy/, `deploy_basename` defaults to the sheet name.
	const m = manifest as Record<string, unknown>;
	const deployPath = (pickString(m.deploy_path) ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
	const basename = pickString(m.deploy_basename) ?? name;
	const deployBase = SUB.deploy(clientKey, projectKey);
	const gameSheetKey = deployPath
		? `${deployBase}/${deployPath}/${basename}.json`
		: `${deployBase}/${basename}.json`;

	const gameText = await getObjectText(gameSheetKey);
	if (!gameText) {
		throw error(404, `No deployed game sheet at ${gameSheetKey}. Deploy the atlas first.`);
	}

	let gameFrames: GameFrames;
	try {
		const parsed = JSON.parse(gameText) as { frames?: unknown };
		gameFrames = (parsed.frames ?? {}) as GameFrames;
	} catch {
		throw error(422, 'Deployed game sheet is not valid JSON.');
	}

	const report = validateManifestAgainstGame(manifest, gameFrames);
	return json({ name, manifestKey, gameSheetKey, ...report });
};
