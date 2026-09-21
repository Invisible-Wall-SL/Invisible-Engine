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
//   4. THE REPAIR, over the REAL `pinTestServerGameToProject` sliced out of `testServerManifest.ts`
//      and run against an in-memory R2. The desktop launcher writes this manifest itself with no
//      pointer and REPLACES the entry, so `/api/launcher/register-game` re-stamps it on every
//      publish: it must patch an existing entry without disturbing anything else, must never CREATE
//      one, must not write at all when the pin is already right, and must survive a lost CAS.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSlice, stripSliceTypes } from './lib/compile-slice.mjs';
import { lfReaderFrom } from './lib/read-lf.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The repo checks out CRLF on Windows; every slice marker below is written with `\n`.
const read = lfReaderFrom(ROOT);

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
const REGISTER = 'apps/launcher-api/src/routes/api/launcher/register-game/+server.ts';

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
	const run = compileSlice({
		what: 'verify-test-server-project-pin / testServerContract.ts#refreshContract',
		names: keys,
		body: `return (async () => { ${body} })();`,
	});
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
	const run = compileSlice({
		what: 'verify-test-server-project-pin / publish-game-bundle.mjs#manifest entry merge',
		names: ['manifest', 'gameKey', 'protocol', 'name', 'projectKey', 'launcherOrigin', 'readToken'],
		body: `${merge} return manifest.games[gameKey];`,
	});
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
	const run = compileSlice({
		what: 'verify-test-server-project-pin / publish-game-bundle.mjs#manifest entry merge',
		names: ['manifest', 'gameKey', 'protocol', 'name', 'projectKey', 'launcherOrigin', 'readToken'],
		body: `${merge} return manifest.games[gameKey];`,
	});
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
		['the repair writer', type, 'pinTestServerGameToProject'],
		['the register endpoint', read(REGISTER), 'pinTestServerGameToProject'],
	]) {
		if (!source.includes(needle)) throw new Error(`${label} no longer carries \`${needle}\``);
	}
});

// ---------- 4. the repair: re-stamping a pointer the desktop launcher wiped ----------

console.info('the register-game repair');

const manifestModule = read('apps/launcher-api/src/lib/server/testServerManifest.ts');

// The REAL function, TypeScript stripped rather than re-typed by hand, so a change to its logic is
// a change to what runs here.
const pinSource = stripSliceTypes(
	'testServerManifest.ts#pinTestServerGameToProject',
	sliceBetween(
		manifestModule,
		'pinTestServerGameToProject',
		'export async function pinTestServerGameToProject(',
		'\n}\n',
	).replace('export async function', 'async function'),
);

/** Drive the real function against an in-memory manifest. `conflicts` makes the first N writes lose
 *  their CAS, which is the only way to exercise the retry loop. */
const pinHarness = async (games, pin, { conflicts = 0, gameKey = 'waysofwavesbuild' } = {}) => {
	const writes = [];
	let store = JSON.stringify({ games }, null, 2);
	let etag = 'etag-0';
	let remaining = conflicts;
	class ConflictError extends Error {}
	const scope = {
		TEST_SERVER_MANIFEST_KEY: 'test_server/games.json',
		MANIFEST_MAX_ATTEMPTS: 6,
		ConflictError,
		parseManifest: (raw) => {
			try {
				const parsed = JSON.parse(raw ?? '');
				return { games: parsed.games ?? {} };
			} catch {
				return { games: {} };
			}
		},
		getObjectTextWithEtag: async () => ({ text: store, etag }),
		precondition: (e) => ({ ifMatch: e }),
		putObjectText: async (_key, text, _ct, cond) => {
			writes.push({ text, cond });
			if (remaining > 0) {
				remaining -= 1;
				const n = conflicts - remaining;
				// A LOST CAS WITH A REAL WINNER BEHIND IT. The store must actually CHANGE here, or the
				// retry proves nothing: a loop that read the manifest once and merely re-sent its stale
				// copy would pass just as well. The winner publishes a different game, so a correct
				// retry — which re-reads before merging — ends with BOTH that game and our pin, while a
				// read-once loop silently drops it. That is the exact bug the CAS exists to prevent.
				store = JSON.stringify(
					{
						games: {
							...JSON.parse(store).games,
							[`rival${n}`]: { protocol: 'lines', name: `Rival ${n}` },
						},
					},
					null,
					2,
				);
				etag = `etag-${n}`;
				throw new ConflictError('precondition failed');
			}
			store = text;
		},
	};
	const keys = Object.keys(scope);
	const run = compileSlice({
		what: 'verify-test-server-project-pin / testServerManifest.ts#pinTestServerGameToProject',
		names: [...keys, 'gameKey', 'pin'],
		body: `return (async () => { ${pinSource} return pinTestServerGameToProject(gameKey, pin); })();`,
	});
	const outcome = await run(...keys.map((k) => scope[k]), gameKey, pin);
	return { outcome, writes, manifest: JSON.parse(store) };
};

