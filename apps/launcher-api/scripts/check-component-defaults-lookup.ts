/**
 * A project's component defaults are found by the REAL `ComponentDef.id`, whichever way the sidecar
 * was written:
 *   pnpm --filter launcher-api check:component-defaults-lookup
 *
 * `listComponentDefaults` keys a sidecar by the id stamped inside it (`lettersStrip`), or, for one
 * written before the stamp, by its slugged filename (`respincells`). `componentDefaultsFor` must
 * find both from the def id, because `resolveComponentClosure` reads a `component`-kind param's
 * project default through it: a miss leaves the tile that default names out of the shipped closure
 * (runtime bundle, doc bake, art export).
 *
 * Runs the REAL storage module over an in-memory `r2.ts`, and the REAL closure resolver over the
 * built-in Letters Strip and Respin Cell Tiles.
 */
import { mock } from 'node:test';
import {
	LETTERS_STRIP_DEF,
	RESPIN_CELLS_DEF,
	resolveComponentClosure,
	type ComponentDef,
	type LayoutNode,
} from 'engine-layout';

const bucket = new Map<string, { text: string; etag: string }>();
let puts = 0;

class ConflictError extends Error {
	constructor(readonly key: string) {
		super(`Conditional write failed for ${key}`);
		this.name = 'ConflictError';
	}
}

mock.module(new URL('../src/lib/server/r2.ts', import.meta.url).href, {
	namedExports: {
		ConflictError,
		precondition: (baseEtag: string | null | undefined) => {
			if (baseEtag === undefined) return undefined;
			return baseEtag === null ? { ifNoneMatch: '*' } : { ifMatch: baseEtag };
		},
		headObject: async (key: string) => {
			const o = bucket.get(key);
			return o ? { etag: o.etag, size: o.text.length, lastModified: 0 } : null;
		},
		copyObject: async () => false,
		putObjectText: async (key: string, text: string) => {
			const etag = `"${++puts}"`;
			bucket.set(key, { text, etag });
			return etag;
		},
		getObjectText: async (key: string) => bucket.get(key)?.text ?? null,
		getObjectTextWithEtag: async (key: string) => bucket.get(key) ?? null,
		listAllObjects: async () => [],
		deleteObjects: async () => {},
		listAllKeys: async (prefix: string) =>
			[...bucket.keys()].filter((key) => key.startsWith(prefix)),
	},
});

const { projectComponentDefaultsKey } = await import('../src/lib/server/projectPaths.ts');
const {
	componentDefaultsFor,
	keyComponentDefaultsById,
	listComponentDefaults,
	saveComponentDefaults,
} = await import('../src/lib/server/componentDefaultsStorage.ts');

let checks = 0;
let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures++;
	console.error(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`);
}

const PROJECT = 'lookup';

// A sidecar saved today carries its real id; one saved before the stamp has only `params`.
await saveComponentDefaults(PROJECT, LETTERS_STRIP_DEF.id, { tile: 'letterTile' }, null);
bucket.set(projectComponentDefaultsKey(PROJECT, RESPIN_CELLS_DEF.id), {
	text: JSON.stringify({ params: { tile: 'cellTile' } }),
	etag: '"legacy"',
});

check(
	'a save stamps the real id into the slugged sidecar',
	JSON.parse(bucket.get(projectComponentDefaultsKey(PROJECT, 'lettersStrip'))?.text ?? '{}'),
	{ id: 'lettersStrip', params: { tile: 'letterTile' } },
);

const listed = await listComponentDefaults(PROJECT);
check(
	'the listing keys a stamped sidecar by its id and a legacy one by its filename',
	Object.keys(listed).sort(),
	['lettersStrip', 'respincells'],
);
check(
	'a stamped camelCase sidecar resolves by its real id',
	componentDefaultsFor(listed, 'lettersStrip'),
	{ tile: 'letterTile' },
);
check(
	'a legacy unstamped sidecar resolves by its slug',
	componentDefaultsFor(listed, 'respinCells'),
	{ tile: 'cellTile' },
);
check(
	'a component with no sidecar has no defaults',
	componentDefaultsFor(listed, 'lockedRow'),
	undefined,
);
check(
	'aliasing by id keeps every listed key and adds the real ids',
	Object.keys(keyComponentDefaultsById(listed, ['lettersStrip', 'respinCells'])).sort(),
	['lettersStrip', 'respinCells', 'respincells'],
);

// The closure the runtime bundle, the doc bake and the art export share: a tile named only by the
// project's defaults must ship.
const tile = (id: string): ComponentDef => ({
	id,
	name: id,
	version: 1,
	scope: 'project',
	category: 'ui',
	root: { id: `${id}-root`, kind: 'container', x: 0, y: 0, children: [] },
});
const library: Record<string, ComponentDef> = {
	lettersStrip: LETTERS_STRIP_DEF,
	respinCells: RESPIN_CELLS_DEF,
	letterTile: tile('letterTile'),
	cellTile: tile('cellTile'),
};
const placed: LayoutNode[] = [
	{ id: 'strip', kind: 'componentInstance', componentId: 'lettersStrip', x: 0, y: 0 },
	{ id: 'cells', kind: 'componentInstance', componentId: 'respinCells', x: 0, y: 0 },
];
const defs = await resolveComponentClosure(placed, async (id) => library[id], {
	defaultsFor: (id) => componentDefaultsFor(listed, id),
});
check(
	"the closure ships the tile each strip's project default names, stamped or legacy",
	Object.keys(defs),
	['lettersStrip', 'respinCells', 'letterTile', 'cellTile'],
);

console.log();
if (failures) {
	console.error(`${failures} of ${checks} component-defaults lookup checks FAILED`);
	process.exit(1);
}
console.log(`all ${checks} component-defaults lookup checks pass`);
