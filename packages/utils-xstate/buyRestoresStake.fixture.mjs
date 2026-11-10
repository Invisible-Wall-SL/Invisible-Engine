/**
 * A buy is one-shot, and its round hands back the stake it replaced: the HUD's ante switch when it
 * was on before the buy (and the session still offers it), else BASE. Driven through the REAL `bet`
 * machine of `createIntermediateMachines` over the real `createPrimaryMachines`, with the real
 * buy-menu commit (`armBetMode`), the real refusal handler of `apps/lines` (`handleBetOptionRefused`)
 * and the real autoplay arming (`armAutoSpins`). Every request is the stubbed `rgs-requests`, which
 * records the mode each bet went out under.
 *
 * Parity is pinned too: a game with no ante switch — no ante, or an ante armed from the buy MENU —
 * still returns to BASE after a buy, exactly as before.
 *
 * The loader is the one in `newGameGate.fixture.mjs` (why `.mjs`: see there).
 *
 *   node --experimental-strip-types packages/utils-xstate/buyRestoresStake.fixture.mjs
 */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const stub = (source) => 'data:text/javascript,' + encodeURIComponent(source);
const STUBS = {
	'$app/state': stub(
		'export const page = { url: new URL("https://game.test/?sessionID=s1&rgs_url=rgs.test") };',
	),
	'rgs-requests': stub(`
		export const requestBet = async (args) => {
			globalThis.__betRequests.push(args.mode);
			if (globalThis.__refused.has(args.mode.toUpperCase())) {
				return { error: 'refused', status: { statusCode: 'ERR_110' } };
			}
			return { balance: { amount: 5000000 }, round: { state: [{ type: 'reveal' }], payoutMultiplier: 0 } };
		};
		export const requestEndRound = async () => ({ balance: { amount: 5000000 } });
	`),
	'error-tracking': stub('export const captureRgsFailure = () => {};'),
	'engine-layout': stub(
		"export const UI_TEXT = { betOptionUnavailable: 'This option is not available right now.' };",
	),
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

globalThis.__betRequests = [];
globalThis.__refused = new Set();

const here = new URL('./', import.meta.url);
const { createActor } = await import('xstate');
const shared = await import(new URL('../state-shared/index.ts', here).href);
const { createPrimaryMachines } = await import(new URL('src/createPrimaryMachines.ts', here).href);
const { createIntermediateMachines } = await import(
	new URL('src/createIntermediateMachines.ts', here).href
);
const { handleBetOptionRefused } = await import(
	new URL('../../apps/lines/src/game/betRefusal.ts', here).href
);

const { stateBet, stateBetDerived, stateMeta, stateMetaDerived, stateModal, armAutoSpins } = shared;

const mode = (key, type, costMultiplier, extra = {}) => ({
	mode: key,
	costMultiplier,
	type,
	parent: '',
	children: '',
	...extra,
});
const BASE = mode('BASE', 'default', 1);
const POWERUP = mode('POWERUP', 'activate', 5, { toggle: true, refusable: true });
const MENU_ANTE = mode('MENU_ANTE', 'activate', 2);
const GOLDSTRIKE = mode('GOLDSTRIKE', 'buy', 100, { refusable: true });
const CENTERCOIN = mode('BUYCENTERCOIN', 'buy', 50, { refusable: true });

/** Getting Hot's menu: a switch ante and two buys. */
const ANTE_SWITCH_GAME = { BASE, POWERUP, BUYCENTERCOIN: CENTERCOIN, GOLDSTRIKE };
/** The Book of Thermopylae shape: a buy and nothing else. */
const BUY_ONLY_GAME = { BASE, GOLDSTRIKE };
/** An ante armed from the buy menu (no switch), beside a buy. */
const MENU_ANTE_GAME = { BASE, MENU_ANTE, GOLDSTRIKE };

let onPlay = () => {};
const primaryMachines = createPrimaryMachines({
	onResumeGameActive: (bet) => bet,
	onResumeGameInactive: () => {},
	onNewGameStart: async () => {},
	onNewGameError: () => {},
	onBetRefused: handleBetOptionRefused,
	onPlayGame: async () => onPlay(),
	checkIsBonusGame: () => false,
});
const { bet: betMachine } = createIntermediateMachines(primaryMachines);

const playRound = () => {
	const actor = createActor(betMachine);
	const done = new Promise((resolve, reject) =>
		actor.subscribe({ complete: resolve, error: reject }),
	);
	actor.start();
	return done;
};

/** The HUD switch press (`doToggleAnte` in `apps/lines` Game.svelte). */
const pressAnteSwitch = () => {
	const ante = stateMetaDerived.anteToggleMode();
	stateBet.activeBetModeKey = stateBetDerived.isAnteArmed() ? 'BASE' : ante.mode;
	stateBet.stakeBeforeBuy = null;
};
/** The buy-menu confirm (`BuyBonusConfirm` / the flow's `commitBuyBonus`): arm, then bet. */
const buy = (key) => {
	stateBetDerived.armBetMode(key);
	return playRound();
};

const reset = (meta) => {
	stateMeta.betModeMeta = meta;
	Object.assign(stateBet, {
		balanceAmount: 1000,
		betAmount: 1,
		autoSpinsCounter: 0,
		activeBetModeKey: 'BASE',
		stakeBeforeBuy: null,
		pendingRoundIsBuy: false,
		isSpaceHold: false,
	});
	stateModal.modal = null;
	globalThis.__betRequests = [];
	globalThis.__refused = new Set();
	onPlay = () => {};
};

let passed = 0;
const check = async (label, meta, body) => {
	reset(meta);
	await body();
	passed += 1;
	console.log(`  ok  ${label}`);
};

console.log('a bought round hands back the stake it replaced');

await check(
	'ante on → buy → the ante is the stake again, and the next bet goes out under it',
	ANTE_SWITCH_GAME,
	async () => {
		pressAnteSwitch();
		assert.equal(stateBet.activeBetModeKey, 'POWERUP');
		await buy('GOLDSTRIKE');
		assert.equal(stateBet.activeBetModeKey, 'POWERUP');
		assert.equal(stateBetDerived.betCost(), 5, 'the readout is the ante stake again');
		assert.equal(stateBet.stakeBeforeBuy, null);
		await playRound();
		assert.deepEqual(globalThis.__betRequests, ['GOLDSTRIKE', 'POWERUP']);
	},
);

await check('the HUD switch reads on through the bought round', ANTE_SWITCH_GAME, async () => {
	pressAnteSwitch();
	let duringBuy;
	onPlay = () => {
		duringBuy = { key: stateBet.activeBetModeKey, armed: stateBetDerived.isAnteArmed() };
	};
	await buy('BUYCENTERCOIN');
	assert.deepEqual(duringBuy, { key: 'BUYCENTERCOIN', armed: true });
	assert.equal(stateBetDerived.isAnteArmed(), true);
});

await check('ante off → buy → BASE', ANTE_SWITCH_GAME, async () => {
	await buy('GOLDSTRIKE');
	assert.equal(stateBet.activeBetModeKey, 'BASE');
	assert.equal(stateBetDerived.isAnteArmed(), false);
});

await check('ante on → off → buy → BASE', ANTE_SWITCH_GAME, async () => {
	pressAnteSwitch();
	pressAnteSwitch();
	await buy('GOLDSTRIKE');
	assert.equal(stateBet.activeBetModeKey, 'BASE');
});

await check(
	'the operator switches the ante off during the bought round → BASE',
	ANTE_SWITCH_GAME,
	async () => {
		pressAnteSwitch();
		onPlay = () => shared.refuseBetMode('POWERUP');
		await buy('GOLDSTRIKE');
		assert.equal(stateBet.activeBetModeKey, 'BASE');
		assert.equal(stateMetaDerived.anteToggleMode(), undefined);
	},
);

await check(
	'the buy itself refused → nothing bought, the ante still on',
	ANTE_SWITCH_GAME,
	async () => {
		pressAnteSwitch();
		globalThis.__refused.add('GOLDSTRIKE');
		await buy('GOLDSTRIKE');
		assert.equal(stateBet.activeBetModeKey, 'POWERUP');
		assert.equal(stateBetDerived.isAnteArmed(), true);
		assert.equal(stateMeta.betModeMeta.GOLDSTRIKE, undefined, 'the refused buy left the menu');
		assert.equal(stateModal.modal, null, 'a toast, not the error modal');
		await playRound();
		assert.deepEqual(globalThis.__betRequests, ['GOLDSTRIKE', 'POWERUP']);
	},
);

await check('the ante refused → BASE', ANTE_SWITCH_GAME, async () => {
	pressAnteSwitch();
	globalThis.__refused.add('POWERUP');
	await playRound();
	assert.equal(stateBet.activeBetModeKey, 'BASE');
	assert.equal(stateMetaDerived.anteToggleMode(), undefined);
});

await check(
	'Space hold: the round after the buy is bet under the ante',
	ANTE_SWITCH_GAME,
	async () => {
		pressAnteSwitch();
		stateBet.isSpaceHold = true;
		let rounds = 0;
		onPlay = () => {
			rounds += 1;
			if (rounds === 2) stateBet.isSpaceHold = false;
		};
		await buy('GOLDSTRIKE');
		assert.deepEqual(globalThis.__betRequests, ['GOLDSTRIKE', 'POWERUP']);
		assert.equal(stateBet.activeBetModeKey, 'POWERUP');
	},
);

await check(
	'autoplay armed over a leftover buy starts under the ante',
	ANTE_SWITCH_GAME,
	async () => {
		pressAnteSwitch();
		stateBetDerived.armBetMode('GOLDSTRIKE');
		armAutoSpins();
		assert.equal(stateBet.activeBetModeKey, 'POWERUP');
	},
);

await check(
	'a resumed buy (the client never armed it) ends at BASE',
	ANTE_SWITCH_GAME,
	async () => {
		stateBet.activeBetModeKey = 'GOLDSTRIKE';
		await playRound();
		assert.equal(stateBet.activeBetModeKey, 'BASE');
	},
);

console.log('parity — a game without an ante switch');

await check(
	'a buy-only game (the Book of Thermopylae shape) returns to BASE',
	BUY_ONLY_GAME,
	async () => {
		await buy('GOLDSTRIKE');
		assert.equal(stateBet.activeBetModeKey, 'BASE');
		assert.equal(stateBetDerived.isAnteArmed(), false);
		await playRound();
		assert.deepEqual(globalThis.__betRequests, ['GOLDSTRIKE', 'BASE']);
	},
);

await check(
	'an ante armed from the buy MENU is replaced by a buy, as before',
	MENU_ANTE_GAME,
	async () => {
		stateBetDerived.armBetMode('MENU_ANTE');
		assert.equal(stateBet.stakeBeforeBuy, null, 'arming an ante records nothing');
		await buy('GOLDSTRIKE');
		assert.equal(stateBet.activeBetModeKey, 'BASE');
	},
);

console.log(`buy restores stake: ${passed} passed`);