const PIN = {
	projectKey: 'test6',
	docBase: 'https://app.invisiblewall.org',
	readToken: 'tok',
};
/** What the desktop launcher's own manifest write leaves behind: no pointer, and the online
 *  publisher's `grid`/`cascade` gone with it. */
const DESKTOP_WRITE = {
	protocol: 'lines',
	name: 'Ways on Waves',
	updatedAt: '2026-09-10T00:00:00Z',
};

await check('a wiped pointer is repaired', async () => {
	const { outcome, writes, manifest } = await pinHarness({ waysofwavesbuild: DESKTOP_WRITE }, PIN);
	eq(outcome, 'pinned', 'outcome');
	eq(writes.length, 1, 'one write');
	eq(manifest.games.waysofwavesbuild.projectKey, 'test6', 'projectKey');
	eq(manifest.games.waysofwavesbuild.docBase, PIN.docBase, 'docBase');
	eq(manifest.games.waysofwavesbuild.readToken, 'tok', 'readToken');
});

await check('everything the endpoint knows nothing about survives the patch', async () => {
	// The fields only the ONLINE publisher writes. A wholesale replace here would silently send the
	// mock back to its default board — the very bug this endpoint exists to prevent.
	const rich = {
		...DESKTOP_WRITE,
		runtime: 'lines',
		grid: { reels: 5, rows: 4, rowsPerReel: [3, 4, 4, 4, 4], paylines: [] },
		cascade: true,
	};
	const { manifest } = await pinHarness({ waysofwavesbuild: rich, hotfruits: DESKTOP_WRITE }, PIN);
	const e = manifest.games.waysofwavesbuild;
	eq(e.grid, rich.grid, 'grid');
	eq(e.cascade, true, 'cascade');
	eq(e.runtime, 'lines', 'runtime');
	eq(e.updatedAt, rich.updatedAt, 'updatedAt (this endpoint did not publish anything)');
	eq(manifest.games.hotfruits, DESKTOP_WRITE, 'the sibling game');
});

await check('a game with no manifest entry is never invented', async () => {
	// No bundle was uploaded under this key. Creating an entry would register a game the test server
	// would then serve zero files for.
	const { outcome, writes, manifest } = await pinHarness({ hotfruits: DESKTOP_WRITE }, PIN);
	eq(outcome, 'no-entry', 'outcome');
	eq(writes.length, 0, 'no write');
	eq(Object.keys(manifest.games), ['hotfruits'], 'games untouched');
});

await check(
	'a prototype-shadowing key cannot smuggle an entry past the never-create guard',
	async () => {
		// `constructor` passes `isValidGameKey` (lowercase, no separators), and on a plain JSON object
		// `games['constructor']` is the truthy `Object` function — so a truthiness test on the lookup
		// would take it for an existing entry and write a project READ TOKEN into a game nobody
		// published. `toString`/`valueOf`/`__proto__` are already refused by the key regex; this one is
		// not, which is why the guard has to be `Object.hasOwn` rather than the regex.
		const { outcome, writes } = await pinHarness({ hotfruits: DESKTOP_WRITE }, PIN, {
			gameKey: 'constructor',
		});
		eq(outcome, 'no-entry', 'outcome');
		eq(writes.length, 0, 'no write');
	},
);

await check('an already-correct pin costs a read and nothing else', async () => {
	// This runs on EVERY desktop publish, and the refresh it triggers re-hydrates every bundle —
	// so "no change ⇒ no write" is what keeps it cheap enough to sit in that path.
	const { outcome, writes } = await pinHarness(
		{ waysofwavesbuild: { ...DESKTOP_WRITE, ...PIN } },
		PIN,
	);
	eq(outcome, 'already-pinned', 'outcome');
	eq(writes.length, 0, 'no write');
});

await check('a stale pin (project reassigned) is corrected, not left alone', async () => {
	const stale = { ...DESKTOP_WRITE, ...PIN, projectKey: 'test5' };
	const { outcome, manifest } = await pinHarness({ waysofwavesbuild: stale }, PIN);
	eq(outcome, 'pinned', 'outcome');
	eq(manifest.games.waysofwavesbuild.projectKey, 'test6', 'projectKey corrected');
});

