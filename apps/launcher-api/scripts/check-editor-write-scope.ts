/**
 * The editor-only session-bound writes refuse a tab that is on another project, and one that names
 * none (Rive plan Phase 4c):
 *   pnpm --filter launcher-api check:editor-write-scope
 *
 * Runs the REAL `/api/editor/rigs/upload`, `/api/editor/art-bounds`, `/api/editor/import` and
 * `/api/editor/flipbooks` handlers and the real
 * `scopeGuard`. Only the boundaries are replaced: the session gate (fixed project `p1`), R2's URL
 * signer, the rig-extension table and the art-bounds store. `editor/backups` is covered in
 * `check-doc-backups.ts` and `editor/rigs/reindex` in `check-rigger-writes.ts`, beside their other
 * behaviour.
 */
import { mock } from 'node:test';
import { error, isHttpError } from '@sveltejs/kit';

const server = (path: string): string => new URL(`../src/lib/server/${path}`, import.meta.url).href;
const SESSION = { clientKey: 'c', projectKey: 'p1' };
const signed: string[] = [];
const saved: unknown[] = [];

mock.module(server('toolScope.ts'), {
	namedExports: {
		gate: async (locals: { user?: unknown }) => {
			if (!locals.user) throw error(401, 'Not authenticated');
			return { ...SESSION, prefixes: [] };
		},
	},
});
mock.module(server('r2.ts'), {
	namedExports: {
		presignPut: async (key: string) => {
			signed.push(key);
			return `https://r2.test/${key}`;
		},
		jsonBaseEtag: (v: unknown) => (v === null ? null : typeof v === 'string' ? v : undefined),
		formBaseEtag: (v: unknown) => (typeof v !== 'string' ? undefined : v === '' ? null : v),
	},
});
mock.module(server('rigIndex.ts'), {
	namedExports: {
		RIG_ASSET_EXT: new Set(['.json', '.atlas', '.png']),
		rigExt: (name: string) => name.slice(name.lastIndexOf('.')).toLowerCase(),
		contentTypeForRigFile: () => 'application/octet-stream',
	},
});
mock.module(server('artBoundsStorage.ts'), {
	namedExports: {
		ConflictError: class extends Error {},
		loadArtBoundsDocWithEtag: async () => ({ doc: { bounds: { 'a::b': { x: 0 } } }, etag: '"e"' }),
		saveArtBoundsDoc: async (_c: string, _p: string, doc: unknown) => {
			saved.push(doc);
			return { doc, etag: '"e2"' };
		},
	},
});
mock.module(server('artSlicesStorage.ts'), {
	namedExports: {
		ConflictError: class extends Error {},
		loadArtSlicesDocWithEtag: async () => ({ doc: { slices: {} }, etag: '"e"' }),
		saveArtSlicesDoc: async (_c: string, _p: string, doc: unknown) => {
			saved.push(doc);
			return { doc, etag: '"e2"' };
		},
	},
});

const flipbookReads: string[] = [];
mock.module(server('flipbookStorage.ts'), {
	namedExports: {
		loadFlipbookDoc: async (_c: string, projectKey: string) => {
			flipbookReads.push(projectKey);
			return { clips: [] };
		},
	},
});
mock.module(server('projectAssets.ts'), {
	namedExports: { listProjectAssets: async () => ({ atlases: [], spines: [], sheets: [] }) },
});
mock.module(server('editorRegions.ts'), {
	namedExports: { loadRegionSet: async (key: string) => ({ assetKey: key, regions: [] }) },
});

const routes = new URL('../src/routes/api/editor/', import.meta.url).href;
const upload = await import(`${routes}rigs/upload/+server.ts`);
const artBounds = await import(`${routes}art-bounds/+server.ts`);
const artSlices = await import(`${routes}art-slices/+server.ts`);
const importRoute = await import(`${routes}import/+server.ts`);
const flipbooks = await import(`${routes}flipbooks/+server.ts`);

type Handler = (event: never) => Promise<Response>;
interface Answer {
	status: number;
	body: Record<string, unknown>;
}
async function call(handler: Handler, path: string, body?: unknown): Promise<Answer> {
	const url = new URL(`http://launcher.test${path}`);
	const init = body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) };
	const event = {
		request: new Request(url, init),
		url,
		locals: { user: { id: 'u', role: 'artist' } },
		cookies: { get: () => 'session-token' },
	};
	try {
		const res = await handler(event as never);
		return { status: res.status, body: (await res.json()) as Record<string, unknown> };
	} catch (e) {
		if (isHttpError(e)) return { status: e.status, body: { message: e.body.message } };
		throw e;
	}
}

let failures = 0;
let passes = 0;
function check(name: string, actual: unknown, expected: unknown): void {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		passes++;
		return;
	}
	failures++;
	console.error(`✗ ${name}\n    expected ${e}\n    got      ${a}`);
}
const outcome = (a: Answer) => [a.status, a.body.error ?? null];

