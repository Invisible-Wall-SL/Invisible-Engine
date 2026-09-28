import { json } from '@sveltejs/kit';
import { planPaytableImport, toImportedPaytable } from 'game-config';
import {
	MAPPINGS,
	linesMapping,
	mapSymbol,
	pickMappingForConfig,
} from 'rgs-translator-eagaming/game-mappings';
import { readMappedPaytable } from 'rgs-translator-eagaming/paytable';
import { gameConfigScope, requireGameConfigAccess } from '$lib/server/gameConfigAccess';
import { resolveGameConfigDoc } from '$lib/server/gameConfigDefaults';
import { projectGameType } from '$lib/server/projects';
import { fetchServerBootConfig, projectServerGameKeys } from '$lib/server/rgsConfig';
import { loadTestServerManifest } from '$lib/server/testServerManifest';
import type { RequestHandler } from './$types';

/** The import is a deliberate click, so it can wait longer than the page-load paylines preview. */
const IMPORT_TIMEOUT_MS = 10_000;

/**
 * The paytable a project's published game server DECLARES, in the shape `/config` authors — the
 * source of the page's "Import from server" review. Read-only: nothing is written; the author
 * applies the rows to the page's doc and saves through `PUT /api/game-config` like any edit.
 *
 * `?project=` scopes like the sibling endpoint; `?game=` picks one of `gameKeys` when the project
 * has several published games. The server is read with an empty-body heartbeat (no bet, no round),
 * its names are mapped into engine symbols by the mapping its vocabulary picks — the same pick the
 * facade makes at boot — and `lines` / `scatter` come back per `toImportedPaytable`. `skipped` is
 * planned against the SAVED config (or template); the page re-plans against its live doc.
 *
 * Every failure is `json({ error }, { status })` so the page can show the cause in the dialog.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	await requireGameConfigAccess(locals);
	const { clientKey, projectKey } = await gameConfigScope(url.searchParams.get('project'));

	let gameKeys: string[];
	try {
		gameKeys = await projectServerGameKeys(projectKey, await loadTestServerManifest());
	} catch {
		return json({ error: "Couldn't read the test server's game list." }, { status: 502 });
	}
	if (!gameKeys.length) {
		return json(
			{
				error:
					'This project has no published game, so there is no server to read. Publish it first.',
			},
			{ status: 404 },
		);
	}
	const requested = url.searchParams.get('game');
	const gameKey = requested && gameKeys.includes(requested) ? requested : gameKeys[0];

	const boot = await fetchServerBootConfig(gameKey, IMPORT_TIMEOUT_MS);
	if (!boot.ok) {
		return json({ error: `Couldn't read ${gameKey}'s server: ${boot.reason}.` }, { status: 502 });
	}
	const serverSymbols = Array.isArray(boot.config.symbols)
		? boot.config.symbols.filter((s): s is string => typeof s === 'string')
		: [];
	const detected = pickMappingForConfig({ symbols: serverSymbols });
	const mapping = detected ?? linesMapping;
	const declared = readMappedPaytable(boot.config, mapping);
	if (!declared) {
		return json({ error: `${gameKey}'s server declares no paytable.` }, { status: 422 });
	}
	const { lines, scatter } = toImportedPaytable(declared);

	let skipped: string[];
	try {
		const doc = await resolveGameConfigDoc(
			clientKey,
			projectKey,
			await projectGameType(projectKey),
		);
		skipped = doc
			? planPaytableImport(doc.symbols, { lines, scatter }).skipped
			: Object.keys(lines);
	} catch {
		return json({ error: "Couldn't load this project's saved config." }, { status: 502 });
	}

	return json({
		gameKey,
		gameKeys,
		mapping: Object.keys(MAPPINGS).find((name) => MAPPINGS[name] === mapping) ?? 'lines',
		mappingDetected: detected !== null,
		serverSymbols,
		serverNames: Object.fromEntries(serverSymbols.map((s) => [mapSymbol(mapping, s), s])),
		lines,
		scatter,
		skipped,
	});
};
