/**
 * Publish writes an online arcade game's game server address (`docs/design/phase-11.md` P11.2 (c),
 * `docs/design/realtime-multiplayer.md` §10):
 *   pnpm --filter launcher-api check:online-publish
 *
 * Runs the REAL `publishGame.ts` (its gates, the launch URL it registers, the manifest entry) over
 * an in-memory R2. Stubbed: R2, the project and game rows, the snapshot store, the bundle assemble,
 * the sound and flow checks, the bug store and the test server's refresh. What it pins:
 *  - an online game (`arcade.online`) with `GAME_SERVER_URL` set empty is refused
 *    (`no-game-server`) by the gate and by the publish, before anything of it is written; so is an
 *    address that is not ws(s):// or http(s)://;
 *  - otherwise its launch URL carries `rooms_url` = the address (trailing slash dropped; unset, the
 *    live `wss://rooms.invisiblewall.org`), the exact parameter `apps/lines` `game/online.ts` boots
 *    from, beside the `project` it joins;
 *  - an offline arcade game and a slot publish with no address and carry no `rooms_url`;
 *  - an authoring launch of the online game keeps its `rooms_url`.
 */
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import type { GameConfigDoc } from 'game-config';

const R2 = new Map<string, string>();
const sortedKeys = (prefix: string) => [...R2.keys()].filter((k) => k.startsWith(prefix)).sort();
const src = (rel: string) => new URL(`../src/${rel}`, import.meta.url).href;
function mockAll(rel: string, namedExports: Record<string, unknown>): void {
	const text = readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');
	const all: Record<string, unknown> = {};
	for (const m of text.matchAll(/^export (?:async )?(?:function\*?|class|const|let) (\w+)/gm)) {
		all[m[1]] = () => {
			throw new Error(`fixture: ${rel} ${m[1]} is not faked`);
		};
	}
	for (const name of Object.keys(namedExports)) {
		if (!(name in all)) throw new Error(`fixture: ${rel} has no export ${name}`);
	}
	mock.module(src(rel), { namedExports: { ...all, ...namedExports } });
}

mockAll('lib/server/r2.ts', {
	precondition: () => undefined,
	objectExists: async (key: string) => R2.has(key),
	getObjectText: async (key: string) => R2.get(key) ?? null,
	getObjectTextWithEtag: async (key: string) =>
		R2.has(key) ? { text: R2.get(key)!, etag: '"e"' } : null,
	putObjectText: async (key: string, text: string) => {
		R2.set(key, text);
		return '"e"';
	},
	listAllKeys: async (prefix: string) => sortedKeys(prefix),
	listAllObjects: async (prefix: string) =>
		sortedKeys(prefix).map((key) => ({ key, size: R2.get(key)!.length, lastModified: 1 })),
});

const CLIENT = 'invisible_wall';
const KINDS: Record<string, string> = {
	salmonsonline: 'arcade',
	arcadeoffline: 'arcade',
	slotgame: 'lines',
};
const CONFIGS: Record<string, GameConfigDoc> = {
	salmonsonline: {
		family: 'arcade',
		outcome: 'rules',
		arcade: { field: { w: 800, h: 600 }, online: { maxPlayers: 4 } },
	} as GameConfigDoc,
	arcadeoffline: {
		family: 'arcade',
		outcome: 'rules',
		arcade: { field: { w: 800, h: 600 } },
	} as GameConfigDoc,
	slotgame: {} as GameConfigDoc,
};
mockAll('lib/server/projects.ts', {
	projectGameType: async (key: string) => KINDS[key] ?? null,
	projectClientKey: async () => CLIENT,
	projectName: async (key: string) => key,
	getOrMintReadToken: async (key: string) => `tok-${key}`,
});
const URLS = new Map<string, string>();
mockAll('lib/server/games.ts', {
	gameExists: async (key: string) => URLS.has(key),
	createGame: async (key: string, _name: string, url: string) => void URLS.set(key, url),
	setGameUrl: async (key: string, url: string) => void URLS.set(key, url),
	renameGame: async () => undefined,
	setGameProject: async () => undefined,
});
mockAll('lib/server/publishedRuntime.ts', {
	currentPointer: async () => null,
	readSnapshotBundle: async () => null,
	stageSnapshot: async () => ({
		id: 's1',
		createdAt: '2026-10-29T00:00:00.000Z',
		by: null,
		flow: 'absent',
		files: 0,
		bytes: 0,
	}),
	commitSnapshot: async () => undefined,
	discardSnapshot: async () => undefined,
});
mockAll('lib/server/runtimeBundle.ts', {
	buildRuntimeBundle: async (project: string) => ({
		config: CONFIGS[project],
		symbols: { map: {}, index: {} },
		doc: { scenes: [] },
		componentDefs: {},
		editorArt: { spinesMissing: [] },
	}),
});
mockAll('lib/server/soundPublishCheck.ts', {
	checkSoundsForPublish: async () => ({
		unapproved: [],
		licences: { total: 0, approved: 0, byLicence: {} },
	}),
});
mockAll('lib/server/flowV2Validation.ts', {
	checkFlowV2ForPublish: async () => ({ status: 'absent' }),
	checkShippedFlowV2: async () => ({ status: 'absent' }),
	describeFlowErrors: () => [],
	flowGateRefusal: () => null,
	flowScreensMissing: () => [],
});
mockAll('lib/server/runtimeBundleCache.ts', {
	invalidateRuntimeBundle: () => undefined,
	withDeployWrite: async <T>(_project: string, run: () => Promise<T>) => run(),
});
mockAll('lib/server/bugReportsStore.ts', { resolveFixedBugs: async () => undefined });
mockAll('lib/server/testServerRefresh.ts', {
	postTestServerRefresh: async () => new Response(null, { status: 202 }),
});