await check('a lost CAS is retried against the re-read manifest', async () => {
	const { outcome, writes, manifest } = await pinHarness({ waysofwavesbuild: DESKTOP_WRITE }, PIN, {
		conflicts: 2,
	});
	eq(outcome, 'pinned', 'outcome');
	eq(writes.length, 3, 'two losses then a win');
	eq(manifest.games.waysofwavesbuild.projectKey, 'test6', 'projectKey');
	// THE POINT OF THE TEST: each retry re-read, so the two rival publishers who won the races are
	// still in the manifest we wrote. A loop that reused its first read would have erased them.
	eq(Object.keys(manifest.games).sort(), ['rival1', 'rival2', 'waysofwavesbuild'], 'rivals kept');
	// Every attempt must carry the etag it just read — an unconditional write is how a concurrent
	// publisher's entry gets dropped (the whole reason this manifest is CAS-guarded).
	for (const w of writes) {
		if (!w.cond || typeof w.cond.ifMatch !== 'string') {
			throw new Error(`a write went out unguarded: ${JSON.stringify(w.cond)}`);
		}
	}
});

await check('the endpoint keeps the pin non-fatal and reports it', async () => {
	const src = read(REGISTER);
	for (const [what, needle] of [
		['the pin result rides the response', 'purge, pin }'],
		['the failure is caught, not thrown', "return { status: 'error'"],
		['the refresh is best-effort', "method: 'POST'"],
		['the refresh is time-boxed', 'AbortSignal.timeout(REFRESH_TIMEOUT_MS)'],
		[
			'the project scope is the one already validated',
			'pinToProject(key, projectKey, launcherUrl.origin)',
		],
	]) {
		if (!src.includes(needle)) throw new Error(`${what}: missing \`${needle}\``);
	}
	// The pin must run AFTER the row is written — the registration is what was asked for.
	if (src.indexOf('pinToProject(key,') < src.indexOf('await createGame(')) {
		throw new Error('the pin runs before the game row is written');
	}
	// BOTH publishers must poke the SAME host. `env.ts` scopes `TEST_SERVER_URL` to the Game Config
	// tool's RGS probe and keeps it separate so that probe can be pointed elsewhere — aiming a
	// control call there would refresh one service while games are served from another.
	const publish = read('apps/launcher-api/src/lib/server/publishGame.ts');
	if (!src.includes('ENV.GAMES_BASE_URL') || !src.includes('/refresh')) {
		throw new Error('the register-game refresh no longer goes to GAMES_BASE_URL');
	}
	if (src.includes('ENV.TEST_SERVER_URL')) {
		throw new Error('the register-game refresh is aimed at the RGS-probe host');
	}
	if (!publish.includes('GAMES_BASE_URL')) {
		throw new Error('publishGame no longer resolves its refresh host from GAMES_BASE_URL');
	}
});

await check('a refresh that arrives mid-hydrate is QUEUED, not dropped', () => {
	// The pin's whole point is that the running registry ends up holding it, and one publish makes
	// that a race: the desktop launcher POSTs /refresh, then register-game writes the pin and POSTs
	// again. Dropped, the second request is answered by a pass that read the manifest BEFORE the
	// write — so the pin stays in R2, unread, and the next publish overwrites it before any hydrate
	// ever sees it. Asserted at SOURCE level because the handler reaches R2, the mocks and the
	// registry, and cannot be stood up in a Node fixture; the behaviour is driven end-to-end by the
	// local-dir smoke run in the PR.
	if (!server.includes('let refreshPending = false;')) {
		throw new Error('the trailing-edge refresh queue is gone');
	}
	if (!/if \(refreshing\) \{\s*\n\s*refreshPending = true;/.test(server)) {
		throw new Error('a mid-hydrate refresh no longer sets the pending flag');
	}
	if (!/refreshPending = false;[\s\S]{0,200}runHydrate\(\)/.test(server)) {
		throw new Error('the queued refresh never re-runs the hydrate');
	}
	// The follow-up must run while `refreshing` is still held, or a third request would start a
	// SECOND concurrent hydrate against the same registry.
	const settle = server.slice(server.indexOf('const runHydrate ='));
	if (/refreshPending = false;[\s\S]{0,120}refreshing = false;/.test(settle)) {
		throw new Error('the follow-up hydrate releases the in-flight guard before it runs');
	}
});

console.info(failures === 0 ? `\nAll ${ran} checks passed.` : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
