/**
 * The operator chrome — the clock, session timer, HOME and HISTORY an operator's embed page may
 * declare — as engine feeds and as the fallback strip.
 *
 *   pnpm exec tsx packages/components-ui-html/operatorChrome.fixture.mts    (from the repo root)
 *
 * Runs the REAL `registerOperatorChrome.svelte.ts` and server-renders the REAL
 * `OperatorChrome.svelte`, each compiled by Svelte's own compiler (server output: runes become plain
 * values, effects never run — which is exactly what makes the timer claims checkable: every timer
 * this code starts goes through the injected host). `engine-layout` and `state-shared` are replaced
 * by stubs so the operator's declaration, the locale and the feed registries are in the fixture's
 * hands.
 *
 * FOUR claims:
 *
 *  1. UNDECLARED IS ABSENT. With a neutral operator every show source is false, both value sources
 *     emit '' and start no timer, both actions do nothing, and the strip renders NO element.
 *  2. DECLARED IS SHOWN, AND FORMATTED. Every show source is true; the clock reads `HH:MM` in the
 *     player's locale; the session timer reads `H:MM:SS` since boot (3725 s ⇒ 1:02:05); one timer
 *     serves every subscriber and stops with the last.
 *  3. THE STRIP YIELDS TO THE HUD. An item shows in the strip only while nothing authored subscribes
 *     to its feeds — 0 ⇒ shown, 1 ⇒ hidden, back to 0 ⇒ shown — and the strip's own reads do not count.
 *  4. THE LINKS GO EXACTLY WHERE DECLARED. HOME navigates the top window to the declared URL; HISTORY
 *     opens the declared URL in a new tab — through the registered actions an authored button fires.
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

import type { OperatorChrome, OperatorChromeHost } from './src/registerOperatorChrome.svelte.ts';

interface Operator {
	home: string | null;
	clock: boolean;
	elapsedTime: boolean;
	externalHistoryUrl: string | null;
}
type Subscribable<V> = { subscribe(run: (value: V) => void): () => void };
interface Stub {
	operator: Operator;
	i18n: { locale: string };
	values: Map<string, Subscribable<number | string>>;
	visibility: Map<string, Subscribable<boolean>>;
	actions: Map<string, { onpress: () => void; disabled?: Subscribable<boolean> }>;
}

const NEUTRAL: Operator = {
	home: null,
	clock: false,
	elapsedTime: false,
	externalHistoryUrl: null,
};
const stub: Stub = {
	operator: { ...NEUTRAL },
	i18n: { locale: 'en-GB' },
	values: new Map(),
	visibility: new Map(),
	actions: new Map(),
};
(globalThis as { __operatorChromeStub?: Stub }).__operatorChromeStub = stub;

const stubModule = (source: string) => 'data:text/javascript,' + encodeURIComponent(source);
const STUBS: Record<string, string> = {
	'engine-layout': stubModule(`
		const s = globalThis.__operatorChromeStub;
		const into = (map) => (sources) => { for (const [k, v] of Object.entries(sources)) map.set(k, v); };
		export const registerComponentValues = into(s.values);
		export const registerComponentVisibility = into(s.visibility);
		export const registerComponentActions = into(s.actions);
		export const UI_TEXT = { home: 'HOME', history: 'HISTORY', sessionTime: 'SESSION TIME' };
	`),
	'state-shared': stubModule(`
		const s = globalThis.__operatorChromeStub;
		export const stateOperator = s.operator;
		export const stateI18n = { i18n: s.i18n };
		export const stateI18nDerived = { translate: (text) => text };
	`),
};

register(
	stubModule(`
		import { readFile } from 'node:fs/promises';
		import { createRequire, stripTypeScriptTypes } from 'node:module';
		import { fileURLToPath } from 'node:url';

		const STUBS = ${JSON.stringify(STUBS)};

		export async function resolve(specifier, context, next) {
			if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true };
			try {
				return await next(specifier, context);
			} catch (err) {
				if (!specifier.startsWith('.')) throw err;
				for (const ext of ['.ts', '/index.ts']) {
					try {
						return await next(specifier + ext, context);
					} catch {}
				}
				throw err;
			}
		}

		export async function load(url, context, next) {
			const isModule = url.endsWith('.svelte.ts');
			if (!isModule && !url.endsWith('.svelte')) return next(url, context);
			const path = fileURLToPath(url);
			const svelte = createRequire(path)('svelte/compiler');
			const source = await readFile(path, 'utf8');
			const { js } = isModule
				? svelte.compileModule(stripTypeScriptTypes(source), { filename: path, generate: 'server' })
				: svelte.compile(source, { filename: path, generate: 'server' });
			return { format: 'module', source: js.code, shortCircuit: true };
		}
	`),
	pathToFileURL('./'),
);

const { registerOperatorChrome, formatElapsed, formatClock } = await import(
	new URL('./src/registerOperatorChrome.svelte.ts', import.meta.url).href
);
const { render } = await import('svelte/server');
const { default: OperatorChromeView } = await import(
	new URL('./src/components/OperatorChrome.svelte', import.meta.url).href
);

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

/** A host whose clocks the fixture sets and whose timers it fires by hand. */
function fakeHost() {
	const timers = new Set<{ ms: number; tick: () => void }>();
	const host = {
		wall: new Date(2026, 8, 30, 15, 7, 42).getTime(),
		mono: 1_000,
		navigated: [] as string[],
		opened: [] as string[],
		timersStarted: 0,
		timers,
		fire() {
			for (const timer of [...timers]) timer.tick();
		},
		now: () => host.wall,
		uptime: () => host.mono,
		every(ms: number, tick: () => void) {
			const timer = { ms, tick };
			host.timersStarted += 1;
			timers.add(timer);
			return () => timers.delete(timer);
		},
		navigateTop: (url: string) => host.navigated.push(url),
		openTab: (url: string) => host.opened.push(url),
	};
	return host satisfies OperatorChromeHost;
}

