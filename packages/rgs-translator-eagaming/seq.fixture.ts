/**
 * Offline fixture for the `seq` wire value. Run it through tsx:
 *   pnpm --filter launcher-api exec tsx ../../packages/rgs-translator-eagaming/seq.fixture.ts
 *
 * `seq` is the 0-based POSITION in the round's stored action array at which the posted action(s)
 * are placed — NOT a per-request counter. Everything here follows from that one sentence:
 *
 *  1. A REQUEST ADVANCES BY THE NUMBER OF STORED ACTIONS IT CARRIES, NOT BY ONE. We post `bet` and
 *     `play` together, so the next action sits at 2. The counter this replaced advanced once per
 *     request and aimed every later action ONE SLOT SHORT — and a short aim is not a numbering
 *     nit: writing to an occupied position is how the engine REPLAYS, so the round would have
 *     silently replayed its own last step instead of advancing. Our own captured Hot Fruits
 *     `collect` (see `types.ts`) carries `seq=2` after a `bet+play`: the capture was always right.
 *  2. A FULL BONUS ROUND WALKS 0,2,3,4,… — the shape Emanuele described: post `bet+play`, then one
 *     `play` per free spin, then `collect` at the end of the stored array.
 *  3. NON-STORED CALLS CONSUME NO POSITION. `config` and the empty-body balance probe are not
 *     appended, so if they advanced the counter every subsequent action would aim past the end.
 *  4. A NEW ROUND STARTS A NEW, EMPTY ARRAY at 0.
 *  5. AN EXPLICIT POSITION IS PASSED THROUGH AND CONSUMES NOTHING — that is the replay seam: it
 *     must be able to aim backwards repeatedly without disturbing the live position.
 */

import { createPlay4FunSessionState } from './src/sessionState.ts';
import { createPlay4FunFetcher } from './src/eagamingFetcher.ts';
import type { Play4FunRequestBody } from './src/types.ts';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

/** Minimal server: never closes the round, so `endRound()` does not fire mid-walk. */
const fakeFetch = (async () =>
	new Response(JSON.stringify({ events: [], platform: { balance: 1000 } }), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	})) as unknown as typeof fetch;

const harness = () => {
	const session = createPlay4FunSessionState('S-fixture');
	const fetcher = createPlay4FunFetcher(
		{ baseUrl: 'https://rgs.example', sid: 'S-fixture', fetchImpl: fakeFetch },
		session,
	);
	return {
		session,
		post: async (body: Play4FunRequestBody, seqOverride?: number) =>
			(await fetcher.post({ body, seqOverride })).requestSeq,
	};
};

const BET_PLAY: Play4FunRequestBody = [
	{ action: 'bet', context: [0, 10] },
	{ action: 'play', context: '' },
];
const PLAY: Play4FunRequestBody = [{ action: 'play', context: null }];
const COLLECT: Play4FunRequestBody = [{ action: 'collect' }];
const CONFIG: Play4FunRequestBody = [{ action: 'config' }];
const BALANCE: Play4FunRequestBody = [];

console.log('\n1. a request advances by the number of STORED actions it carries');
{
	const h = harness();
	check('bet+play goes at 0', await h.post(BET_PLAY), 0);
	check('...and moved the position by TWO, not one', h.session.seq, 2);
	check('collect goes at 2 (the captured Hot Fruits value)', await h.post(COLLECT), 2);
}

console.log('\n2. a full bonus round walks 0, 2, 3, 4, …');
{
	const h = harness();
	const walk = [await h.post(BET_PLAY)];
	for (let i = 0; i < 3; i++) walk.push(await h.post(PLAY));
	walk.push(await h.post(COLLECT));
	check('bet+play, three free spins, collect', walk, [0, 2, 3, 4, 5]);
	check('the stored array is six actions long', h.session.seq, 6);
}

console.log('\n3. non-stored calls consume no position');
{
	const h = harness();
	check('a balance probe reports 0', await h.post(BALANCE), 0);
	check('a config call reports 0', await h.post(CONFIG), 0);
	check('...and neither moved the position', h.session.seq, 0);
	check('so the first real action still lands at 0', await h.post(BET_PLAY), 0);
	const h2 = harness();
	await h2.post(BET_PLAY);
	await h2.post(BALANCE);
	check('a balance probe mid-round does not shift the next action', await h2.post(COLLECT), 2);
}

console.log('\n4. a new round starts a new, empty array');
{
	const h = harness();
	await h.post(BET_PLAY);
	await h.post(COLLECT);
	h.session.startRound();
	check('back to 0', await h.post(BET_PLAY), 0);
}

console.log('\n5. an explicit position is passed through and consumes nothing');
{
	const h = harness();
	await h.post(BET_PLAY);
	for (let i = 0; i < 3; i++) await h.post(PLAY);
	check('live position is 5', h.session.seq, 5);
	check('replay the first free spin', await h.post(PLAY, 2), 2);
	check('replay the last played', await h.post(PLAY, 4), 4);
	check('...and the live position never moved', h.session.seq, 5);
	check('so the round resumes where it left off', await h.post(COLLECT), 5);
}

console.log(failures === 0 ? '\nAll seq claims hold.\n' : `\n${failures} FAILED claim(s).\n`);
process.exit(failures === 0 ? 0 : 1);
