/**
 * CLAUDE.md rule 8 by construction: ONE exporter registry (`src/lib/server/exporters.ts`) lists every
 * asset class a game ships, and every path that ships one walks it. Pinned over the real modules and
 * an in-memory R2 (only R2, the project rows and the deploy-token setting are replaced):
 *
 *   1. the bake's list (`scripts/lib/bakeExports.mjs`) names exactly the registry's ids, in order,
 *      and the ids and timing labels are unique;
 *   2. `buildRuntimeBundle` runs every registry exporter, once each;
 *   3. on a project that authored nothing, each exporter returns its `emptyResult`;
 *   4. `POST /api/editor/export/<id>` answers that result as its body, every legacy
 *      `/api/editor/export-<id>` stub answers the same body and names a registry id, and an unknown
 *      id is a 404;
 *   5. the bake POSTs `/api/editor/export/<id>` for every id, and an empty answer embeds NOTHING:
 *      the bundle it bakes from the routes' empty bodies is byte-identical to one baked from `{}`;
 *   6. a rig no scene places but a cinematic casts ships on every path: the art route (and its
 *      legacy stub) lists it and writes its bundle into `deploy/editor-art/`, the runtime pass
 *      lists it, and the bake registers it in the bundle's `editorArt`.
 *
 *   pnpm --filter launcher-api check:exporter-registry
 */
import { spawn } from 'node:child_process';
import { deepStrictEqual } from 'node:assert';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';

