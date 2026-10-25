/**
 * The match-3 wire, end to end (`docs/reference/match3-wire.md`, game-families P10.6 §7.2).
 *
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs scripts/check-match3-wire.mjs
 *   (or `pnpm check:match3-wire`)
 *
 * Drives the REAL facade (`engine-facade.ts`) against the REAL match-3 mock, as `check:stake` does
 * for the slots, and pins what the interactive round promises: the bet opens a round that stays open,
 * each `move` is posted at the next position (+1) under the round's `gid`, a re-post at an occupied
 * position replays and charges nothing, the round takes its moves and is collected exactly once, and
 * the balance moves only at the bet and the collect, by exactly the total the server drew.
 *
 * Also pins that every protocol list knows `match3` — a list that does not falls back to `lines`
 * silently (game-families §6.3) — and that the mock's total table pays 0.96 of the stake.
 *
 * The facade's translation fixtures over a scripted server are `packages/rgs-translator-eagaming/
 * match3.fixture.ts` (resume, resends, the stock transport); this gate is the real pair.
 */

import { readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canSwap, createBoard, findMoves } from '../packages/engine-mechanics/src/board.js';
import { createMockRgs, MATCH3_TOTAL_TABLE } from './mock-rgs-server-match3.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const facade = await import('../packages/rgs-translator-eagaming/engine-facade.ts');
const { MAPPINGS } = await import('../packages/rgs-translator-eagaming/src/gameMappings.ts');
const { match3MockInputs, normalizeGameConfigDoc } =
	await import('../packages/game-config/index.ts');
const { protocolFor } = await import('../apps/launcher-api/src/lib/server/mockProtocol.ts');
const { makeMock, validGrid } = await import('../services/test-server/makeMock.mjs');
const { deliveryFamilyRefusal } = await import('./delivery-family-gate.mjs');

