/**
 * `DeployMirror` (`src/lib/server/deployMirror.ts`) — the write-then-prune every exporter runs over
 * its `deploy/` subtree — over an in-memory R2:
 *
 *   1. what the pass writes (put / putAll / a copy whose source exists / a claimed key) survives
 *      the commit, byte for byte;
 *   2. everything else under the prefix is deleted — and nothing outside it, even a key the pass
 *      recorded or a neighbour's subtree sharing the prefix's leading characters;
 *   3. a copy whose source is missing is not kept (so a stale copy of it is pruned) and says so;
 *   4. an empty pass empties the subtree;
 *   5. `putAll` keeps no more than its limit in flight.
 *
 *   pnpm --filter launcher-api check:deploy-mirror
 */
import { mock } from 'node:test';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (!ok) failures += 1;
	console.log(`${ok ? '  ok ' : 'FAIL '} ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
};

const R2 = new Map<string, string>();
let inFlight = 0;
let peak = 0;
const r2Url = new URL('../src/lib/server/r2.ts', import.meta.url).href;
const r2 = await import(r2Url);
mock.module(r2Url, {
	namedExports: {
		...r2,
		putObjectText: async (key: string, text: string) => {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			await new Promise((r) => setTimeout(r, 2));
			inFlight -= 1;
			R2.set(key, text);
			return '"e"';
		},
		copyObject: async (from: string, to: string) => {
			if (!R2.has(from)) return false;
			R2.set(to, R2.get(from)!);
			return true;
		},
		listAllKeys: async (prefix: string) => [...R2.keys()].filter((k) => k.startsWith(prefix)),
		deleteObjects: async (keys: string[]) => keys.forEach((k) => R2.delete(k)),
	},
});
const { DeployMirror } = await import('../src/lib/server/deployMirror.ts');

const P = 'c/p/deploy/effects/';
const seed = (entries: Record<string, string>) => {
	R2.clear();
	for (const [k, v] of Object.entries(entries)) R2.set(k, v);
};

seed({
	[`${P}old.json`]: 'stale',
	[`${P}keep.json`]: 'v1',
	[`${P}nested/old.json`]: 'stale',
	[`${P}gone-copy.json`]: 'stale copy',
	'c/p/deploy/effects-other/x.json': 'neighbour',
	'c/p/deploy/editor-art/a.json': 'neighbour',
	'c/p/src/page.png': 'png',
	'c/p/src/rig.json': 'rig',
});
const mirror = new DeployMirror(P);
await mirror.put(`${P}keep.json`, 'v2');
await mirror.putAll([
	{ key: `${P}a.json`, text: 'A' },
	{ key: `${P}b.json`, text: 'B' },
]);
const copied = await mirror.copy('c/p/src/page.png', `${P}page.png`);
const missing = await mirror.copy('c/p/src/missing.png', `${P}gone-copy.json`);
mirror.claim([`${P}rig/rig.json`, 'c/p/deploy/_pages/outside.webp']);
R2.set(`${P}rig/rig.json`, 'written by a rig export');
await mirror.commit();

console.log('1. what the pass wrote survives');
check('put overwrites in place', R2.get(`${P}keep.json`) === 'v2');
check('putAll writes each file', R2.get(`${P}a.json`) === 'A' && R2.get(`${P}b.json`) === 'B');
check('a copy lands and is kept', copied && R2.get(`${P}page.png`) === 'png');
check('a claimed key is kept', R2.get(`${P}rig/rig.json`) === 'written by a rig export');

console.log('2. the rest of the subtree is pruned, nothing outside it');
check('a stale file is deleted', !R2.has(`${P}old.json`));
check('a stale nested file is deleted', !R2.has(`${P}nested/old.json`));
check(
	'a neighbour sharing the prefix text is untouched',
	R2.has('c/p/deploy/effects-other/x.json'),
);
check('another subtree is untouched', R2.has('c/p/deploy/editor-art/a.json'));
check('sources are untouched', R2.has('c/p/src/page.png') && R2.has('c/p/src/rig.json'));
check(
	'exactly the expected keys remain under the prefix',
	JSON.stringify([...R2.keys()].filter((k) => k.startsWith(P)).sort()) ===
		JSON.stringify([
			`${P}a.json`,
			`${P}b.json`,
			`${P}keep.json`,
			`${P}page.png`,
			`${P}rig/rig.json`,
		]),
	[...R2.keys()].filter((k) => k.startsWith(P)).join(', '),
);

console.log('3. a copy with no source is not kept');
check('copy reports false', missing === false);
check('its stale destination is pruned', !R2.has(`${P}gone-copy.json`));
check('it is not recorded', !mirror.written.has(`${P}gone-copy.json`));

console.log('4. an empty pass empties the subtree');
seed({ [`${P}x.json`]: 'x', [`${P}y/z.json`]: 'z', 'c/p/deploy/other/k.json': 'k' });
const empty = new DeployMirror(P);
check('stale() lists everything under the prefix', (await empty.stale()).length === 2);
await empty.commit();
check(
	'the subtree is empty',
	[...R2.keys()].every((k) => !k.startsWith(P)),
);
check('the neighbour survives', R2.has('c/p/deploy/other/k.json'));

console.log('5. putAll is bounded');
R2.clear();
peak = 0;
const many = Array.from({ length: 20 }, (_, i) => ({ key: `${P}${i}.json`, text: String(i) }));
await new DeployMirror(P).putAll(many, 3);
check('no more than 3 writes in flight', peak <= 3 && peak > 1, `peak ${peak}`);
check(
	'every file written',
	many.every(({ key, text }) => R2.get(key) === text),
);

console.log();
if (failures) {
	console.error(`${failures} deploy-mirror check(s) FAILED`);
	process.exit(1);
}
console.log('all deploy-mirror checks pass');