/** Subscribe as an authored HUD node would, keeping every emitted value. */
function listen<V>(source: Subscribable<V> | undefined) {
	const seen: V[] = [];
	if (!source) throw new Error('feed not registered');
	const stop = source.subscribe((value) => seen.push(value));
	return { seen, stop, last: () => seen[seen.length - 1] };
}

/** One synchronous read, released at once — so the read itself leaves no subscriber counted. */
function peek<V>(source: Subscribable<V> | undefined): V | undefined {
	const read = listen(source);
	read.stop();
	return read.last();
}

const declareOperator = (operator: Partial<Operator>) =>
	Object.assign(stub.operator, NEUTRAL, operator);
const ITEMS = ['clock', 'sessionTime', 'home', 'history'] as const;
const SHOW_SOURCES = ['clockShow', 'sessionTimeShow', 'homeShow', 'historyShow'];

console.log('1. undeclared is absent');
{
	declareOperator({});
	const host = fakeHost();
	const chrome: OperatorChrome = registerOperatorChrome(host);
	check('every feed is registered', {
		values: [...stub.values.keys()],
		visibility: [...stub.visibility.keys()],
		actions: [...stub.actions.keys()],
	}, {
		values: ['clock', 'sessionTime'],
		visibility: SHOW_SOURCES,
		actions: ['home', 'history'],
	}); // prettier-ignore
	check('every show source is false', SHOW_SOURCES.map((key) => peek(stub.visibility.get(key))), [false, false, false, false]); // prettier-ignore
	const clock = listen(stub.values.get('clock'));
	const session = listen(stub.values.get('sessionTime'));
	check('the clock emits empty', clock.seen, ['']);
	check('the session timer emits empty', session.seen, ['']);
	check('no timer was started', host.timersStarted, 0);
	check('both actions read as disabled', ['home', 'history'].map((key) => peek(stub.actions.get(key)?.disabled)), [true, true]); // prettier-ignore
	stub.actions.get('home')?.onpress();
	stub.actions.get('history')?.onpress();
	check('both actions are inert', [host.navigated, host.opened], [[], []]);
	check('the strip shows nothing', ITEMS.map((item) => chrome.shows(item)), [false, false, false, false]); // prettier-ignore
	check('the strip renders no element', render(OperatorChromeView).body.replace(/<!--.*?-->/g, ''), ''); // prettier-ignore
}

