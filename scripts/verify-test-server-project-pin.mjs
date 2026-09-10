// Offline fixture for THE PROJECT PIN — the field that tells the Invisible Test Server which
// launcher project a published game's math belongs to.
//
//   node scripts/verify-test-server-project-pin.mjs
//
// WHY THIS EXISTS. The test server stopped trusting the frozen `grid` snapshot in
// `test_server/games.json` and started PULLING each game's live math contract from
// `GET <docBase>/api/game-config/mock?project=…&k=…`. It asked for `project=<gameKey>`, which is
// right only because the ONLINE Game Maker publishes under `key = projectKey`. Every
// desktop-launcher title names its own key, so the live `waysofwavesbuild` (project `test6`) asked
// for a project called `waysofwavesbuild`, was refused, and fell back to this mock's built-in 5×3
// Hot Fruits default — 7 line symbols + scatter, 5 paylines — while its client drew the stepped
// 5×[3,4,4,4,4] `ways` board `test6` authored. Neither of the two bugs that surfaced looked
// anything like a manifest problem:
//
//   - an out-of-dictionary symbol landed with placeholder art (`PIC7` → `L5`, which `/config` does
//     not declare and `/symbols` only had a stale mock-up row for);
//   - the bottom row never exploded, because with the server dealing 3 rows into a 4-row window the
//     client's last visible row WAS the facade's bottom padding row — and every "the last strip
//     entry is off-screen buffer" guard in the engine correctly skipped it.
//
// WHAT IT PROVES.
//
//   1. THE URL, over the REAL `refreshContract` sliced out of `services/test-server/server.mjs` and
//      run against a stub `fetch`. The project asked for is the ENTRY'S `projectKey`; a game
//      without one still asks under its game key (the parity case — every online-published game);
//      and a game with no pointer at all is not asked for at all, but SAYS so, once.
//   2. THE MANIFEST MERGE in `apps/launcher-api/scripts/publish-game-bundle.mjs`: re-publishing a
//      bundle must not blank a pointer the online publisher wrote, and must add one when told.
//   3. THE TWO WRITERS AGREE with the reader on the field name — a typo here is silent, because
//      every consumer treats an absent pin as "fall back to the game key".

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The repo checks out CRLF on Windows; every slice marker below is written with `\n`.
const read = (path) => readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n');

let failures = 0;
let ran = 0;
/** `await`s the body, so an ASYNC check that rejects fails instead of printing a ✓ and resolving
 *  into an unhandled rejection — which is exactly what the first draft of this file did. */
