/**
 * Offline fixture for reading the OPERATOR'S EMBED PAGE. Run with tsx:
 *   pnpm --filter launcher-api exec tsx ../../packages/delivery-profile/host.fixture.ts
 *
 * A partner boots our client from a wrapper that resolves the session and the game's settings
 * server-side and hands the browser one `params.GameSettings` object. Three unrelated consumers
 * read it — the session token, the bet ladder, the jurisdiction flags — so it has ONE reader here.
 *
 * FIVE claims:
 *
 *  1. NO EMBED PAGE, NO BEHAVIOUR. Every game we run today launches from a URL we generate, with no
 *     `params` anywhere. That must read as "nothing to say", not as an empty config that overrides
 *     things — this is the parity gate for the whole feature.
 *  2. THE PAGE IS READ WHEN IT IS THERE, and the pieces are typed on the way out: a token that is
 *     not a string is no token, a config that is not an object is an empty one.
 *  3. AN IFRAMED CLIENT READS ITS PARENT. A delivered build may run inside the embed page rather
 *     than as it, which puts `params` on the OUTER document.
 *  4. A CROSS-ORIGIN PARENT IS NOT AN ERROR. Touching one throws, and that throw is precisely the
 *     case where we have no business reading it — so it means "no host settings", not a crash on
 *     someone else's site.
 *  5. `hostBoolean` TELLS "STATED FALSE" FROM "NOT STATED". This is the whole point for jurisdiction:
 *     overriding a default because the operator was SILENT is how a game ends up disabling turbo
 *     nobody disabled.
 */

import { hostBoolean, hostNumber, readHostGameSettings } from './src/host.ts';

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

const g = globalThis as Record<string, unknown>;

/** Stand up a fake page. `parent` models an iframe; `crossOrigin` models one we may not touch. */
const page = (options: { own?: unknown; parent?: unknown; crossOrigin?: boolean }) => {
	const parentWindow = options.crossOrigin
		? new Proxy(
				{},
				{
					get() {
						throw new DOMException('Blocked a frame from accessing a cross-origin frame.');
					},
				},
			)
		: options.parent !== undefined
			? { params: options.parent }
			: undefined;

	const win: Record<string, unknown> = {};
	if (options.own !== undefined) win.params = options.own;
	win.parent = parentWindow ?? win;
	g.window = win;
};

const SETTINGS = {
	GameSettings: {
		token: 'S00069af',
		service: 'webnode/engine',
		config: { betMultipliers: [1, 2, 4], denom: 0.01, enableTurbo: true, autoplaySpins: [10, 25] },
	},
};

const main = () => {
	console.log('\n1. no embed page, no behaviour');
	{
		delete g.window;
		check('no window at all', readHostGameSettings(), null);
		check('...and no numbers', hostNumber('balanceUpdateInterval'), null);
		check('...and no booleans', hostBoolean('enableTurbo'), null);
		page({});
		check('a window with no params', readHostGameSettings(), null);
		page({ own: {} });
		check('params with no GameSettings', readHostGameSettings(), null);
	}

	console.log('\n2. the page is read when it is there, and typed on the way out');
	{
		page({ own: SETTINGS });
		const settings = readHostGameSettings()!;
		check('token', settings.token, 'S00069af');
		check('service', settings.service, 'webnode/engine');
		check('denom', settings.config.denom, 0.01);
		check('a number the operator stated', hostNumber('denom'), 0.01);
		check('a number it did not', hostNumber('balanceUpdateInterval'), null);

		page({ own: { GameSettings: { token: 12345, config: 'nope' } } });
		const odd = readHostGameSettings()!;
		check('a non-string token is no token', odd.token, '');
		check('a non-object config is an empty one', odd.config, {});
		check('...and is still not a crash', typeof odd, 'object');

		page({ own: { GameSettings: { token: 'T' } } });
		check('a token with no config at all', readHostGameSettings()!.token, 'T');
	}

	console.log('\n3. an iframed client reads its parent');
	{
		page({ parent: SETTINGS });
		check('found on the outer document', readHostGameSettings()!.token, 'S00069af');
		page({ own: { GameSettings: { token: 'OWN' } }, parent: SETTINGS });
		check('our own page wins when it has one', readHostGameSettings()!.token, 'OWN');
	}

	console.log('\n4. a cross-origin parent is not an error');
	{
		page({ crossOrigin: true });
		check('reads as "no host settings"', readHostGameSettings(), null);
		check('...and the accessors agree', [hostNumber('denom'), hostBoolean('enableTurbo')], [null, null]); // prettier-ignore
	}

	console.log('\n5. hostBoolean tells "stated false" from "not stated"');
	{
		page({ own: { GameSettings: { config: { enableTurbo: false, allowOutcomeBuy: true } } } });
		check('stated false', hostBoolean('enableTurbo'), false);
		check('stated true', hostBoolean('allowOutcomeBuy'), true);
		check('not stated at all', hostBoolean('showTheoreticalPayback'), null);
		check('a non-boolean is not a statement', hostBoolean('denom'), null);
		// The distinction that matters: `false` and `null` are different answers, and only one of
		// them may override a default.
		check('false is not null', hostBoolean('enableTurbo') === null, false);
	}

	console.log(failures === 0 ? '\nAll host-page claims hold.\n' : `\n${failures} FAILED.\n`);
	process.exit(failures === 0 ? 0 : 1);
};

main();
