/**
 * The two operator gates on a paid round, exercised through the REAL `newGame` actor of
 * `createPrimaryMachines` — not a model of it:
 *
 *  1. `confirmGameRoundStart` — asked BEFORE `onNewGameStart` (the reels must not roll on a round the
 *     player has not agreed to). Yes ⇒ the round proceeds. No ⇒ no bet request, `bet: null`, no error
 *     modal, autoplay stopped, Space hold released — and the real `bet` / `autoBet` machines built on
 *     it run out cleanly. ABSENT ⇒ nothing asked and not one await: the round starts in the same
 *     tick as the actor.
 *  2. `minSpinDuration` — the press is marked on the spin clock before the pre-spin, so the first
 *     reveal times from it. ABSENT (0) or a replay ⇒ no mark.
 *
 * `.mjs` under plain node rather than `.mts` under tsx: tsx loads this package's sources as CommonJS,
 * and a `require` never reaches the load hook that compiles the `.svelte.ts` state. The hook is the
 * one in `scripts/verify-jurisdiction-state.mjs` (Svelte's own `compileModule`, server output). The
 * network and SvelteKit edges are stubbed: `rgs-requests` records each bet request, `$app/state`
 * serves a settable page URL, `error-tracking` is inert.
 *
 *   node --experimental-strip-types packages/utils-xstate/newGameGate.fixture.mjs
 */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const stub = (source) => 'data:text/javascript,' + encodeURIComponent(source);
const STUBS = {
	'$app/state': stub(
		'export const page = { get url() { return new URL(globalThis.__pageUrl); } };',
	),
	'rgs-requests': stub(`
		export const requestBet = async (args) => {
			globalThis.__betRequests.push(args);
			return { balance: { amount: 5000000 }, round: { state: [{ type: 'reveal' }], payoutMultiplier: 0 } };
		};
		export const requestEndRound = async () => ({ balance: { amount: 5000000 } });
	`),
	'error-tracking': stub('export const captureRgsFailure = () => {};'),
	// No `main`, so node would look for `index.js`; the bundler reads `index.ts`.
	'state-shared': new URL('../state-shared/index.ts', import.meta.url).href,
};

register(
	'data:text/javascript,' +
		encodeURIComponent(`
			import { readFile } from 'node:fs/promises';
			import { createRequire, stripTypeScriptTypes } from 'node:module';
			import { fileURLToPath } from 'node:url';

			const STUBS = ${JSON.stringify(STUBS)};

			export async function resolve(specifier, context, next) {
				if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true };
				try {
					return await next(specifier, context);
				} catch (err) {
					// Relative, or a package SUBPATH the bundler resolves to a \`.ts\` (\`utils-shared/amount\`).
					if (!specifier.startsWith('.') && !/^[\\w-]+\\/[\\w/-]+$/.test(specifier)) throw err;
					for (const ext of ['.ts', '/index.ts']) {
						try {
							return await next(specifier + ext, context);
						} catch {}
					}
					throw err;
				}
			}

			export async function load(url, context, next) {
				if (!url.endsWith('.svelte.ts')) return next(url, context);
				const path = fileURLToPath(url);
				const { compileModule } = createRequire(path)('svelte/compiler');
				const js = stripTypeScriptTypes(await readFile(path, 'utf8'));
				const { js: out } = compileModule(js, { filename: path, generate: 'server' });
				return { format: 'module', source: out.code, shortCircuit: true };
			}
		`),
	pathToFileURL('./'),
);

const PLAY_URL = 'https://game.test/?sessionID=s1&rgs_url=rgs.test';
globalThis.__pageUrl = PLAY_URL;
globalThis.__betRequests = [];

const here = new URL('./', import.meta.url);
const { createActor } = await import('xstate');
const shared = await import(new URL('../state-shared/index.ts', here).href);
const { createPrimaryMachines } = await import(new URL('src/createPrimaryMachines.ts', here).href);
const { createIntermediateMachines } = await import(
	new URL('src/createIntermediateMachines.ts', here).href
);

const { stateBet, stateModal, stateOperator, stateRoundConfirm, stateUi, answerRoundStart } =
	shared;
const { spinClock } = shared;

let preSpins = 0;
let preSpinDelayMs = 0;
let playedRounds = 0;
const primaryMachines = createPrimaryMachines({
	onResumeGameActive: (bet) => bet,
	onResumeGameInactive: () => {},
	onNewGameStart: async () => {
		preSpins += 1;
		if (preSpinDelayMs) await new Promise((resolve) => setTimeout(resolve, preSpinDelayMs));
	},
	onNewGameError: () => {},
	onPlayGame: async () => {
		playedRounds += 1;
	},
	checkIsBonusGame: () => false,
});
const { newGame } = primaryMachines;
const intermediate = createIntermediateMachines(primaryMachines);

const run = (machine) => {
	const actor = createActor(machine);
	const done = new Promise((resolve, reject) =>
		actor.subscribe({
			complete: () => resolve(actor.getSnapshot().output),
			error: reject,
		}),
	);
	actor.start();
	return done;
};
const runNewGame = () => run(newGame);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const reset = () => {
	Object.assign(stateOperator, { confirmGameRoundStart: false, minSpinDuration: 0 });
	Object.assign(stateBet, { balanceAmount: 100, betAmount: 1, autoSpinsCounter: 0 });
	stateBet.isSpaceHold = false;
	stateModal.modal = null;
	stateUi.unskippablePresentationActive = false;
	globalThis.__pageUrl = PLAY_URL;
	globalThis.__betRequests = [];
	preSpins = 0;
	preSpinDelayMs = 0;
	playedRounds = 0;
	// Drop any press mark a previous case left behind.
	spinClock.revealDeadline(0);
};

