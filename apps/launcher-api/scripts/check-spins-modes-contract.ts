/**
 * BONUS GAMES Phase 8a — a spins mode of any game type through the CONTRACT the launcher derives and
 * the REAL test-server factory (`docs/design/bonus-games.md` §0 layer 3).
 *
 *   pnpm --filter launcher-api check:spins-modes-contract
 *
 * `check:spins-modes` plays the mock straight from `potsOverlayMockInputs`; this plays it the way the
 * Invisible Test Server does: `mockContractOfBundle` (the server vocabulary, `inServerNames`, the
 * bet table, `sellsBetModes`) → `validGrid` (`spinsGameShaped`) → `makeMock`.
 *
 * Pins:
 *  1. The lines template with the three sample spins modes, its coin overlay dropping nothing: a buy
 *     tier starts the CLUSTER game and a random metre the LINES game (its own three paylines). The
 *     contract carries each mode's game, in server names.
 *  2. A BOUGHT round debits the buy's price (100× a base round's) and plays 4 cluster spins, paid by
 *     clusters only; its total is the sum of what it paid (the bonus wins and the trigger spin's).
 *  3. A random metre plays 3 spins of the LINES game on its 4×3 grid, paid on its own paylines only.
 *  4. A mode whose strips clash with the wire's names is left out of the contract, and when it was all
 *     that composed the overlay the contract carries no overlay, so the mock still stands.
 */

import { readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { normalizeGameConfigDoc, type GameConfigDoc } from 'game-config';
import {
	CLUSTER_BONUS,
	LINES_BONUS,
	withSpinsModes,
} from '../../../packages/game-config/spinsGame.sample.ts';
import { makeMock, validGrid } from '../../../services/test-server/makeMock.mjs';
import { mockContractOfBundle, type MockContract } from '../src/lib/server/mockContract.ts';
import { protocolFor } from '../src/lib/server/mockProtocol.ts';

const SEED = 'spins-modes-contract';
let failures = 0;
let passes = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (ok) {
		passes += 1;
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}`);
	console.log(`        expected ${JSON.stringify(expected)}`);
	console.log(`        actual   ${JSON.stringify(actual)}`);
};

const normalize = (raw: unknown): GameConfigDoc => {
	const doc = normalizeGameConfigDoc(structuredClone(raw));
	if (!doc) throw new Error('the sample did not normalize');
	return doc;
};
const template = normalize(
	JSON.parse(
		readFileSync(new URL('../src/lib/data/gameConfig/lines.json', import.meta.url), 'utf8'),
	),
);

/** The lines template with the sample's spins modes and an overlay of routes alone. */
const spinsDoc = (edit: (doc: GameConfigDoc) => void = () => {}): GameConfigDoc => {
	const doc = withSpinsModes(structuredClone(template));
	doc.coinOverlay = {
		style: 'classic',
		trigger: {
			buy: [{ betMode: 'bonus', mode: CLUSTER_BONUS, guaranteed: [], boostedSpecials: false }],
			randomMetre: { name: 'Bonus metre', mode: LINES_BONUS },
		},
	};
	edit(doc);
	return normalize(doc);
};

const contractOf = (doc: GameConfigDoc): MockContract =>
	mockContractOfBundle(
		protocolFor('lines'),
		{ config: doc, symbols: { map: {}, index: {} } } as Parameters<typeof mockContractOfBundle>[1],
		SEED,
		'lines',
	);

type Grid = NonNullable<MockContract['grid']> & {
	potsOverlay?: {
		modes?: Record<string, { strips: string[][]; game?: { winModel: { type: string } } }>;
	};
};
type Mock = { handle: (req: unknown, res: unknown, url: URL) => Promise<void> };
type Event = { event: string; context?: unknown };
type Response = {
	events?: Event[];
	platform?: { gameRound?: { id?: string }; balance?: number };
};

/** The test server's own mock for `contract`: `validGrid`, then `makeMock`, as the authoring twin. */
const mockFor = (contract: MockContract): Mock => {
	process.env.SEED = SEED;
	return makeMock(
		contract.protocol,
		SEED,
		validGrid(contract.grid),
		SEED,
		contract.cascade,
		true,
		true,
		false,
	) as Mock;
};

/** One round played as the client plays it, with the balance before and after it. */
const playRound = async (
	mock: Mock,
	context: string | null,
	option: number,
): Promise<{ events: Event[]; before: number; after: number }> => {
	const server = createServer((req, res) =>
		mock.handle(req, res, new URL(req.url ?? '/', 'http://127.0.0.1')),
	);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	const port = typeof address === 'object' && address ? address.port : 0;
	const post = (path: string, body: unknown): Promise<Response> =>
		new Promise((resolve, reject) => {
			const payload = JSON.stringify(body);
			const req = request(
				{
					host: '127.0.0.1',
					port,
					path,
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						'content-length': Buffer.byteLength(payload),
						connection: 'close',
					},
				},
				(res) => {
					let text = '';
					res.setEncoding('utf8');
					res.on('data', (chunk) => (text += chunk));
					res.on('end', () => resolve(JSON.parse(text) as Response));
				},
			);
			req.on('error', reject);
			req.end(payload);
		});
	const log = console.log;
	console.log = () => {};
	const events: Event[] = [];
	try {
		const sid = `${SEED}-${context}-${option}`;
		await post(`/rgs/engine?sid=${sid}&seq=0`, [{ action: 'config' }]);
		const before = (await post(`/rgs/engine?sid=${sid}`, [])).platform?.balance ?? NaN;
		let seq = 0;
		let resp = await post(`/rgs/engine?sid=${sid}&seq=${seq}`, [
			{ action: 'bet', context: [option, 1] },
			{ action: 'play', context },
		]);
		seq += 2;
		events.push(...(resp.events ?? []));
		const gid = resp.platform?.gameRound?.id;
		const ended = () => events.some((e) => e.event === 'gameEnd');
		for (let guard = 0; gid && !ended() && guard < 300; guard++) {
			resp = await post(`/rgs/engine?sid=${sid}&seq=${seq++}&gid=${gid}`, [{ action: 'play' }]);
			events.push(...(resp.events ?? []));
		}
		if (gid) await post(`/rgs/engine?sid=${sid}&seq=${seq}&gid=${gid}`, [{ action: 'collect' }]);
		const after = (await post(`/rgs/engine?sid=${sid}`, [])).platform?.balance ?? NaN;
		return { events, before, after };
	} finally {
		console.log = log;
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
};

const pays = (events: Event[], from = 0) =>
	events
		.slice(from)
		.filter((e) => e.event === 'spinWin')
		.map((e) => e.context as { pay: number; mode: string; what: string; context?: unknown });
const total = (events: Event[]) =>
	(events.find((e) => e.event === 'gameEnd')?.context as { win?: number } | undefined)?.win ?? 0;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

// ─── 1. the contract ──────────────────────────────────────────────────────────────────────────

const DOC = spinsDoc();
const CONTRACT = contractOf(DOC);
const modes = (CONTRACT.grid as Grid).potsOverlay?.modes ?? {};
check(
	'contract: the bought and the metred spins games, each with its game',
	Object.entries(modes)
		.map(([id, m]) => [id, m.game?.winModel.type])
		.sort(),
	[
		[CLUSTER_BONUS, 'cluster'],
		[LINES_BONUS, 'lines'],
	],
);
check(
	'contract: their strips in the server vocabulary',
	Object.values(modes).every((m) => m.strips.flat().every((name) => !/^[HL]\d$/.test(name))),
	true,
);
check(
	'contract: the test server accepts the overlay',
	Boolean(validGrid(CONTRACT.grid)?.potsOverlay),
	true,
);

const MOCK = () => mockFor(CONTRACT);

// ─── 2. a bought round ────────────────────────────────────────────────────────────────────────

const base = await playRound(MOCK(), null, 0);
const bought = await playRound(MOCK(), null, 1);
const baseDebit = base.before - base.after + total(base.events);
const boughtDebit = bought.before - bought.after + total(bought.events);
check('buy: the price debited is 100 base rounds', boughtDebit, baseDebit * 100);
const boughtTrigger = bought.events.find((e) => e.event === 'spinTrigger')?.context as
	{ bonus?: string; spins?: { spins: number }[] } | undefined;
check(
	'buy: starts the cluster game, 4 spins',
	[boughtTrigger?.bonus, boughtTrigger?.spins?.[0]?.spins],
	[CLUSTER_BONUS, 4],
);
const enterAt = bought.events.findIndex((e) => e.event === 'enterBonus');
const bonusPays = pays(bought.events, enterAt).filter((w) => w.what !== 'SCAT');
check('buy: the bonus pays', bonusPays.length > 0, true);
check('buy: paid by clusters only', [...new Set(bonusPays.map((w) => w.mode))], ['cluster']);
check(
	'buy: the total is the sum of what it paid',
	total(bought.events),
	sum(pays(bought.events).map((w) => w.pay)),
);
const bonusWins = bought.events
	.filter((e) => e.event === 'bonusWin')
	.map((e) => (e.context as { pay: number }).pay);
check(
	'buy: the bonus wins are the bonus spins’ pays',
	sum(bonusWins),
	sum(pays(bought.events, enterAt).map((w) => w.pay)),
);

// ─── 3. a random metre → the lines game ───────────────────────────────────────────────────────

const metred = await playRound(MOCK(), 'force:trigger:randomMetre', 0);
const metreTrigger = metred.events.find((e) => e.event === 'spinTrigger')?.context as
	{ bonus?: string } | undefined;
check('metre: starts the lines game', metreTrigger?.bonus, LINES_BONUS);
const metreAt = metred.events.findIndex((e) => e.event === 'enterBonus');
const boards = metred.events
	.slice(metreAt)
	.filter((e) => e.event === 'playedSpin')
	.map((e) => e.context as string[][]);
check(
	'metre: 3 spins on its 4×3 grid',
	boards.map((b) => `${b.length}×${b[0]?.length}`),
	['4×3', '4×3', '4×3'],
);
const lineWins = pays(metred.events, metreAt).filter((w) => w.what !== 'SCAT');
check('metre: the lines game pays', lineWins.length > 0, true);
check(
	'metre: paid on its own three paylines only',
	lineWins.every(
		(w) =>
			w.mode === 'line' && [1, 2, 3].includes((w.context as { paylineId?: number }).paylineId ?? 0),
	),
	true,
);

// ─── 4. a clashing mode leaves no empty overlay ───────────────────────────────────────────────

const clashing = spinsDoc((doc) => {
	// `PIC1` is a server name: on a strip it reads as the host's own symbol, so the mode is a stub.
	doc.symbols.PIC1 = { paytable: [{ 3: 1 }] };
	doc.paddingReels.clusterBonus = doc.paddingReels.clusterBonus.map((strip) =>
		strip.map((cell, i) => (i === 0 ? { name: 'PIC1' } : cell)),
	);
	doc.coinOverlay!.trigger = {
		buy: [{ betMode: 'bonus', mode: CLUSTER_BONUS, guaranteed: [], boostedSpecials: false }],
	};
});
const warn = console.warn;
console.warn = () => {};
const clashContract = contractOf(clashing);
console.warn = warn;
check(
	'clash: no overlay is left in the contract',
	(clashContract.grid as Grid | undefined)?.potsOverlay,
	undefined,
);
let stands = true;
try {
	mockFor(clashContract);
} catch {
	stands = false;
}
check('clash: the mock still stands', stands, true);

console.log(
	failures
		? `\ncheck:spins-modes-contract — ${failures} FAILED, ${passes} passed`
		: `\ncheck:spins-modes-contract — all ${passes} passed`,
);
process.exit(failures ? 1 : 0);
