import { json } from '@sveltejs/kit';
import { planPaytableImport, toImportedPaytable } from 'game-config';
import {
	MAPPINGS,
	linesMapping,
	mapSymbol,
	pickMappingForConfig,
} from 'rgs-translator-eagaming/game-mappings';
import { findCapturedConfig, readMappedPaytable } from 'rgs-translator-eagaming/paytable';
import { requireGameConfigAccess } from '$lib/server/gameConfigAccess';
import { resolveGameConfigDoc } from '$lib/server/gameConfigDefaults';
import { projectGameType } from '$lib/server/projects';
import { fetchServerBootConfig, projectServerGameKeys } from '$lib/server/rgsConfig';
import { loadTestServerManifest } from '$lib/server/testServerManifest';
import { requireProjectScope } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/** The import is a deliberate click, so it can wait longer than the page-load paylines preview. */
const IMPORT_TIMEOUT_MS = 10_000;

/**
 * A declared boot `config`, read the way the facade reads it at boot: names mapped into engine
 * symbols by the mapping the vocabulary picks, rows split per `toImportedPaytable`. `skipped` is
 * planned against the SAVED config (or template); the page re-plans against its live doc.
 * `declared` / `dealt` are what the page keeps as the partner reference when the read came from a
 * pasted capture.
 */
async function readDeclared(
	config: Record<string, unknown>,
	label: string,
	scope: { clientKey: string; projectKey: string },
	game: { gameKey: string; gameKeys: string[] },
): Promise<Response> {
	const { clientKey, projectKey } = scope;
	const serverSymbols = Array.isArray(config.symbols)
		? config.symbols.filter((s): s is string => typeof s === 'string')
		: [];
	const detected = pickMappingForConfig({ symbols: serverSymbols });
	const mapping = detected ?? linesMapping;
	const declared = readMappedPaytable(config, mapping);
	if (!declared) return json({ error: `${label} declares no paytable.` }, { status: 422 });
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
		...game,
		mapping: Object.keys(MAPPINGS).find((name) => MAPPINGS[name] === mapping) ?? 'lines',
		mappingDetected: detected !== null,
		serverSymbols,
		serverNames: Object.fromEntries(serverSymbols.map((s) => [mapSymbol(mapping, s), s])),
		lines,
		scatter,
		skipped,
		declared,
		dealt: [...new Set(serverSymbols.map((s) => mapSymbol(mapping, s)))],
	});
}

/**
 * The paytable a project's published game server DECLARES, in the shape `/config` authors — the
 * source of the page's "Import from server" review. Read-only: nothing is written; the author
 * applies the rows to the page's doc and saves through `PUT /api/game-config` like any edit.
 *
 * `?project=` scopes like the sibling endpoint; `?game=` picks one of `gameKeys` when the project
 * has several published games. The server is read with an empty-body heartbeat (no bet, no round).
 *
 * Every failure is `json({ error }, { status })` so the page can show the cause in the dialog.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = await requireGameConfigAccess(locals);
	const { clientKey, projectKey } = await requireProjectScope(
		user,
		url.searchParams.get('project'),
	);

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
	return readDeclared(
		boot.config,
		`${gameKey}'s server`,
		{ clientKey, projectKey },
		{
			gameKey,
			gameKeys,
		},
	);
};

/**
 * The same review, from a boot `config` a person CAPTURED in a browser on a partner's game and
 * pasted — the partner's edge challenges server-side fetches, so the launcher cannot read it itself.
 * Body: `{ capture }`, the pasted text (or already-parsed JSON). The config is found inside a bare
 * context, the event, a whole response or a sniffer record (`findCapturedConfig`). Nothing is
 * fetched and nothing is written.
 */
export const POST: RequestHandler = async ({ url, locals, request }) => {
	const user = await requireGameConfigAccess(locals);
	const { clientKey, projectKey } = await requireProjectScope(
		user,
		url.searchParams.get('project'),
	);

	let capture: unknown;
	try {
		capture = ((await request.json()) as { capture?: unknown }).capture;
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	if (typeof capture === 'string') {
		try {
			capture = JSON.parse(capture);
		} catch {
			return json(
				{ error: 'The pasted text is not JSON. Paste the response body exactly as captured.' },
				{ status: 400 },
			);
		}
	}
	const config = findCapturedConfig(capture);
	if (!config) {
		return json(
			{
				error:
					'No boot config found in the paste. Capture the response that carries the `config` ' +
					'event (the first request the game makes) and paste its body.',
			},
			{ status: 422 },
		);
	}
	return readDeclared(
		config,
		'The pasted config',
		{ clientKey, projectKey },
		{
			gameKey: 'pasted capture',
			gameKeys: [],
		},
	);
};