const check = async (label, fn) => {
	ran += 1;
	try {
		await fn();
		console.info(`  ✓ ${label}`);
	} catch (e) {
		failures += 1;
		console.error(`  ✗ ${label}\n      ${e.message}`);
	}
};
const eq = (actual, expected, what) => {
	const a = JSON.stringify(actual);
	const b = JSON.stringify(expected);
	if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`);
};

/** Slice one top-level declaration out of a source file by its opening marker and closing line. */
const sliceBetween = (source, label, start, end) => {
	const from = source.indexOf(start);
	if (from === -1) throw new Error(`could not find '${label}' (marker: ${start})`);
	const to = source.indexOf(end, from);
	if (to === -1) throw new Error(`could not find the end of '${label}' (marker: ${end})`);
	return source.slice(from, to + end.length);
};

const server = read('services/test-server/server.mjs');
const publisher = read('apps/launcher-api/scripts/publish-game-bundle.mjs');

// ---------- 1. the URL the live pull actually asks for ----------

// The REAL function, not a restatement of it: a fixture that hand-rolled the URL would prove the
// fixture. Everything it closes over is injected below.
const refreshSource = sliceBetween(
	server,
	'refreshContract',
	'async function refreshContract(',
	'\n}\n',
);
// From the `unpinnedWarned` Set, not from `warnUnpinned` itself: the once-per-game latch IS half of
// what this asserts, and slicing the arrow alone left the Set undeclared in the harness scope.
const warnSource = sliceBetween(
	server,
	'warnUnpinned',
	'const unpinnedWarned = new Set();',
	'\n};\n',
);

const harness = async (entry, calls = 1) => {
	const asked = [];
	const warned = [];
	const registry = { waysofwavesbuild: entry };
	const scope = {
		registry,
		contracts: {},
		own: (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined),
		CONTRACT_TTL_MS: 10_000,
		CONTRACT_TIMEOUT_MS: 4_000,
		// The contract the launcher would answer with for `test6` — the real shape, so a fingerprint
		// mismatch drives `swapMock` exactly as it would in the service.
		fetch: async (url) => {
			asked.push(url);
			return {
				ok: true,
				json: async () => ({
					projectKey: 'test6',
					protocol: 'ways',
					cascade: true,
					grid: { reels: 5, rows: 4, rowsPerReel: [3, 4, 4, 4, 4], paylines: [] },
				}),
			};
		},
		normalizeContract: (raw, fallback) => ({
			protocol: raw?.protocol ?? fallback,
			cascade: raw?.cascade,
			grid: raw?.grid ?? null,
		}),
		fingerprintOf: (c) => JSON.stringify([c.protocol, c.cascade ?? null, c.grid ?? null]),
		swapMock: () => {},
		console: { info: () => {}, warn: (m) => warned.push(m) },
		AbortSignal: { timeout: () => undefined },
	};
	const keys = Object.keys(scope);
	// `calls` repeats INSIDE one scope, because the once-per-game latch lives in a module-level Set:
	// calling `harness` twice would build two scopes and two Sets, and prove nothing about it.
	const body =
		`${warnSource}\n${refreshSource}\n` +
		`for (let i = 0; i < ${calls}; i += 1) await refreshContract('waysofwavesbuild');`;
	const run = new Function(...keys, `return (async () => { ${body} })();`);
	await run(...keys.map((k) => scope[k]));
	return { asked, warned };
};

console.info('the live contract pull');

await check('a pinned game is read under its PROJECT key, not its game key', async () => {
	const { asked } = await harness({
		protocol: 'lines',
		projectKey: 'test6',
		docBase: 'https://app.invisiblewall.org',
		readToken: 'tok',
		fingerprint: 'stale',
	});
	eq(asked.length, 1, 'one fetch');
	if (!asked[0].includes('project=test6')) {
		throw new Error(`asked the wrong project: ${asked[0]}`);
	}
	if (asked[0].includes('project=waysofwavesbuild')) {
		throw new Error('still asking under the game key');
	}
});

await check('an unpinned-but-pointed game keeps asking under its game key (parity)', async () => {
	// Every game the online Game Maker published: `key === projectKey`, no `projectKey` field
	// needed, and this must behave exactly as it did before the field existed.
	const { asked } = await harness({
		protocol: 'lines',
		projectKey: null,
		docBase: 'https://app.invisiblewall.org',
		readToken: 'tok',
		fingerprint: 'stale',
	});
	eq(asked.length, 1, 'one fetch');
	if (!asked[0].includes('project=waysofwavesbuild')) {
		throw new Error(`lost the game-key fallback: ${asked[0]}`);
	}
});

await check('a game with no pointer is never fetched — and says so exactly once', async () => {
	// Three calls, because this runs on the RGS PATH: a warning per spin would bury the one that
	// matters as thoroughly as no warning at all.
	const { asked, warned } = await harness(
		{ protocol: 'lines', projectKey: null, docBase: null, readToken: null },
		3,
	);
	eq(asked.length, 0, 'no fetch without a pointer');
	eq(warned.length, 1, 'exactly one warning across three calls');
	if (!/no project pointer/.test(warned[0])) {
		throw new Error(`the warning does not name the cause: ${warned[0]}`);
	}
	if (!/shared default board/.test(warned[0])) {
		throw new Error(`the warning does not name the consequence: ${warned[0]}`);
	}
});

// ---------- 2. the publisher's manifest merge ----------

console.info('the standalone publisher');

await check('re-publishing a bundle cannot blank a pointer it was not told about', () => {
	const merge = sliceBetween(
		publisher,
		'the manifest entry merge',
		'const previous = manifest.games[gameKey] ?? {};',
		'\t};\n',
	);
	const run = new Function(
		'manifest',
		'gameKey',
		'protocol',
		'name',
		'projectKey',
		'launcherOrigin',
		'readToken',
		`${merge} return manifest.games[gameKey];`,
	);
	// The online Game Maker wrote a full entry; this script is then run with none of the flags.
	const manifest = {
		games: {
			test6: {
				protocol: 'ways',
				name: 'Ways on Waves',
				projectKey: 'test6',
				docBase: 'https://app.invisiblewall.org',
				readToken: 'tok',
				grid: { reels: 5, rows: 4 },
				cascade: true,
			},
		},
	};
	const entry = run(manifest, 'test6', 'lines', 'Ways on Waves', undefined, undefined, undefined);
	eq(entry.projectKey, 'test6', 'projectKey survives');
	eq(entry.docBase, 'https://app.invisiblewall.org', 'docBase survives');
	eq(entry.readToken, 'tok', 'readToken survives');
	eq(entry.grid, { reels: 5, rows: 4 }, 'grid survives');
	eq(entry.cascade, true, 'cascade survives');
});

await check('the flags write the pointer the test server reads', () => {
	const merge = sliceBetween(
		publisher,
		'the manifest entry merge',
		'const previous = manifest.games[gameKey] ?? {};',
		'\t};\n',
	);
	const run = new Function(
		'manifest',
		'gameKey',
		'protocol',
		'name',
		'projectKey',
		'launcherOrigin',
		'readToken',
		`${merge} return manifest.games[gameKey];`,
	);
	const manifest = { games: {} };
	const entry = run(
		manifest,
		'waysofwavesbuild',
		'ways',
		'Ways on Waves',
		'test6',
		'https://app.invisiblewall.org',
		'tok',
	);
	eq(entry.projectKey, 'test6', 'projectKey written');
	eq(entry.docBase, 'https://app.invisiblewall.org', 'docBase written');
	eq(entry.readToken, 'tok', 'readToken written');
	eq(entry.protocol, 'ways', 'the ways protocol is accepted at all');
});

await check('the publisher accepts every protocol the test server mounts', () => {
	const accepted = /const MOCK_PROTOCOLS = \[([^\]]*)\]/.exec(publisher);
	const mounted = /const MOCK_PROTOCOLS = new Set\(\[([^\]]*)\]\)/.exec(server);
	if (!accepted || !mounted) throw new Error('could not find both protocol lists');
	const parse = (s) => [...s[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
	eq(parse(accepted), parse(mounted), 'the two protocol lists');
});

// ---------- 3. one field name, three files ----------

console.info('the field name');

await check('writer, type and reader all spell the pin the same way', () => {
	const type = read('apps/launcher-api/src/lib/server/testServerManifest.ts');
	const publish = read('apps/launcher-api/src/lib/server/publishGame.ts');
	for (const [label, source, needle] of [
		['the manifest type', type, 'projectKey?: string;'],
		['the online publisher', publish, 'projectKey,'],
		['the standalone publisher', publisher, '{ projectKey }'],
		['the test server hydration', server, 'projectKey: typeof meta.projectKey'],
		['the test server read', server, 'meta.projectKey ?? key'],
	]) {
		if (!source.includes(needle)) throw new Error(`${label} no longer carries \`${needle}\``);
	}
});

console.info(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
