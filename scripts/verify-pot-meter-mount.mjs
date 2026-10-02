// Offline guard: an authored POT (the `potMeter` component's coded part) mounts WITHOUT a
// reactive loop.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/verify-pot-meter-mount.mjs
//
// THE BUG (fixed): `apps/lines/src/components/PotMeter.svelte` counted its pot in
// (`trackComponentMount`) straight from a tracked `$effect`. Counting in READS the mount count and
// WRITES it, so the read became a dependency of the effect and the write re-ran it — teardown
// counted out, the re-run counted in, forever. Every Pots project on the template's `pots` scene
// raised `effect_update_depth_exceeded` at boot, and without a flow the game crawled. The call now
// runs under `untrack`, as `ComponentInstance` and `LayoutScene` already did.
//
// HOW: the REAL `PotMeter.svelte` is compiled by Svelte's own compiler and mounted through
// Svelte's own CLIENT runtime and scheduler — the code path a browser runs — on a DOM shim just big
// enough for Svelte's anchors. The real `trackComponentMount` / `isComponentMounted` count it;
// only what the pot draws (Pixi, the config) is a stand-in. A reintroduced loop throws from
// `flushSync` here.

import { realpathSync } from 'node:fs';
import { createRequire, register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoFile = (path) => new URL(`../${path}`, import.meta.url).href;
const POT_METER = repoFile('apps/lines/src/components/PotMeter.svelte');
const MOUNTED_COMPONENTS = repoFile('packages/engine-layout/src/lib/mountedComponents.ts');
const POT_SKIN = repoFile('packages/engine-layout/src/lib/potSkin.ts');

const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const harness = 'globalThis.__potMeterHarness';

/**
 * PotMeter's imports, by specifier: everything but the mount count and the skin reader is a
 * stand-in.
 */
const STUBS = {
	'pixi-svelte': moduleUrl('export const Container = () => {};'),
	'./HoldAndWinPot.svelte': moduleUrl('export default () => {};'),
	'engine-layout': moduleUrl(`export { readPotSkin } from '${POT_SKIN}';`),
	'engine-layout/svelte': moduleUrl(`
		import * as real from '${MOUNTED_COMPONENTS}';
		export const getComponentParams = () => ${harness}.params;
		export const isComponentMounted = real.isComponentMounted;
		export const trackComponentMount = (id) => {
			${harness}.countedIn.push(id);
			return real.trackComponentMount(id);
		};
	`),
	'../game/holdAndWinMeters.svelte': moduleUrl(`
		export const configuredMeters = () => ${harness}.meters.get('list');
		export const potMeterMountKey = (id) => 'potMeter:' + id;
	`),
};

register(
	moduleUrl(`
		import { readFile } from 'node:fs/promises';
		import { createRequire } from 'node:module';
		import { fileURLToPath } from 'node:url';

		const STUBS = ${JSON.stringify(STUBS)};
		const POT_METER = ${JSON.stringify(POT_METER)};

		// The browser build of every \`svelte\` entry: the default (server) build has no scheduler,
		// no effects and an \`untrack\` that tracks nothing to begin with.
		export async function resolve(specifier, context, next) {
			if (context.parentURL === POT_METER && STUBS[specifier])
				return { url: STUBS[specifier], shortCircuit: true };
			return next(specifier, { ...context, conditions: [...context.conditions, 'browser'] });
		}

		export async function load(url, context, next) {
			if (url !== POT_METER) return next(url, context);
			const path = fileURLToPath(url);
			const { compile } = createRequire(path)('svelte/compiler');
			const source = await readFile(path, 'utf8');
			const { js } = compile(source, { filename: path, generate: 'client' });
			return { format: 'module', source: js.code, shortCircuit: true };
		}
	`),
	pathToFileURL('./'),
);

// --- the DOM Svelte's anchors need: a tree of nodes, nothing rendered ---------------------------
class Node {
	parentNode = null;
	childNodes = [];
	get firstChild() {
		return this.childNodes[0] ?? null;
	}
	get lastChild() {
		return this.childNodes.at(-1) ?? null;
	}
	get nextSibling() {
		const siblings = this.parentNode?.childNodes;
		return siblings ? (siblings[siblings.indexOf(this) + 1] ?? null) : null;
	}
	insertBefore(node, ref) {
		const nodes = node instanceof DocumentFragment ? [...node.childNodes] : [node];
		for (const child of nodes) {
			child.remove();
			const at = ref ? this.childNodes.indexOf(ref) : -1;
			this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, child);
			child.parentNode = this;
		}
		return node;
	}
	appendChild(node) {
		return this.insertBefore(node, null);
	}
	append(...nodes) {
		for (const node of nodes) this.insertBefore(node, null);
	}
	removeChild(node) {
		node.remove();
		return node;
	}
	before(...nodes) {
		for (const node of nodes) this.parentNode?.insertBefore(node, this);
	}
	after(...nodes) {
		const next = this.nextSibling;
		for (const node of nodes) this.parentNode?.insertBefore(node, next);
	}
	remove() {
		const siblings = this.parentNode?.childNodes;
		if (siblings) siblings.splice(siblings.indexOf(this), 1);
		this.parentNode = null;
	}
	set textContent(_) {
		for (const child of [...this.childNodes]) child.remove();
	}
	addEventListener() {}
	removeEventListener() {}
}
class Element extends Node {}
class DocumentFragment extends Node {}
class CharacterData extends Node {
	constructor(data = '') {
		super();
		this.data = data;
	}
	get nodeValue() {
		return this.data;
	}
}
class Text extends CharacterData {}
class Comment extends CharacterData {}