let failures = 0;
let checks = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	checks += 1;
	if (ok) return;
	failures += 1;
	console.log(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
/** Equal as JSON: key order and `undefined` members do not count, as they do not on the wire. */
const sameJson = (a: unknown, b: unknown): boolean => {
	try {
		deepStrictEqual(
			JSON.parse(JSON.stringify(a) ?? 'null'),
			JSON.parse(JSON.stringify(b) ?? 'null'),
		);
		return true;
	} catch {
		return false;
	}
};

const src = (rel: string): string => new URL(`../src/${rel}`, import.meta.url).href;
const real = async (rel: string): Promise<Record<string, unknown>> => import(src(rel));

// ── In-memory R2, the project row and the deploy token ──────────────────────────────────────────
const R2 = new Map<string, string>();
const under = (prefix: string): string[] =>
	[...R2.keys()].filter((k) => k.startsWith(prefix)).sort();
const r2 = await real('lib/server/r2.ts');
mock.module(src('lib/server/r2.ts'), {
	namedExports: {
		...r2,
		getObjectText: async (key: string) => R2.get(key) ?? null,
		getObjectTextWithEtag: async (key: string) =>
			R2.has(key) ? { text: R2.get(key), etag: '"e"' } : null,
		getObjectBytes: async (key: string) =>
			R2.has(key) ? { body: new TextEncoder().encode(R2.get(key)), contentType: 'x' } : null,
		putObjectText: async (key: string, text: string) => (R2.set(key, text), '"e"'),
		putObjectBytes: async (key: string) => (R2.set(key, '<bytes>'), '"e"'),
		deleteObject: async (key: string) => void R2.delete(key),
		deleteObjects: async (keys: string[]) => keys.forEach((k) => R2.delete(k)),
		copyObject: async (from: string, to: string) =>
			R2.has(from) ? (R2.set(to, R2.get(from)!), true) : false,
		objectExists: async (key: string) => R2.has(key),
		headObject: async (key: string) =>
			R2.has(key) ? { etag: '"e"', size: R2.get(key)!.length, lastModified: 1 } : null,
		listAllKeys: async (prefix: string) => under(prefix),
		listAllObjects: async (prefix: string) =>
			under(prefix).map((key) => ({ key, size: R2.get(key)!.length, lastModified: 1 })),
		listObjects: async (prefix: string) => {
			const keys: string[] = [];
			const prefixes = new Set<string>();
			for (const key of under(prefix)) {
				const slash = key.indexOf('/', prefix.length);
				if (slash < 0) keys.push(key);
				else prefixes.add(key.slice(0, slash + 1));
			}
			return { keys, prefixes: [...prefixes] };
		},
		listFolder: async () => ({ folders: [], files: [] }),
	},
});
const CLIENT = 'acme';
const PROJECT = 'blank';
const TOKEN = 'deploy-token';
const projects = await real('lib/server/projects.ts');
mock.module(src('lib/server/projects.ts'), {
	namedExports: {
		...projects,
		projectClientKey: async () => CLIENT,
		projectName: async () => 'Blank',
		projectGameType: async () => 'lines',
		storedProjectGameType: async () => 'lines',
	},
});
const appSettings = await real('lib/server/appSettings.ts');
mock.module(src('lib/server/appSettings.ts'), {
	namedExports: {
		...appSettings,
		getDeployToken: async () => TOKEN,
		getAppSetting: async () => undefined,
	},
});

const { EXPORTERS, exportBody } = await import('../src/lib/server/exporters.ts');
const { BAKE_EXPORTS } = (await import('./lib/bakeExports.mjs')) as {
	BAKE_EXPORTS: { asset: string; label: string; policy: string }[];
};
const { buildRuntimeBundle } = await import('../src/lib/server/runtimeBundle.ts');
const dynamicRoute = await import('../src/routes/api/editor/export/[asset]/+server.ts');

const ids = EXPORTERS.map((e) => e.id);

// ── 1. one list ─────────────────────────────────────────────────────────────────────────────────
console.log('1. the bake asks for exactly the registry');
check('ids are unique', new Set(ids).size === ids.length, ids.join(','));
check('timing labels are unique', new Set(EXPORTERS.map((e) => e.label)).size === EXPORTERS.length);
check(
	'bake list = registry, in order',
	BAKE_EXPORTS.map((e) => e.asset).join(',') === ids.join(','),
	`bake ${BAKE_EXPORTS.map((e) => e.asset).join(',')} vs registry ${ids.join(',')}`,
);
check(
	'every bake entry has a known failure policy',
	BAKE_EXPORTS.every((e) => ['required', 'optional', 'additive'].includes(e.policy) && e.label),
);

// ── 2 + 3. the runtime assemble runs every exporter, and an empty project yields emptyResult ────
console.log('2. buildRuntimeBundle runs every exporter; 3. each yields its emptyResult');
type Run = (ctx: unknown) => Promise<unknown>;
const ran: { id: string; result: unknown }[] = [];
const originals = new Map<string, Run>();
for (const exporter of EXPORTERS) {
	const mutable = exporter as unknown as { run: Run };
	const original = mutable.run;
	originals.set(exporter.id, original);
	mutable.run = async (ctx) => {
		const result = await original(ctx);
		ran.push({ id: exporter.id, result });
		return result;
	};
}
const quiet = { info: console.info, warn: console.warn, log: console.log };
console.info = console.warn = console.log = () => {};
try {
	await buildRuntimeBundle(PROJECT);
} finally {
	Object.assign(console, quiet);
}
check(
	'every exporter ran once',
	ran
		.map((r) => r.id)
		.sort()
		.join(',') === [...ids].sort().join(','),
	`ran ${ran.map((r) => r.id).join(',')}`,
);
for (const { id, result } of ran) {
	const exporter = EXPORTERS.find((e) => e.id === id)!;
	check(
		`${id}: an un-authored project returns emptyResult`,
		sameJson(result, exporter.emptyResult),
		`got ${JSON.stringify(result)}`,
	);
}

// ── 4. the routes ───────────────────────────────────────────────────────────────────────────────
console.log('4. /api/editor/export/<id> and the legacy stubs answer the same');
type Post = (event: unknown) => Promise<Response>;
const post = async (
	handler: Post,
	path: string,
	params: Record<string, string> = {},
	project = PROJECT,
) => {
	const url = new URL(`https://launcher.test${path}?project=${project}&k=${TOKEN}`);
	try {
		const res = await handler({ url, params, request: new Request(url, { method: 'POST' }) });
		return { status: res.status, body: (await res.json()) as Record<string, unknown> };
	} catch (e) {
		const status = (e as { status?: number }).status;
		if (typeof status === 'number') return { status, body: {} };
		throw e;
	}
};
const routeBodies: Record<string, Record<string, unknown>> = {};
for (const exporter of EXPORTERS) {
	const id = exporter.id;
	const answer = await post(dynamicRoute.POST as Post, `/api/editor/export/${id}`, { asset: id });
	routeBodies[id] = answer.body;
	check(`export/${id} answers 200`, answer.status === 200, `HTTP ${answer.status}`);
	check(
		`export/${id} answers its emptyResult as the body`,
		sameJson(answer.body, {
			clientKey: CLIENT,
			projectKey: PROJECT,
			...exportBody(exporter, exporter.emptyResult),
		}),
		JSON.stringify(answer.body),
	);
}
const unknown = await post(dynamicRoute.POST as Post, '/api/editor/export/nope', { asset: 'nope' });
check('an unknown id is a 404', unknown.status === 404, `HTTP ${unknown.status}`);

const routesDir = fileURLToPath(new URL('../src/routes/api/editor/', import.meta.url));
const legacy = readdirSync(routesDir).filter((d) => d.startsWith('export-'));
check('the legacy stubs are still there', legacy.length === 10, legacy.join(','));
for (const dir of legacy) {
	const id = dir.slice('export-'.length);
	check(`${dir} names a registry id`, ids.includes(id as (typeof ids)[number]));
	const stub = await import(src(`routes/api/editor/${dir}/+server.ts`));
	const answer = await post(stub.POST as Post, `/api/editor/${dir}`);
	check(
		`${dir} answers what export/${id} does`,
		sameJson(answer, { status: 200, body: routeBodies[id] }),
	);
}

// ── 5. the bake ─────────────────────────────────────────────────────────────────────────────────
console.log('5. the bake POSTs every id, and embeds nothing for an empty answer');
const BAKE = fileURLToPath(new URL('./bake-editor-doc.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const portal = (exportBodies: (id: string) => unknown) =>
	new Promise<{ server: Server; posted: string[] }>((ready) => {
		const posted: string[] = [];
		const server = createServer((req, res) => {
			const path = (req.url ?? '').split('?')[0];
			const asset = /^\/api\/editor\/export\/([a-z]+)$/.exec(path)?.[1];
			if (asset) posted.push(`${req.method} ${asset}`);
			res.writeHead(200, { 'content-type': 'application/json' });
			if (path === '/api/editor/doc') {
				return res.end(JSON.stringify({ doc: { scenes: [{ id: 's', nodes: [] }] } }));
			}
			if (path === '/api/launcher/publish-check') {
				return res.end(JSON.stringify({ ok: true, checked: ['sounds'], failed: [] }));
			}
			res.end(JSON.stringify(asset ? exportBodies(asset) : {}));
		});
		server.listen(0, '127.0.0.1', () => ready({ server, posted }));
	});
const bake = async (exportBodies: (id: string) => unknown) => {
	const { server, posted } = await portal(exportBodies);
	const dir = mkdtempSync(join(tmpdir(), 'ie-exporter-registry-'));
	const dest = join(dir, 'out.json');
	const port = (server.address() as { port: number }).port;
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([k]) => !/^(IE_|ALLOW_|EDITOR_DOC|LIVE_ASSETS)/.test(k)),
	);
	const code = await new Promise<number | null>((done) => {
		const child = spawn(
			process.execPath,
			[
				BAKE,
				'--project',
				PROJECT,
				'--base',
				`http://127.0.0.1:${port}`,
				'--token',
				't',
				'--dest',
				dest,
			],
			{ cwd: ROOT, env, stdio: 'ignore' },
		);
		child.on('close', done);
	});
	server.close();
	const out = existsSync(dest) ? readFileSync(dest, 'utf8') : null;
	rmSync(dir, { recursive: true, force: true });
	return { code, posted, out };
};
const fromRoutes = await bake((id) => routeBodies[id] ?? {});
const fromNothing = await bake(() => ({}));
check('the bake succeeds', fromRoutes.code === 0 && fromNothing.code === 0);
check(
	'it POSTs /api/editor/export/<id> for every registry id, in order',
	fromRoutes.posted.join(',') === ids.map((id) => `POST ${id}`).join(','),
	fromRoutes.posted.join(','),
);
check(
	'an empty export bakes the same bundle as no answer at all',
	fromRoutes.out !== null && fromRoutes.out === fromNothing.out,
);
/** What every baked bundle carries; each asset section beyond these is omitted until authored. */
const ALWAYS = [
	'componentDefaults',
	'componentDefs',
	'doc',
	'editorArt',
	'fonts',
	'localization',
	'sounds',
	'symbols',
];
const sections = fromRoutes.out ? Object.keys(JSON.parse(fromRoutes.out) as object).sort() : [];
check(
	'…and it embeds no optional section (an un-authored game stays byte-identical)',
	sections.join(',') === ALWAYS.join(','),
	sections.join(','),
);

// ── 6. a rig only a cinematic casts ships on every path ─────────────────────────────────────────
console.log(
	'6. a rig no scene places but a cinematic casts ships on the route, the pass and the bake',
);
const CINE = 'cine';
const RIG = 'introRig';
const { SUB, editorDocKey } = await import('../src/lib/server/projectPaths.ts');
const { cinematicKey } = await import('../src/lib/server/cinematicStorage.ts');
const rigFolder = `${SUB.spines(CLIENT, CINE)}/${RIG}`;
R2.set(
	`${SUB.spines(CLIENT, CINE)}/skeletons.json`,
	JSON.stringify({
		skeletons: [
			{ folder: RIG, name: RIG, atlas_file: `${RIG}.atlas`, skeleton_file: `${RIG}.json` },
		],
	}),
);
R2.set(`${rigFolder}/${RIG}.atlas`, `${RIG}.webp\nsize: 8,8\nbone\n  bounds: 0,0,8,8\n`);
R2.set(`${rigFolder}/${RIG}.json`, JSON.stringify({ skeleton: { spine: '4.2' } }));
R2.set(`${rigFolder}/${RIG}.webp`, 'x');
R2.set(editorDocKey(CLIENT, CINE), JSON.stringify({ scenes: [{ id: 's', name: 'S', nodes: [] }] }));
R2.set(
	cinematicKey(CLIENT, CINE, 'intro'),
	JSON.stringify({
		id: 'intro',
		name: 'Intro',
		duration: 1,
		stage: { sceneId: null, cast: [{ actorId: 'a', kind: 'rig', rigFolder: RIG, place: {} }] },
		tracks: [],
	}),
);
const hasRig = (spines: unknown): boolean =>
	Array.isArray(spines) && spines.some((s: { key?: unknown }) => s.key === RIG);
const artDeploy = `${SUB.deploy(CLIENT, CINE)}/editor-art/`;
const shippedRigFiles = (): string[] => under(artDeploy).filter((k) => k.includes(RIG));

const cineRoute = await post(
	dynamicRoute.POST as Post,
	'/api/editor/export/art',
	{ asset: 'art' },
	CINE,
);
check('export/art answers 200', cineRoute.status === 200, `HTTP ${cineRoute.status}`);
check(
	'export/art lists the cast rig',
	hasRig(cineRoute.body.spines),
	JSON.stringify(cineRoute.body),
);
check(
	'…and writes its bundle into deploy/editor-art/',
	shippedRigFiles().some((k) => k.endsWith('.atlas')) &&
		shippedRigFiles().some((k) => k.endsWith('.json')),
	under(artDeploy).join(','),
);
const legacyArt = await import(src('routes/api/editor/export-art/+server.ts'));
const legacyCine = await post(legacyArt.POST as Post, '/api/editor/export-art', {}, CINE);
check('the legacy export-art stub lists the cast rig too', hasRig(legacyCine.body.spines));

console.info = console.warn = console.log = () => {};
let cineBundle: Awaited<ReturnType<typeof buildRuntimeBundle>>;
try {
	cineBundle = await buildRuntimeBundle(CINE);
} finally {
	Object.assign(console, quiet);
}
check('the runtime pass lists the cast rig', hasRig(cineBundle.editorArt.spines));

const cineBake = await bake((id) => (id === 'art' ? cineRoute.body : (routeBodies[id] ?? {})));
const baked = cineBake.out
	? (JSON.parse(cineBake.out) as { editorArt?: { spines?: unknown } })
	: null;
check('the bake succeeds', cineBake.code === 0);
check('the baked bundle registers the cast rig', hasRig(baked?.editorArt?.spines));

console.log();
if (failures) {
	console.error(`${failures} of ${checks} exporter-registry checks FAILED`);
	process.exit(1);
}
console.log(`all ${checks} exporter-registry checks pass`);