let passed = 0;
const check = async (label, body) => {
	reset();
	await body();
	passed += 1;
	console.log(`  ok  ${label}`);
};

console.log('newGame — confirmGameRoundStart');

await check('ABSENT: nothing is asked and the round starts in the same tick', async () => {
	const done = runNewGame();
	assert.equal(preSpins, 1, 'onNewGameStart ran synchronously from start() — no await before it');
	assert.equal(stateRoundConfirm.open, false);
	const output = await done;
	assert.ok(output.bet, 'the round was placed');
	assert.equal(globalThis.__betRequests.length, 1);
});

await check('PRESENT + yes: asked before the reels roll, then the round proceeds', async () => {
	stateOperator.confirmGameRoundStart = true;
	const done = runNewGame();
	await tick();
	assert.equal(stateRoundConfirm.open, true, 'the question is open');
	assert.equal(preSpins, 0, 'the reels have not started rolling');
	assert.equal(globalThis.__betRequests.length, 0, 'no bet placed yet');
	assert.equal(stateUi.unskippablePresentationActive, true, 'a second spin press is inert');
	answerRoundStart(true);
	const output = await done;
	assert.ok(output.bet);
	assert.equal(preSpins, 1);
	assert.equal(globalThis.__betRequests.length, 1);
	assert.equal(stateRoundConfirm.open, false);
	assert.equal(stateUi.unskippablePresentationActive, false, 'the press latch is restored');
});

await check(
	'PRESENT + no: no request, no modal, autoplay stopped, Space hold released',
	async () => {
		stateOperator.confirmGameRoundStart = true;
		stateBet.autoSpinsCounter = 7;
		stateBet.isSpaceHold = true;
		const done = runNewGame();
		await tick();
		answerRoundStart(false);
		const output = await done;
		assert.equal(output.bet, null, 'a clean empty round — the machine runs out, it does not error');
		assert.equal(globalThis.__betRequests.length, 0);
		assert.equal(preSpins, 0, 'a refused round never rolled');
		assert.equal(stateModal.modal, null, 'no error modal');
		assert.equal(stateBet.autoSpinsCounter, 0);
		assert.equal(stateBet.isSpaceHold, false);
		assert.equal(stateRoundConfirm.open, false);
		assert.equal(stateUi.unskippablePresentationActive, false);
	},
);

await check('PRESENT: every paid round is asked (each autoplay round)', async () => {
	stateOperator.confirmGameRoundStart = true;
	for (let round = 1; round <= 3; round++) {
		const done = runNewGame();
		await tick();
		assert.equal(stateRoundConfirm.open, true, `round ${round} asked`);
		answerRoundStart(true);
		await done;
	}
	assert.equal(globalThis.__betRequests.length, 3);
});

await check('an answer with nothing asked is a no-op', async () => {
	stateBet.autoSpinsCounter = 4;
	answerRoundStart(false);
	assert.equal(stateBet.autoSpinsCounter, 4);
});

await check(
	'PRESENT + no, single bet: the bet machine ends cleanly with nothing played',
	async () => {
		stateOperator.confirmGameRoundStart = true;
		const done = run(intermediate.bet);
		await tick();
		answerRoundStart(false);
		await done;
		assert.equal(playedRounds, 0);
		assert.equal(globalThis.__betRequests.length, 0);
		assert.equal(stateModal.modal, null);
	},
);

await check('PRESENT + no, mid-autoplay: the autoplay machine ends after the refusal', async () => {
	stateOperator.confirmGameRoundStart = true;
	stateBet.autoSpinsCounter = 5;
	const done = run(intermediate.autoBet);
	await tick();
	answerRoundStart(true);
	await tick();
	await tick();
	assert.equal(stateRoundConfirm.open, true, 'the second autoplay round is asked again');
	answerRoundStart(false);
	await done;
	assert.equal(playedRounds, 1, 'only the confirmed round played');
	assert.equal(globalThis.__betRequests.length, 1);
	assert.equal(stateBet.autoSpinsCounter, 0);
	assert.equal(stateModal.modal, null, 'no insufficient-funds / limit modal either');
});

await check('ABSENT: autoplay runs its rounds without a question', async () => {
	stateBet.autoSpinsCounter = 3;
	await run(intermediate.autoBet);
	assert.equal(playedRounds, 3);
	assert.equal(stateRoundConfirm.open, false);
});

console.log('newGame — minSpinDuration press mark');

await check('PRESENT: the press is marked before the pre-spin', async () => {
	stateOperator.minSpinDuration = 1_000;
	preSpinDelayMs = 40;
	const pressedBy = performance.now();
	await runNewGame();
	const deadline = spinClock.revealDeadline(1_000);
	assert.ok(deadline <= pressedBy + 1_000 + 5, 'timed from the press');
	assert.ok(
		spinClock.remainingUntil(deadline) <= 1_000 - 35,
		'the pre-spin and the request already count toward the minimum',
	);
	const next = spinClock.revealDeadline(1_000);
	assert.ok(spinClock.remainingUntil(next) > 990, 'the mark was consumed by the first reveal');
});

await check('ABSENT: no mark — a reveal times from its own start', async () => {
	preSpinDelayMs = 40;
	await runNewGame();
	assert.ok(spinClock.remainingUntil(spinClock.revealDeadline(1_000)) > 990);
});

await check('a replay is exempt: no mark', async () => {
	stateOperator.minSpinDuration = 1_000;
	globalThis.__pageUrl = `${PLAY_URL}&replay=true`;
	preSpinDelayMs = 40;
	await runNewGame();
	assert.ok(spinClock.remainingUntil(spinClock.revealDeadline(1_000)) > 990);
});

console.log(`newGame gates: ${passed} passed`);
