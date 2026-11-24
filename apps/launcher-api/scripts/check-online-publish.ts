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
 *  - an authoring launch of the online game keeps its `rooms_url`;
 *  - every game card's link as it is handed out (`gameLinks.ts`, the home grid and Game Maker): an
 *    online project's card gets `rooms_url` once (a desktop standalone build's stored URL too, with
 *    `rooms_game` when it names no project), from the launcher's address; one that has it is not
 *    doubled; a card that cannot join (no address, no published online config) is refused with the
 *    reason; any other card is returned byte for byte;
 *  - the runtime says a launch has no game server address on its own screen;
 *  - draft sounds never refuse a publish (the owner's call, 2026-11-13): the gate passes, the
 *    publish names them in its result, and a bulk run through the REAL `publishAllJob.ts` →
 *    `publishAllRunner.ts` publishes the game and records them on its item.
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
	draftslot: 'lines',
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
	draftslot: {} as GameConfigDoc,
};
/** The shipped sounds still marked draft, per project — what the sound check would answer. */
const DRAFTS: Record<string, string[]> = { draftslot: ['sfx_coin', 'sfx_win'] };
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
	checkSoundsForPublish: async (_client: string, project: string) => ({
		unapproved: DRAFTS[project] ?? [],
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
/** Projects whose PUBLISHED config is the online one (what the game server deals a room from). */
const PUBLISHED = new Set(['salmonsonline']);
mockAll('lib/server/gameServerConfig.ts', {
	publishedGameConfig: async (project: string) =>
		PUBLISHED.has(project)
			? { found: true, snapshot: 's1', doc: CONFIGS[project] }
			: { found: false, reason: 'unpublished' },
});
mockAll('lib/server/bugReportsStore.ts', { resolveFixedBugs: async () => undefined });
mockAll('lib/server/testServerRefresh.ts', {
	postTestServerRefresh: async () => new Response(null, { status: 202 }),
});

const { publishGame, publishGateRefusal, PublishBlockedError } =
	await import('../src/lib/server/publishGame.ts');
const { startPublishAllJob } = await import('../src/lib/server/publishAllJob.ts');
const { gameConfigDocKey } = await import('../src/lib/server/projectPaths.ts');
const { TEST_SERVER_MANIFEST_KEY } = await import('../src/lib/server/testServerManifest.ts');
const { asAuthoringLaunch } = await import('../src/lib/gameLaunch.ts');
const { withGameServerLinks } = await import('../src/lib/server/gameLinks.ts');

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
	for (const junk of ['wss://', 'wss://rooms invisible wall', 'wss://rooms.invisiblewall.org x']) {
		process.env.GAME_SERVER_URL = junk;
		await refusedWith('salmonsonline', 'no-game-server');
	}
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

await check(
	'draft sounds never refuse a publish: it ships, and its result names them',
	async () => {
		assert((await publishGateRefusal('draftslot')) === null, 'the gate refused it');
		const result = await publish('draftslot');
		assert(result.draftSounds.join() === 'sfx_coin,sfx_win', `drafts: ${result.draftSounds}`);
		assert(URLS.get('draftslot') === result.url, 'no game row');
		assert(manifestHas('draftslot'), 'no manifest entry');
		assert((await publish('slotgame')).draftSounds.length === 0, 'a game with no draft lists some');
	},
);

await check(
	'a bulk run publishes a game with draft sounds and records them on its item',
	async () => {
		URLS.delete('draftslot');
		const job = startPublishAllJob({
			targets: [
				{ key: 'draftslot', name: 'Draft slot' },
				{ key: 'slotgame', name: 'Slot game' },
			],
			scope: 'published',
			launcherOrigin: ORIGIN,
			startedBy: 'publisher@example.test',
		});
		for (let i = 0; job.finishedAt === null && i < 200; i++) {
			await new Promise((tick) => setTimeout(tick, 5));
		}
		assert(job.finishedAt !== null, 'the run never finished');
		const [drafted, clean] = job.items;
		assert(drafted.status === 'ok', `draftslot: ${drafted.status} ${drafted.message ?? ''}`);
		assert(drafted.draftSounds?.join() === 'sfx_coin,sfx_win', `item: ${JSON.stringify(drafted)}`);
		assert(URLS.has('draftslot'), 'draftslot was not published');
		assert(clean.status === 'ok' && clean.draftSounds === undefined, JSON.stringify(clean));
	},
);

await check('a card of a game that is not online is handed out byte for byte', async () => {
	process.env.GAME_SERVER_URL = 'wss://rooms.invisiblewall.org';
	const cards = [
		{ key: 'slotgame', url: 'https://g.test/slotgame/?runtime=1&lang=en', projectKey: 'slotgame' },
		{ key: 'arcadeoffline', url: 'https://g.test/a/?x=1', projectKey: 'arcadeoffline' },
		{ key: 'global', url: 'https://g.test/global/?x=1', projectKey: null },
	];
	for (const [i, out] of (await withGameServerLinks(cards)).entries()) {
		assert(out.url === cards[i].url, `${out.key}: ${out.url}`);
		assert(out.launchRefusal === null, `${out.key} refused: ${out.launchRefusal}`);
	}
});

const DESKTOP =
	'https://games.invisiblewall.org/salmonsbuild/?sessionID=demo' +
	'&rgs_url=games.invisiblewall.org%2Fapi%2Fsalmonsbuild&lang=en&currency=EUR&device=desktop';
const desktopCard = { key: 'salmonsbuild', url: DESKTOP, projectKey: 'salmonsonline' };

await check("a desktop standalone build's card joins its project's rooms", async () => {
	process.env.GAME_SERVER_URL = 'wss://rooms.invisiblewall.org/';
	const [out] = await withGameServerLinks([desktopCard]);
	assert(out.launchRefusal === null, `refused: ${out.launchRefusal}`);
	const params = paramsOf(out.url);
	assert(params.getAll('rooms_url').join() === 'wss://rooms.invisiblewall.org', out.url);
	assert(params.get('rooms_game') === 'salmonsonline', `joins no game: ${out.url}`);
	assert(out.url.startsWith(DESKTOP), `the stored link changed: ${out.url}`);
	const authoring = paramsOf(asAuthoringLaunch(out.url));
	assert(authoring.get('rooms_url') === 'wss://rooms.invisiblewall.org', 'authoring lost it');
});

await check(
	"the card's address is the launcher's, and a published link is not doubled",
	async () => {
		process.env.GAME_SERVER_URL = 'ws://localhost:2567';
		const [local] = await withGameServerLinks([desktopCard]);
		assert(paramsOf(local.url).get('rooms_url') === 'ws://localhost:2567', local.url);
		const published = (await publish('salmonsonline')).url;
		const [again] = await withGameServerLinks([
			{ key: 'salmonsonline', url: published, projectKey: 'salmonsonline' },
		]);
		assert(again.url === published, `a published link was rewritten: ${again.url}`);
		assert(paramsOf(again.url).getAll('rooms_url').length === 1, `doubled: ${again.url}`);
		assert(!paramsOf(again.url).has('rooms_game'), `rooms_game beside project: ${again.url}`);
	},
);

await check("a stale, empty or fragment-split address is set to the launcher's", async () => {
	process.env.GAME_SERVER_URL = 'wss://rooms.invisiblewall.org';
	const cards = [
		`${DESKTOP}&rooms_url=${encodeURIComponent('wss://old.example.test')}`,
		`${DESKTOP}&rooms_url=`,
		`${DESKTOP}#top`,
	].map((url) => ({ key: 'salmonsbuild', url, projectKey: 'salmonsonline' }));
	for (const out of await withGameServerLinks(cards)) {
		const [query, fragment] = out.url.split('#');
		const params = new URLSearchParams(query.split('?')[1]);
		assert(params.getAll('rooms_url').join() === 'wss://rooms.invisiblewall.org', out.url);
		assert(params.get('rooms_game') === 'salmonsonline', out.url);
		assert(fragment === undefined || fragment === 'top', `fragment moved: ${out.url}`);
		assert(query.startsWith(DESKTOP), `the stored link changed: ${out.url}`);
	}
	const [empty] = await withGameServerLinks([{ ...desktopCard, url: '' }]);
	assert(empty.url === '' && empty.launchRefusal === null, `a card with no URL: ${empty.url}`);
});

await check(
	'a card that cannot join a room is refused with the reason, not handed out',
	async () => {
		process.env.GAME_SERVER_URL = '';
		const [noServer] = await withGameServerLinks([desktopCard]);
		assert(/GAME_SERVER_URL/.test(noServer.launchRefusal ?? ''), `${noServer.launchRefusal}`);
		process.env.GAME_SERVER_URL = 'wss://rooms.invisiblewall.org';
		PUBLISHED.delete('salmonsonline');
		try {
			const [unpublished] = await withGameServerLinks([desktopCard]);
			assert(/published/i.test(unpublished.launchRefusal ?? ''), `${unpublished.launchRefusal}`);
		} finally {
			PUBLISHED.add('salmonsonline');
		}
	},
);

await check('the home grid and Game Maker hand out the links with the game server', () => {
	const read = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');
	assert(
		/withGameServerLinks\(/.test(read('routes/(app)/+page.server.ts')),
		'the home grid hands out stored links',
	);
	assert(
		/gameServerLink\(\s*game\.url/.test(read('routes/(app)/game-maker/+page.server.ts')),
		'Game Maker hands out stored links',
	);
	for (const rel of ['routes/(app)/+page.svelte', 'routes/(app)/game-maker/+page.svelte'])
		assert(/launchRefusal\}/.test(read(rel)), `${rel} does not show why a card cannot join`);
});

await check('the runtime boots from the parameter publish writes', () => {
	const online = readFileSync(new URL('../../lines/src/game/online.ts', import.meta.url), 'utf8');
	assert(/params\.get\('rooms_url'\)/.test(online), 'online.ts no longer reads rooms_url');
	assert(/params\.get\('project'\)/.test(online), 'online.ts no longer falls back to project');
	for (const rel of ['online.ts', 'online3d.ts']) {
		const text = readFileSync(new URL(`../../lines/src/game/${rel}`, import.meta.url), 'utf8');
		assert(
			/if \(!url\) return refuseNoGameServer\(\)/.test(text),
			`${rel}: no missing-address screen`,
		);
	}
	const scenes = readFileSync(new URL('../../lines/src/editor-scenes.ts', import.meta.url), 'utf8');
	assert(/has no game server address/.test(scenes), 'the missing-address screen says nothing');
});

if (failures) {
	console.error(`\ncheck:online-publish: ${failures} failure(s)`);
	process.exit(1);
}
console.log('\ncheck:online-publish: OK');