let failed = 0;
let passed = 0;
const check = (ok, msg) => {
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`);
	if (ok) passed++;
	else failed++;
};

// ── Every protocol list knows match3 ──────────────────────────────────────────
console.log('protocol lists');
// Read as text: the manifest module imports the R2 client, which this loader cannot run.
check(
	/export const MOCK_PROTOCOLS = \[[^\]]*'match3'/.test(
		read('apps/launcher-api/src/lib/server/testServerManifest.ts'),
	),
	'the launcher MOCK_PROTOCOLS has match3',
);
check(protocolFor('match3') === 'match3', "protocolFor('match3') is 'match3'");
check(
	protocolFor('lines') === 'lines' && protocolFor('bookOf') === 'book',
	'slot kinds keep theirs',
);
check(
	/const MOCK_PROTOCOLS = new Set\(\[[^\]]*'match3'/.test(read('services/test-server/server.mjs')),
	"the test server's MOCK_PROTOCOLS has match3",
);
for (const script of [
	'apps/launcher-api/scripts/publish-game-bundle.mjs',
	'apps/launcher-api/scripts/publish-game-via-portal.mjs',
])
	check(
		/const MOCK_PROTOCOLS = \[[^\]]*'match3'/.test(read(script)),
		`${script.split('/').pop()} knows match3`,
	);
const dockerfile = read('services/test-server/Dockerfile');
for (const file of [
	'scripts/mock-rgs-server-match3.mjs',
	'packages/engine-mechanics/src/board.js',
	'packages/engine-mechanics/package.json',
])
	check(dockerfile.includes(file), `the test-server image copies ${file}`);
check(MAPPINGS.match3 === MAPPINGS.identity, 'PUBLIC_RGS_GAME=match3 maps by identity');

const docOf = (name) =>
	normalizeGameConfigDoc(
		JSON.parse(read(`apps/launcher-api/src/lib/data/gameConfig/${name}.json`)),
	);

// ── Free play: every list knows freePlay, its mock takes nothing, and it is never delivered ──
console.log('free play');
check(
	/export const MOCK_PROTOCOLS = \[[^\]]*'freePlay'/.test(
		read('apps/launcher-api/src/lib/server/testServerManifest.ts'),
	),
	'the launcher MOCK_PROTOCOLS has freePlay',
);
check(
	/const MOCK_PROTOCOLS = new Set\(\[[^\]]*'freePlay'/.test(
		read('services/test-server/server.mjs'),
	),
	"the test server's MOCK_PROTOCOLS has freePlay",
);
for (const script of [
	'apps/launcher-api/scripts/publish-game-bundle.mjs',
	'apps/launcher-api/scripts/publish-game-via-portal.mjs',
])
	check(
		/const MOCK_PROTOCOLS = \[[^\]]*'freePlay'/.test(read(script)),
		`${script.split('/').pop()} knows freePlay`,
	);
check(MAPPINGS.freePlay === MAPPINGS.identity, 'PUBLIC_RGS_GAME=freePlay maps by identity');
{
	const mock = makeMock('freePlay', 'fp', undefined, 'fp', undefined, 'lines');
	const answers = [];
	for (const [method, path] of [
		['POST', '/api/fp/rgs/engine?sid=s&seq=0'],
		['GET', '/api/fp/healthz'],
		['OPTIONS', '/api/fp/rgs/engine'],
	]) {
		let status = 0;
		let body = '';
		mock.handle(
			{ method },
			{ writeHead: (s) => (status = s), end: (b) => (body = b) },
			new URL(path, 'http://x'),
		);
		answers.push({ method, status, body });
	}
	check(
		answers[0].status === 403 && /ERR_FREE_PLAY/.test(answers[0].body),
		'the freePlay mock refuses an RGS round (403 ERR_FREE_PLAY)',
	);
	check(answers[1].status === 403, 'the freePlay mock answers nothing else either');
	check(answers[2].status === 204, 'the freePlay mock still answers a CORS preflight');
	check(mock.sessions.size === 0, 'the freePlay mock opens no session');
}
{
	const refusal = (config) => deliveryFamilyRefusal(config) ?? '';
	check(deliveryFamilyRefusal(null) === null, 'a build with no config is deliverable');
	check(deliveryFamilyRefusal(docOf('lines')) === null, 'a slot is deliverable');
	check(
		/free-play .*never built for a real-money delivery/.test(refusal(docOf('match3.rules'))),
		'a rules match-3 game is refused for any delivery',
	);
	check(
		/free-play/.test(refusal({ family: 'arcade', outcome: 'rules' })),
		'a rules arcade game is refused for any delivery',
	);
	check(
		/real-money match-3 .*real provider's match-3 wire/.test(refusal(docOf('match3.rgs'))),
		'an RGS match-3 delivery waits on the partner wire',
	);
	check(/arcade/.test(refusal({ family: 'arcade' })), 'an arcade game is refused for delivery');
	check(
		/non-slot/.test(refusal({ family: 'card' })),
		'a family the gate does not know is refused (it fails closed)',
	);
	check(deliveryFamilyRefusal({ family: 'slot' }) === null, "an explicit 'slot' is deliverable");
	const delivery = read('scripts/build-delivery.mjs');
	const gate = delivery.indexOf('const family = familyRefusal();');
	check(
		/import \{ deliveryFamilyRefusal \} from '\.\/delivery-family-gate\.mjs';/.test(delivery) &&
			gate > delivery.indexOf("run('pnpm', ['build']") &&
			gate > delivery.indexOf('if (skipBuild) {') &&
			gate < delivery.indexOf("resolve(ENGINE_ROOT, 'scripts/build-embed.mjs')") &&
			/if \(family\)\s*throw refused\(family/.test(delivery.slice(gate)),
		'build-delivery.mjs refuses on the gate after the build (or --skip-build), before packaging',
	);
}

// ── The contract the launcher sends, and the mock the test server builds from it ──
const rgsDoc = docOf('match3.rgs');
const inputs = match3MockInputs(rgsDoc);
console.log('contract');
check(
	Boolean(inputs?.strips?.length) && inputs.cols === 7 && inputs.rows === 7,
	'the RGS seed yields 7 × 7 mock inputs',
);
check(Object.keys(inputs?.paytable ?? {}).length > 0, 'the RGS seed prices its gems');
check(match3MockInputs(docOf('lines')) === undefined, 'a slot config yields no match-3 inputs');
const grid = validGrid({ reels: 7, rows: 7, paylines: [], match3: inputs });
check(
	JSON.stringify(grid?.match3) === JSON.stringify(inputs),
	'validGrid passes the block through',
);
check(
	!('match3' in (validGrid({ reels: 5, rows: 3, paylines: [] }) ?? {})),
	'a contract with no block stays as it was',
);
check(
	Boolean(makeMock('match3', 'm', grid, 'k', undefined, true)?.handle),
	'makeMock deals match3',
);
check(
	Boolean(
		makeMock(
			'match3',
			'm',
			validGrid({
				reels: 7,
				rows: 7,
				paylines: [],
				match3: match3MockInputs(docOf('match3.rules')),
			}),
			'k',
			undefined,
			true,
		)?.handle,
	),
	'a match-3 entry with only rules inputs still stands its mock up',
);

// ── The total table ──────────────────────────────────────────────────────────
const weight = MATCH3_TOTAL_TABLE.reduce((sum, row) => sum + row.weight, 0);
const mean = MATCH3_TOTAL_TABLE.reduce((sum, row) => sum + row.multiple * row.weight, 0) / weight;
check(Math.abs(mean - 0.96) < 1e-9, `the total table pays ${mean.toFixed(4)} of the stake`);

// ── The real facade against the real mock ─────────────────────────────────────
const posts = [];
const mock = createMockRgs({
	label: 'match3-wire',
	seed: 'match3-wire',
	quiet: true,
	match3: inputs,
});
const server = createServer((req, res) => mock.handle(req, res, new URL(req.url, 'http://x')));
// What the facade posts, read off its own fetches before they leave.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
	const url = new URL(typeof input === 'string' ? input : input.url);
	if (url.pathname.endsWith('/rgs/engine'))
		posts.push({
			seq: Number(url.searchParams.get('seq')),
			gid: url.searchParams.get('gid'),
			actions: init?.body ? JSON.parse(init.body).map((a) => a.action) : [],
		});
	return realFetch(input, init);
};
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const rgsUrl = `http://127.0.0.1:${server.address().port}`;
const sessionID = 'match3-wire';

const rawPost = (path, body) =>
	new Promise((done, fail) => {
		const req = request(
			`${rgsUrl}${path}`,
			{ method: 'POST', headers: { 'content-type': 'application/json' } },
			(res) => {
				let text = '';
				res.on('data', (chunk) => (text += chunk));
				res.on('end', () => done(JSON.parse(text)));
			},
		);
		req.on('error', fail);
		req.end(JSON.stringify(body));
	});

const auth = await facade.requestAuthenticate({ rgsUrl, sessionID, language: 'en' });
let balance = auth?.balance?.amount;
console.log('one round');
check(typeof balance === 'number', 'authenticate reports a balance');

const toNames = (board) => board.map((reel) => reel.map((gem) => gem.name));
const legalMove = (names, minRun) => {
	const board = createBoard({
		cols: names.length,
		rows: names[0].length,
		cells: names.map((r) => r.map((name) => ({ name }))),
		minRun,
	});
	return findMoves(board, { limit: 1 })[0];
};
const illegalMove = (names, minRun) => {
	const board = createBoard({
		cols: names.length,
		rows: names[0].length,
		cells: names.map((r) => r.map((name) => ({ name }))),
		minRun,
	});
	for (let reel = 0; reel < names.length - 1; reel++)
		for (let row = 0; row < names[0].length; row++) {
			const a = { reel, row };
			const b = { reel: reel + 1, row };
			if (!canSwap(board, a, b)) return { from: a, to: b };
		}
	return undefined;
};

/** Play one whole round through the facade; what it posted and paid. */
const playRound = async ({ refuseOnce = false } = {}) => {
	const from = posts.length;
	const bet = await facade.requestBet({
		rgsUrl,
		sessionID,
		currency: 'USD',
		mode: 'BASE',
		amount: 1,
	});
	const init = bet.round?.state?.find((e) => e.type === 'boardInit');
	const opened = { active: bet.round?.active === true, init, interim: bet.balance?.amount };
	let names = init ? toNames(init.board) : [];
	let movesLeft = init?.movesLeft ?? 0;
	const books = [];
	let end;
	let refused;
	for (let guard = 0; !end && guard < 100; guard++) {
		if (refuseOnce && !refused) {
			const bad = illegalMove(names, inputs.minRun ?? 3);
			const answer = await facade.requestMove({ rgsUrl, sessionID, ...bad });
			refused = { answer, names: JSON.stringify(names), movesLeft };
			const after = answer.round?.state?.find((e) => e.type === 'movesLeft');
			refused.after = after;
			continue;
		}
		const move = legalMove(names, inputs.minRun ?? 3);
		if (!move) break;
		const answer = await facade.requestMove({ rgsUrl, sessionID, from: move.from, to: move.to });
		const book = answer.round?.state ?? [];
		books.push(book);
		const left = book.find((e) => e.type === 'movesLeft');
		if (left) {
			names = toNames(left.board);
			movesLeft = left.count;
		}
		end = book.find((e) => e.type === 'match3RoundEnd');
	}
	// The heartbeat stands down while the round is open.
	const postsBeforePoll = posts.length;
	const poll = await facade.requestBalance({ rgsUrl, sessionID });
	const polled = posts.length !== postsBeforePoll || poll.status.statusCode !== 'SKIPPED';
	const ended = await facade.requestEndRound({ rgsUrl, sessionID });
	return { opened, books, end, refused, polled, ended, posts: posts.slice(from) };
};

const first = await playRound({ refuseOnce: true });
check(
	first.opened.active && Boolean(first.opened.init),
	'the bet opens a round and deals boardInit',
);
check(
	first.opened.init?.movesLeft === inputs.moves,
	`the board comes with the config's ${inputs.moves} moves`,
);
const betPost = first.posts[0];
check(
	betPost?.seq === 0 && !betPost.gid && JSON.stringify(betPost.actions) === '["bet","play"]',
	'the bet is [bet, play] at seq 0 with no gid',
);
const movePosts = first.posts.filter((p) => p.actions[0] === 'move');
check(
	movePosts.every((p, i) => p.seq === 2 + i && p.gid && p.actions.length === 1),
	`each of the ${movePosts.length} moves is one stored action at the next seq (2, 3, …) under the gid`,
);
check(
	first.refused?.answer.round?.state?.some((e) => e.type === 'swap' && e.accepted === false) &&
		first.refused.after?.count === first.refused.movesLeft &&
		JSON.stringify(toNames(first.refused.after.board)) === first.refused.names,
	'a swap that makes no match is refused by the server and changes nothing',
);
check(
	first.books.length === inputs.moves && Boolean(first.end),
	`the round takes its ${inputs.moves} moves and the server ends it`,
);
check(
	first.books.every((book) => book[0]?.type === 'swap' && book.some((e) => e.type === 'movesLeft')),
	'every move book is swap … movesLeft',
);
check(
	first.books.every((book) =>
		book
			.filter((e) => e.type === 'tumbleBoard')
			.every((e) => e.explodingSymbols.every((c) => c.row >= 1 && c.row <= inputs.rows)),
	),
	'exploding cells arrive in the padded rows',
);
check(!first.polled, 'the balance heartbeat sends nothing while the round is open');
const collects = first.posts.filter((p) => p.actions.includes('collect'));
check(
	collects.length === 1 && collects[0].gid,
	'the round is collected exactly once, under its gid',
);
const paid = first.ended.balance.amount - first.opened.interim;
check(
	Math.round(paid / 10_000) === first.end.totalWin,
	`the collect credits exactly the round's total (${first.end.totalWin / 100} × the stake)`,
);
check(first.opened.interim === balance - 1_000_000, 'the bet debits the stake and nothing else');
check(facade.getSessionState(sessionID)?.gid === null, 'the collect closes the round');

// ── Replay at an occupied position ───────────────────────────────────────────
console.log('replay');
{
	const bet = await facade.requestBet({
		rgsUrl,
		sessionID,
		currency: 'USD',
		mode: 'BASE',
		amount: 1,
	});
	const names = toNames(bet.round.state.find((e) => e.type === 'boardInit').board);
	const move = legalMove(names, inputs.minRun ?? 3);
	const first = await facade.requestMove({ rgsUrl, sessionID, from: move.from, to: move.to });
	const gid = facade.getSessionState(sessionID).gid;
	const last = posts.at(-1);
	const balanceBefore = mock.sessions.get(sessionID)?.balance;
	const body = [
		{
			action: 'move',
			context: { from: [move.from.reel, move.from.row], to: [move.to.reel, move.to.row] },
		},
	];
	const again = await rawPost(`/rgs/engine?sid=${sessionID}&seq=${last.seq}&gid=${gid}`, body);
	const once = await rawPost(`/rgs/engine?sid=${sessionID}&seq=${last.seq}&gid=${gid}`, body);
	check(
		JSON.stringify(again.events) === JSON.stringify(once.events) &&
			again.events?.[0]?.event === 'match3Move',
		'a move re-posted at its own seq replays the same answer',
	);
	check(mock.sessions.get(sessionID)?.balance === balanceBefore, 'and charges or pays nothing');
	check(
		facade.getSessionState(sessionID).seq === last.seq + 1,
		'the client position is unchanged by it',
	);
	// Play the round out on the board the server settled on.
	let book = first.round?.state ?? [];
	for (let guard = 0; guard < 100 && !book.some((e) => e.type === 'match3RoundEnd'); guard++) {
		const next = legalMove(
			toNames(book.find((e) => e.type === 'movesLeft').board),
			inputs.minRun ?? 3,
		);
		if (!next) break;
		book =
			(await facade.requestMove({ rgsUrl, sessionID, from: next.from, to: next.to })).round
				?.state ?? [];
	}
	await facade.requestEndRound({ rgsUrl, sessionID });
}

// ── Many rounds: the total is fixed at the bet, the money moves only twice ─────
console.log('rounds');
{
	let exact = 0;
	let rounds = 0;
	let debits = 0;
	for (let i = 0; i < 25; i++) {
		const before = mock.sessions.get(sessionID).balance;
		const round = await playRound();
		const after = mock.sessions.get(sessionID).balance;
		rounds++;
		const gameEnd = round.books.flat().find((e) => e.type === 'match3RoundEnd');
		if (gameEnd && after - before + 100 === gameEnd.totalWin) exact++;
		if (round.opened.interim !== undefined) debits++;
	}
	check(exact === rounds, `${exact}/${rounds} rounds settle exactly the total drawn at the bet`);
	check(debits === rounds, 'every round reports its interim balance at the bet');
}

server.close();
console.log(`\ncheck:match3-wire — ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