console.log('\n2. declared is shown, and formatted');
{
	declareOperator({
		clock: true,
		elapsedTime: true,
		home: 'https://lobby.example/casino?from=game',
		externalHistoryUrl: 'https://operator.example/history?player=42',
	});
	const host = fakeHost();
	const chrome: OperatorChrome = registerOperatorChrome(host);
	check('every show source is true', SHOW_SOURCES.map((key) => peek(stub.visibility.get(key))), [true, true, true, true]); // prettier-ignore
	check('neither action reads as disabled', ['home', 'history'].map((key) => peek(stub.actions.get(key)?.disabled)), [false, false]); // prettier-ignore

	const clock = listen(stub.values.get('clock'));
	check('the clock is 24-hour HH:MM in en-GB', clock.last(), '15:07');
	check('one timer runs for the clock', host.timers.size, 1);
	host.wall += 60_000;
	host.fire();
	check('it ticks to the next minute', clock.last(), '15:08');
	const repeats = clock.seen.length;
	host.fire();
	check('an unchanged minute emits nothing', clock.seen.length, repeats);
	const second = listen(stub.values.get('clock'));
	check('a second subscriber gets the value at once', second.seen, ['15:08']);
	check('and shares the one timer', host.timers.size, 1);
	clock.stop();
	second.stop();
	check('the timer stops with the last subscriber', host.timers.size, 0);

	check('en-US writes 12-hour', /^03:07\s?PM$/i.test(formatClock(new Date(2026, 8, 30, 15, 7).getTime(), 'en-US')), true); // prettier-ignore
	check('an operator-spelled pt_BR is read', formatClock(new Date(2026, 8, 30, 15, 7).getTime(), 'pt_BR'), '15:07'); // prettier-ignore
	check('an unreadable locale falls back to en', /^\d{2}:\d{2}/.test(formatClock(0, 'not a locale!')), true); // prettier-ignore

	const session = listen(stub.values.get('sessionTime'));
	check('the session starts at 0:00:00', session.last(), '0:00:00');
	host.mono += 3_725_000;
	host.fire();
	check('3725 s reads 1:02:05', session.last(), '1:02:05');
	check('a long session does not wrap', formatElapsed(100 * 3600_000 + 59_999), '100:00:59');
	session.stop();

	check('the strip shows all four', ITEMS.map((item) => chrome.shows(item)), [true, true, true, true]); // prettier-ignore
	const body = render(OperatorChromeView).body;
	check('the strip renders HOME and HISTORY as buttons', (body.match(/<button[^>]*type="button"/g) ?? []).length, 2); // prettier-ignore
	check('with their captions and labels', ['aria-label="HOME"', 'aria-label="HISTORY"', 'SESSION TIME'].every((text) => body.includes(text)), true); // prettier-ignore
}

console.log('\n3. the strip yields to the HUD');
{
	declareOperator({
		clock: true,
		elapsedTime: true,
		home: '/lobby',
		externalHistoryUrl: '/history',
	});
	const host = fakeHost();
	const chrome: OperatorChrome = registerOperatorChrome(host);
	check('0 subscribers ⇒ the strip draws the clock', chrome.shows('clock'), true);
	const textBox = listen(stub.values.get('clock'));
	check('1 authored clock ⇒ the strip hides it', [chrome.subscribers('clock'), chrome.shows('clock')], [1, false]); // prettier-ignore
	textBox.stop();
	textBox.stop();
	check('unmounted (twice) ⇒ back to 0, drawn again', [chrome.subscribers('clock'), chrome.shows('clock')], [0, true]); // prettier-ignore

	const own = chrome.clock.subscribe(() => {});
	check("the strip's own read is not counted", [chrome.subscribers('clock'), chrome.shows('clock')], [0, true]); // prettier-ignore
	own();

	const gate = listen(stub.visibility.get('clockShow'));
	check('a clockShow gate hides the strip clock too', chrome.shows('clock'), false);
	gate.stop();

	const homeGate = listen(stub.visibility.get('homeShow'));
	check('a homeShow-gated button hides the strip HOME', chrome.shows('home'), false);
	homeGate.stop();
	const homeButton = listen(stub.actions.get('home')?.disabled);
	check('so does a button bound to the home action', chrome.shows('home'), false);
	homeButton.stop();

	const historyGate = listen(stub.visibility.get('historyShow'));
	check('a historyShow-gated button hides the strip HISTORY', [chrome.shows('history'), chrome.shows('home'), chrome.shows('sessionTime')], [false, true, true]); // prettier-ignore
	historyGate.stop();
	const timer = listen(stub.values.get('sessionTime'));
	check('an authored session timer hides the strip one', chrome.shows('sessionTime'), false);
	timer.stop();
	check('all released ⇒ all four drawn', ITEMS.map((item) => chrome.shows(item)), [true, true, true, true]); // prettier-ignore
}

console.log('\n4. the links go exactly where declared');
{
	const home = 'https://lobby.example/casino?from=game';
	const history = 'https://operator.example/history?player=42';
	declareOperator({ home, externalHistoryUrl: history });
	const host = fakeHost();
	registerOperatorChrome(host);
	stub.actions.get('home')?.onpress();
	stub.actions.get('history')?.onpress();
	check('HOME navigates the top window to the declared URL', host.navigated, [home]);
	check('HISTORY opens the declared URL', host.opened, [history]);
	check('no clock declared ⇒ still no timer', listen(stub.values.get('clock')).seen.concat(String(host.timersStarted)), ['', '0']); // prettier-ignore
}

if (failures) {
	console.log(`\n${failures} check(s) failed.`);
	process.exit(1);
}
console.log('\nAll operator-chrome checks passed.');