Object.assign(globalThis, {
	window: globalThis,
	Node,
	Element,
	Text,
	Comment,
	DocumentFragment,
	document: {
		createElement: () => new Element(),
		createTextNode: (data) => new Text(data),
		createComment: (data) => new Comment(data),
		createDocumentFragment: () => new DocumentFragment(),
		addEventListener() {},
		removeEventListener() {},
	},
});

// The component, the real mount count and this harness must share ONE Svelte runtime: with two, the
// count's `SvelteMap` is invisible to the component's effect, the loop cannot happen and every
// check below would pass without testing anything.
const svelteCopies = new Set(
	['package.json', 'apps/lines/package.json', 'packages/engine-layout/package.json'].map((pkg) =>
		realpathSync(createRequire(fileURLToPath(repoFile(pkg))).resolve('svelte/package.json')),
	),
);
if (svelteCopies.size !== 1) {
	console.log(`FAIL  one Svelte runtime — found ${[...svelteCopies].join(', ')}`);
	process.exit(1);
}

const { flushSync, mount, unmount } = await import('svelte');
const { SvelteMap } = await import('svelte/reactivity');
const { isComponentMounted } = await import(MOUNTED_COMPONENTS);
const { default: PotMeter } = await import(POT_METER);

const params = new SvelteMap([['meter', 'red']]);
const meters = new SvelteMap([['list', [{ id: 'red' }, { id: 'blue' }]]]);
const state = { params: { get meter() { return params.get('meter'); } }, meters, countedIn: [] }; // prettier-ignore
globalThis.__potMeterHarness = state;

let failures = 0;
const check = (name, ok, extra = '') => {
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

/** Run Svelte's scheduler to rest; a reactive loop surfaces here as the error it throws. */
const settle = () => {
	try {
		flushSync();
		return null;
	} catch (error) {
		return error;
	}
};
const loopFree = (name, error) =>
	check(name, error === null, error ? String(error.message ?? error).split('\n')[0] : '');

const target = new Element();
let app;
const mountError = (() => {
	try {
		app = mount(PotMeter, { target, props: {} });
		return settle();
	} catch (error) {
		return error;
	}
})();

loopFree('mount: no effect_update_depth_exceeded', mountError);
check('mount: the pot counts itself in once', state.countedIn.length === 1, `counted in ${state.countedIn.length}×`); // prettier-ignore
check('mount: the coded pot for its meter steps aside', isComponentMounted('potMeter:red'));

state.countedIn.length = 0;
params.set('meter', 'blue');
loopFree('meter param changes: no loop', settle());
check('meter param changes: counted out of the old meter', !isComponentMounted('potMeter:red'));
check('meter param changes: counted in under the new one, once', isComponentMounted('potMeter:blue') && state.countedIn.length === 1); // prettier-ignore

// The new meter lands at the index the old one had (the config's order changes in the same flush),
// so only a TRACKED meter id re-runs the effect: a key read under `untrack` would stay on `blue`.
meters.set('list', [{ id: 'red' }, { id: 'blue' }]);
params.set('meter', 'red');
settle();
state.countedIn.length = 0;
meters.set('list', [{ id: 'blue' }, { id: 'red' }]);
params.set('meter', 'blue');
loopFree('meter changes at the same index: no loop', settle());
check('meter changes at the same index: re-counted under the new meter', isComponentMounted('potMeter:blue') && !isComponentMounted('potMeter:red') && state.countedIn.length === 1); // prettier-ignore

params.set('meter', 'green');
loopFree('a meter the config does not declare: no loop', settle());
check('a meter the config does not declare: counts nothing', !isComponentMounted('potMeter:blue') && !isComponentMounted('potMeter:green')); // prettier-ignore

params.set('meter', 'red');
settle();
meters.set('list', [{ id: 'blue' }]);
loopFree('the config drops the meter: no loop', settle());
check('the config drops the meter: counted out', !isComponentMounted('potMeter:red'));

meters.set('list', [{ id: 'red' }, { id: 'blue' }]);
settle();
check('the config declares it again: counted back in', isComponentMounted('potMeter:red'));
if (app) unmount(app);
loopFree('unmount: no loop', settle());
check('unmount: counted back out', !isComponentMounted('potMeter:red'));

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