// ── rigs/upload ──────────────────────────────────────────────────────────────
const files = ['hero/hero.json'];
check(
	'rig upload from a tab on another project: 409 scope-mismatch, nothing signed',
	[...outcome(await call(upload.POST, '/u', { files, projectKey: 'p2' })), signed.length],
	[409, 'scope-mismatch', 0],
);
check(
	'rig upload naming no project: 400 project-required, nothing signed',
	[...outcome(await call(upload.POST, '/u', { files })), signed.length],
	[400, 'project-required', 0],
);
const ok = await call(upload.POST, '/u', { files, projectKey: 'p1' });
check(
	'rig upload for the session’s project signs its keys under that project',
	[ok.status, signed],
	[200, ['c/p1/spines/hero/hero.json']],
);

// ── art-bounds ───────────────────────────────────────────────────────────────
const bounds = { 'a::b': { x: 1, y: 1, w: 2, h: 2 } };
check(
	'art-bounds save from a tab on another project: 409 scope-mismatch, nothing saved',
	[
		...outcome(await call(artBounds.POST, '/a', { bounds, baseEtag: '"e"', projectKey: 'p2' })),
		saved.length,
	],
	[409, 'scope-mismatch', 0],
);
check(
	'art-bounds save naming no project: 400 project-required, nothing saved',
	[...outcome(await call(artBounds.POST, '/a', { bounds, baseEtag: '"e"' })), saved.length],
	[400, 'project-required', 0],
);
check(
	'art-bounds save for the session’s project lands',
	[
		(await call(artBounds.POST, '/a', { bounds, baseEtag: '"e"', projectKey: 'p1' })).status,
		saved.length,
	],
	[200, 1],
);
check(
	'art-bounds read for another project: 409',
	outcome(await call(artBounds.GET, '/a?projectKey=p2')),
	[409, 'scope-mismatch'],
);
check('art-bounds read naming no project: 400', outcome(await call(artBounds.GET, '/a'))[0], 400);
check(
	'art-bounds read for the session’s project',
	(await call(artBounds.GET, '/a?projectKey=p1')).status,
	200,
);

// ── art-slices ───────────────────────────────────────────────────────────────
const slices = { 'a::b': { left: 4, top: 4, right: 4, bottom: 4 } };
check(
	'art-slices save from a tab on another project: 409 scope-mismatch, nothing saved',
	[
		...outcome(await call(artSlices.POST, '/a', { slices, baseEtag: '"e"', projectKey: 'p2' })),
		saved.length,
	],
	[409, 'scope-mismatch', 1],
);
check(
	'art-slices save naming no project: 400 project-required, nothing saved',
	[...outcome(await call(artSlices.POST, '/a', { slices, baseEtag: '"e"' })), saved.length],
	[400, 'project-required', 1],
);
check(
	'art-slices save for the session’s project lands',
	[
		(await call(artSlices.POST, '/a', { slices, baseEtag: '"e"', projectKey: 'p1' })).status,
		saved.length,
	],
	[200, 2],
);
check(
	'art-slices read for another project: 409',
	outcome(await call(artSlices.GET, '/a?projectKey=p2')),
	[409, 'scope-mismatch'],
);
check('art-slices read naming no project: 400', outcome(await call(artSlices.GET, '/a'))[0], 400);
check(
	'art-slices read for the session’s project',
	(await call(artSlices.GET, '/a?projectKey=p1')).status,
	200,
);

// ── reads that copy content into the tab's project ───────────────────────────
check(
	'reference import for another project: 409 (its sprites would be rewritten onto that project)',
	outcome(await call(importRoute.GET, '/i?gameType=lines&projectKey=p2')),
	[409, 'scope-mismatch'],
);
check(
	'reference import naming no project: 400',
	outcome(await call(importRoute.GET, '/i?gameType=lines'))[0],
	400,
);
check(
	'reference import for the session’s project goes ahead',
	[200, 404].includes((await call(importRoute.GET, '/i?gameType=lines&projectKey=p1')).status),
	true,
);
check(
	'flipbook clips for another project: 409, nothing read',
	[...outcome(await call(flipbooks.GET, '/f?projectKey=p2')), flipbookReads.length],
	[409, 'scope-mismatch', 0],
);
check(
	'flipbook clips for the session’s project (and for a caller naming none) are read',
	[
		(await call(flipbooks.GET, '/f?projectKey=p1')).status,
		(await call(flipbooks.GET, '/f')).status,
		flipbookReads,
	],
	[200, 200, ['p1', 'p1']],
);

console.log(
	`\n${failures === 0 ? '✅' : '❌'} editor write scope: ${passes} passed, ${failures} failed`,
);
if (failures) process.exit(1);