const { publishGame, publishGateRefusal, PublishBlockedError } =
	await import('../src/lib/server/publishGame.ts');
const { gameConfigDocKey } = await import('../src/lib/server/projectPaths.ts');
const { TEST_SERVER_MANIFEST_KEY } = await import('../src/lib/server/testServerManifest.ts');
const { asAuthoringLaunch } = await import('../src/lib/gameLaunch.ts');

for (const [key, config] of Object.entries(CONFIGS))
	R2.set(gameConfigDocKey(CLIENT, key), JSON.stringify(config));
R2.set('test_server/_runtime/arcade/current.json', JSON.stringify({ version: 1 }));
R2.set('test_server/_runtime/lines/current.json', JSON.stringify({ version: 1 }));

let failures = 0;
async function check(name: string, fn: () => void | Promise<void>) {
	try {
		await fn();
		console.log(`  ok  ${name}`);
	} catch (e) {
		failures++;
		console.error(`  FAIL ${name}\n       ${e instanceof Error ? e.message : String(e)}`);
	}
}
function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(msg);
}
const ORIGIN = 'https://app.invisiblewall.org';
const publish = (key: string) => publishGame(key, ORIGIN);
const refusedWith = async (key: string, reason: string) => {
	const gate = await publishGateRefusal(key);
	assert(gate?.reason === reason, `the gate said ${gate?.reason ?? 'nothing'}, want ${reason}`);
	try {
		await publish(key);
	} catch (e) {
		assert(e instanceof PublishBlockedError, `threw ${String(e)}`);
		assert(e.reason === reason, `refused for ${e.reason}, want ${reason}`);
		assert(/GAME_SERVER_URL/.test(e.message), `names no GAME_SERVER_URL: ${e.message}`);
		return;
	}
	throw new Error('published');
};
const manifestHas = (key: string) =>
	R2.has(TEST_SERVER_MANIFEST_KEY) &&
	key in (JSON.parse(R2.get(TEST_SERVER_MANIFEST_KEY)!) as { games: object }).games;
const paramsOf = (url: string) => new URL(url).searchParams;

console.log('check:online-publish');

await check('an online game with no game server address is refused, nothing written', async () => {
	process.env.GAME_SERVER_URL = '';
	await refusedWith('salmonsonline', 'no-game-server');
	process.env.GAME_SERVER_URL = ' \n';
	await refusedWith('salmonsonline', 'no-game-server');
	assert(!URLS.has('salmonsonline'), 'a game row was written');
	assert(!manifestHas('salmonsonline'), 'a manifest entry was written');
});

await check('an address that is not ws(s):// or http(s):// is refused', async () => {
	process.env.GAME_SERVER_URL = 'rooms.invisiblewall.org';
	await refusedWith('salmonsonline', 'no-game-server');
	process.env.GAME_SERVER_URL = 'ftp://rooms.invisiblewall.org';
	await refusedWith('salmonsonline', 'no-game-server');
	assert(!URLS.has('salmonsonline'), 'a game row was written');
});

await check(
	'offline arcade and slot games publish with no address, without rooms_url',
	async () => {
		process.env.GAME_SERVER_URL = '';
		for (const key of ['arcadeoffline', 'slotgame']) {
			assert((await publishGateRefusal(key)) === null, `${key}: the gate refused it`);
			const { url } = await publish(key);
			assert(!paramsOf(url).has('rooms_url'), `${key}: ${url}`);
			assert(URLS.get(key) === url, `${key}: the game row holds another URL`);
		}
		process.env.GAME_SERVER_URL = 'wss://rooms.invisiblewall.org';
		for (const key of ['arcadeoffline', 'slotgame'])
			assert(!paramsOf((await publish(key)).url).has('rooms_url'), `${key} gained rooms_url`);
	},
);

await check('an online game publishes with rooms_url = the address', async () => {
	process.env.GAME_SERVER_URL = 'wss://rooms.invisiblewall.org/\n';
	assert((await publishGateRefusal('salmonsonline')) === null, 'the gate refused it');
	const { url } = await publish('salmonsonline');
	const params = paramsOf(url);
	assert(params.get('rooms_url') === 'wss://rooms.invisiblewall.org', url);
	assert(params.get('project') === 'salmonsonline', `joins no game: ${url}`);
	assert(URLS.get('salmonsonline') === url, 'the game row holds another URL');
	assert(manifestHas('salmonsonline'), 'no manifest entry');
	const authoring = paramsOf(asAuthoringLaunch(url));
	assert(authoring.get('rooms_url') === 'wss://rooms.invisiblewall.org', 'authoring lost it');
	process.env.GAME_SERVER_URL = 'ws://localhost:2567';
	assert(paramsOf((await publish('salmonsonline')).url).get('rooms_url') === 'ws://localhost:2567');
	delete process.env.GAME_SERVER_URL;
	const { url: unset } = await publish('salmonsonline');
	assert(paramsOf(unset).get('rooms_url') === 'wss://rooms.invisiblewall.org', `unset: ${unset}`);
});

await check('the runtime boots from the parameter publish writes', () => {
	const online = readFileSync(new URL('../../lines/src/game/online.ts', import.meta.url), 'utf8');
	assert(/params\.get\('rooms_url'\)/.test(online), 'online.ts no longer reads rooms_url');
	assert(/params\.get\('project'\)/.test(online), 'online.ts no longer falls back to project');
});

if (failures) {
	console.error(`\ncheck:online-publish: ${failures} failure(s)`);
	process.exit(1);
}
console.log('\ncheck:online-publish: OK');
