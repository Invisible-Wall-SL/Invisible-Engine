/**
 * The Invisible Test Server playing the OPERATOR: per-project and per-launch host settings.
 *
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs services/test-server/hostSettings.fixture.mjs
 *
 * FOUR claims:
 *
 *  1. NOTHING DECLARED ⇒ NOTHING INJECTED. A game with no `hostSettings` launched with no `?host=`
 *     is served exactly as published — the parity gate, since this server hosts every online game.
 *  2. A PROJECT DECLARES, A LAUNCH OVERRIDES. The URL's fields land on top of the project's, key by
 *     key, and a malformed override is refused whole rather than half-applied.
 *  3. THE INJECTED PAGE IS THE PARTNER'S SHAPE. What the game reads back through the ordinary
 *     `readPageOperatorSettings()` is what was declared — the same path an operator's page takes.
 *  4. NO VALUE CAN BREAK OUT OF THE SCRIPT ELEMENT it is written into.
 */

import vm from 'node:vm';

import { readPageOperatorSettings } from '../../packages/delivery-profile/src/operator.ts';
import {
	hostConfigFor,
	hostOverride,
	injectHostSettings,
	validHostSettings,
} from './hostSettings.mjs';

let failures = 0;
const check = (label, actual, expected) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return console.log(`  ok  ${label}`);
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

const PAGE =
	'<!doctype html><html><head><meta charset="utf-8"><title>g</title></head><body></body></html>';
const TOKEN = 'tok';
const at = (query) =>
	new URL(`http://test.local/hotfruits/${query}${query.includes('?') ? '&' : '?'}k=${TOKEN}`);
const untrusted = (query) => new URL(`http://test.local/hotfruits/${query}`);
const quiet = (fn) => {
	const warn = console.warn;
	const said = [];
	console.warn = (...args) => said.push(args.join(' '));
	try {
		return { value: fn(), said };
	} finally {
		console.warn = warn;
	}
};

/** Run the injected script against a fake window and read it back the way the game does. */
const bootedWith = (html) => {
	const script = html.match(/<script>(.*?)<\/script>/)?.[1];
	const window = {};
	window.parent = window;
	vm.runInNewContext(script ?? '', { window });
	globalThis.window = window;
	try {
		return readPageOperatorSettings();
	} finally {
		delete globalThis.window;
	}
};

console.log('\n1. nothing declared ⇒ nothing injected');
{
	check(
		'no project settings, no query',
		hostConfigFor({ hostSettings: null }, untrusted('')),
		null,
	);
	check('an empty ?host={} declares nothing', hostConfigFor({ hostSettings: null, readToken: TOKEN }, at('?host=%7B%7D')), null); // prettier-ignore
	check('a manifest entry without the key', validHostSettings(undefined, 'g'), null);
	check('an empty object is no declaration', validHostSettings({}, 'g'), null);
	const bad = quiet(() => validHostSettings(['minSpinDuration'], 'g'));
	check('a non-object is refused, loudly', [bad.value, bad.said.length], [null, 1]);
}

console.log('\n2. a project declares, a launch overrides');
{
	const meta = { hostSettings: { minSpinDuration: 3000, clock: true }, readToken: TOKEN };
	check('the project alone', hostConfigFor(meta, untrusted('')), { minSpinDuration: 3000, clock: true }); // prettier-ignore
	const query = `?host=${encodeURIComponent(JSON.stringify({ minSpinDuration: 5000, home: '/lobby' }))}`;
	check('the launch wins key by key', hostConfigFor(meta, at(query)), { minSpinDuration: 5000, clock: true, home: '/lobby' }); // prettier-ignore
	const crafted = quiet(() => hostConfigFor(meta, untrusted(query)));
	check('a link without the read token cannot override', [crafted.value, crafted.said.length], [meta.hostSettings, 1]); // prettier-ignore
	const wrong = quiet(() => hostConfigFor(meta, untrusted(`${query}&k=guess`)));
	check('…nor with a wrong one', wrong.value, meta.hostSettings);
	const noToken = quiet(() => hostConfigFor({ hostSettings: null, readToken: null }, at(query)));
	check('…nor on a game that has no token at all', noToken.value, null);
	const broken = quiet(() => hostOverride(at('?host=%7Bnot-json')));
	check('malformed JSON is refused whole', [broken.value, broken.said.length], [null, 1]);
	check('a JSON array is not a config', quiet(() => hostOverride(at('?host=%5B1%5D'))).value, null);
}

console.log('\n3. the injected page is the partner shape');
{
	const html = injectHostSettings(PAGE, { minSpinDuration: 3000, autoplaySpins: [10, -1], confirmGameRoundStart: true }); // prettier-ignore
	check('injected inside <head>, before anything else', html.indexOf('<script>') === html.indexOf('<head>') + '<head>'.length, true); // prettier-ignore
	const read = bootedWith(html);
	check('the game reads what was declared', [read.minSpinDuration, read.confirmGameRoundStart, read.autoplaySpins?.length], [3000, true, 2]); // prettier-ignore
	check('...and nothing it was not', [read.clock, read.home], [false, null]);
	check('a page with no <head> still gets it first', injectHostSettings('<body></body>', { clock: true }).startsWith('<script>'), true); // prettier-ignore
}

console.log('\n4. no value can break out of the script element');
{
	const html = injectHostSettings(PAGE, { home: '</script><script>alert(1)</script>' });
	check('one script element, not two', html.match(/<script>/g)?.length, 1);
	check('the value still round-trips', bootedWith(html).home, null);
	const dollar = injectHostSettings(PAGE, { currencySymbol: '$&' });
	check("a '$&' in a value is not a replacement pattern", bootedWith(dollar).currencySymbol, '$&');
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
