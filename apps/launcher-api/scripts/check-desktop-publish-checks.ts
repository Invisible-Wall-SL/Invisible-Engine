/**
 * A desktop ☁ Publish / 📦 Deliver runs the checks the online Publish runs:
 *   pnpm --filter launcher-api check:desktop-publish-checks
 *
 *  1. The portal: the REAL `runPublishChecks` behind the REAL `GET /api/launcher/publish-check`,
 *     over stubbed gate INPUTS (the sound gate's answer, the stored flow's verdict, the config in an
 *     in-memory R2, the project rows) and the REAL gate decisions (`flowGateRefusal`,
 *     `unplayableFamilyMessage`): each refusal, which ones a person may override, both callers'
 *     auth (a publisher's session held to its projects, the build's deploy token), and a key resolved
 *     as the bake's doc fetch resolves it.
 *  2. The build: the REAL `bake-editor-doc.mjs` against a portal that answers the check through that
 *     route. It stops on each refusal before any export or compile, with the reason and where to fix
 *     it in the log, the refusal in `IE_BUILD_REFUSAL_JSON` and the verdict in the report folder; the
 *     override lets the overridable ones through and never the others; a portal that cannot answer
 *     stops it; a bake with no token (a dev build, CI) and a dry run never ask.
 *  3. Local builds stay off the portal: `apps/lines` builds with no bake, no workflow bakes, and a
 *     scaffolded game bakes before it pulls or compiles.
 *  4. The build breakdown (the REAL `scripts/build-breakdown.mjs`) shows a build shipped past them.
 *  5. Planted mutants of the portal module, the build's module and the bake: each is caught.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
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

const src = (rel: string): string => new URL(`../src/${rel}`, import.meta.url).href;
const real = async (rel: string): Promise<Record<string, unknown>> => import(src(rel));
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

// ── The portal's inputs ─────────────────────────────────────────────────────────────────────────
const CLIENT = 'acme';
const TOKEN = 'deploy-token-0123456789';
const PUBLISHER = 'u-publisher';
const FLOW_ERRORS = [
	{ severity: 'error', message: 'The hold "fs-intro" is never released.' },
	{ severity: 'error', message: 'Node "win" has a second exec wire.' },
];
const ARCADE = JSON.parse(read('apps/launcher-api/src/lib/data/gameConfig/arcade.rules.json'));
delete ARCADE.outcome;

type Project = { kind?: string; drafts?: string[]; flow?: unknown; config?: unknown };
const PROJECTS: Record<string, Project> = {
	clean: {},
	drafts: { drafts: ['sfx_coin', 'sfx_win'] },
	badflow: { flow: { status: 'invalid', templateId: 'lines', errors: FLOW_ERRORS } },
	wrongkind: { kind: 'arcade', flow: { status: 'valid', templateId: 'bookOf' } },
	arcade: { kind: 'arcade', config: ARCADE },
	everything: {
		drafts: ['sfx_coin'],
		flow: { status: 'invalid', templateId: 'lines', errors: FLOW_ERRORS },
	},
	elsewhere: {},
};
/** What the publisher's session may reach: every project but `elsewhere`. */
const REACHABLE = new Set(Object.keys(PROJECTS).filter((p) => p !== 'elsewhere'));
const soundGateCalls: string[] = [];

const R2 = new Map<string, string>();
const r2 = await real('lib/server/r2.ts');
const refuseWrite = async (): Promise<never> => {
	throw new Error('fixture: the publish checks must not write');
};
mock.module(src('lib/server/r2.ts'), {
	namedExports: {
		...r2,
		getObjectText: async (key: string) => R2.get(key) ?? null,
		getObjectTextWithEtag: async (key: string) =>
			R2.has(key) ? { text: R2.get(key), etag: '"e"' } : null,
		objectExists: async (key: string) => R2.has(key),
		listAllKeys: async () => [],
		listAllObjects: async () => [],
		putObjectText: refuseWrite,
		putObjectBytes: refuseWrite,
		deleteObject: refuseWrite,
		deleteObjects: refuseWrite,
		copyObject: refuseWrite,
	},
});
const projects = await real('lib/server/projects.ts');
mock.module(src('lib/server/projects.ts'), {
	namedExports: {
		...projects,
		projectClientKey: async (key: string) => (key in PROJECTS ? CLIENT : null),
		projectGameType: async (key: string) => PROJECTS[key]?.kind ?? 'lines',
		storedProjectGameType: async (key: string) => PROJECTS[key]?.kind ?? null,
		canAccessProject: async (userId: string, _role: string, key: string) =>
			userId === PUBLISHER && REACHABLE.has(key),
	},
});
const appSettings = await real('lib/server/appSettings.ts');
mock.module(src('lib/server/appSettings.ts'), {
	namedExports: { ...appSettings, getDeployToken: async () => TOKEN },
});
const launcherAuth = await real('lib/server/launcherAuth.ts');
const refusal = (status: number, error: string) =>
	({ ok: false, response: Response.json({ error }, { status }) }) as const;
mock.module(src('lib/server/launcherAuth.ts'), {
	namedExports: {
		...launcherAuth,
		requireLauncherPublisher: async (request: Request) => {
			const header = request.headers.get('authorization');
			if (header === 'Bearer publisher') {
				return { ok: true, user: { id: PUBLISHER, role: 'artist' } };
			}
			if (header === 'Bearer viewer') return refusal(403, 'Missing the gamePublish capability');
			return refusal(401, 'Not signed in');
		},
	},
});
const soundGate = await real('lib/server/soundPublishCheck.ts');
mock.module(src('lib/server/soundPublishCheck.ts'), {
	namedExports: {
		...soundGate,
		checkSoundsForPublish: async (clientKey: string, projectKey: string) => {
			soundGateCalls.push(`${clientKey}/${projectKey}`);
			return {
				unapproved: PROJECTS[projectKey]?.drafts ?? [],
				licences: { bound: 0, missingLicence: [], nonCommercial: [], byLicence: [] },
			};
		},
	},
});
const flowGate = await real('lib/server/flowV2Validation.ts');
mock.module(src('lib/server/flowV2Validation.ts'), {
	namedExports: {
		...flowGate,
		checkFlowV2ForPublish: async (_clientKey: string, projectKey: string) =>
			PROJECTS[projectKey]?.flow ?? { status: 'absent' },
	},
});

const { gameConfigDocKey } = await import('../src/lib/server/projectPaths.ts');
for (const [key, p] of Object.entries(PROJECTS)) {
	if (p.config) R2.set(gameConfigDocKey(CLIENT, key), JSON.stringify(p.config));
}

const { unplayableFamilyMessage } = await import('../src/lib/server/familyGate.ts');
const { wrongKindFlowMessage } = await import('../src/lib/server/flowV2Validation.ts');
const { PUBLISH_ANYWAY: SERVER_PUBLISH_ANYWAY } =
	await import('../src/lib/server/publishChecks.ts');
const route = await import('../src/routes/api/launcher/publish-check/+server.ts');
const client = await import('./lib/publishCheck.mjs');

// ── 1. The portal ───────────────────────────────────────────────────────────────────────────────
console.log('1. the portal runs the checks and answers both callers');
check(
	'fixture: the arcade config is one the family gate refuses',
	unplayableFamilyMessage(ARCADE) !== null,
);
check(
	'fixture: a bookOf flow is another kind than an arcade project',
	wrongKindFlowMessage('bookOf', 'arcade') !== null,
);

type Answer = { status: number; body: unknown };
type Handler = (url: URL, headers?: Record<string, string>) => Promise<Answer>;
type Failure = { id: string; reason: string; items: string[]; fixIn: string; overridable: boolean };
type Verdict = { ok: boolean; checked: string[]; failed: Failure[]; publishAnyway?: unknown };

/** The real route, called the way SvelteKit calls it: a thrown `error()` becomes its status. */
const viaRoute: Handler = async (url, headers = {}) => {
	try {
		const res: Response = await route.GET({ url, request: new Request(url, { headers }) } as never);
		return { status: res.status, body: await res.json() };
	} catch (e) {
		const status = (e as { status?: unknown }).status;
		if (typeof status !== 'number') throw e;
		return { status, body: (e as { body?: unknown }).body ?? null };
	}
};
const ask = (query: string, headers?: Record<string, string>): Promise<Answer> =>
	viaRoute(new URL(`https://portal.test/api/launcher/publish-check?${query}`), headers);
const verdictOf = async (project: string): Promise<Verdict> =>
	(await ask(`project=${project}&k=${TOKEN}`)).body as Verdict;

const clean = await ask(`project=clean&k=${TOKEN}`);
check('a clean project passes', clean.status === 200 && (clean.body as Verdict).ok === true);
check(
	'it says which checks ran',
	JSON.stringify((clean.body as Verdict).checked) === '["sounds","flow","family"]',
	JSON.stringify(clean.body),
);
check(
	"it names the build's override, as the build reads it",
	JSON.stringify((clean.body as Verdict).publishAnyway) === JSON.stringify(client.PUBLISH_ANYWAY) &&
		JSON.stringify(SERVER_PUBLISH_ANYWAY) === JSON.stringify(client.PUBLISH_ANYWAY),
);

const only = async (project: string): Promise<Failure | undefined> => {
	const v = await verdictOf(project);
	return v.ok === false && v.failed.length === 1 ? v.failed[0] : undefined;
};
const drafts = await only('drafts');
check(
	'draft sounds: refused, every draft named, overridable',
	drafts?.id === 'unapproved-sounds' &&
		drafts.items.join() === 'sfx_coin,sfx_win' &&
		drafts.reason === '2 sounds the game ships are still marked draft.' &&
		drafts.fixIn.startsWith('Invisible Sound') &&
		drafts.overridable === true,
	JSON.stringify(drafts),
);
check(
	'the sound gate is asked for the project under its own client',
	soundGateCalls.includes(`${CLIENT}/drafts`),
	soundGateCalls.join(),
);
const badflow = await only('badflow');
check(
	"flow errors: refused with the flow gate's own message and errors, overridable",
	badflow?.id === 'invalid-flow' &&
		badflow.reason.includes('Invisible Flow') &&
		badflow.items.join('|') === FLOW_ERRORS.map((e) => e.message).join('|') &&
		badflow.overridable === true,
	JSON.stringify(badflow),
);
const wrongkind = await only('wrongkind');
check(
	"a flow of another kind: refused with the gate's message, never overridable",
	wrongkind?.id === 'flow-wrong-kind' &&
		wrongkind.reason === wrongKindFlowMessage('bookOf', 'arcade') &&
		wrongkind.overridable === false,
	JSON.stringify(wrongkind),
);
const arcade = await only('arcade');
check(
	"a family the runtime cannot play: refused with the gate's message, never overridable",
	arcade?.id === 'unplayable-family' &&
		arcade.reason === unplayableFamilyMessage(ARCADE) &&
		arcade.overridable === false,
	JSON.stringify(arcade),
);
const everything = await verdictOf('everything');
check(
	'every check runs: one answer lists every problem, in the online order',
	everything.failed.map((f) => f.id).join() === 'unapproved-sounds,invalid-flow',
	JSON.stringify(everything.failed.map((f) => f.id)),
);

const status = async (query: string, headers?: Record<string, string>) =>
	(await ask(query, headers)).status;
check('the deploy token is required', (await status('project=clean')) === 401);
check('a wrong deploy token is refused', (await status('project=clean&k=nope')) === 401);
check(
	'a key with no project row is checked where the bake reads it, as /api/editor/doc resolves it',
	(await status(`project=ghost&k=${TOKEN}`)) === 200 && soundGateCalls.includes('unassigned/ghost'),
	soundGateCalls.join(),
);
check('a missing project is a 400', (await status(`k=${TOKEN}`)) === 400);
const asPublisher = await ask('project=drafts', { authorization: 'Bearer publisher' });
check(
	"a publisher's session gets the same verdict",
	asPublisher.status === 200 &&
		JSON.stringify(asPublisher.body) === JSON.stringify(await verdictOf('drafts')),
);
const callsBefore = soundGateCalls.length;
check(
	"…but only for a project it can reach, and the checks don't run for one it can't",
	(await status('project=elsewhere', { authorization: 'Bearer publisher' })) === 403 &&
		soundGateCalls.length === callsBefore,
);
check(
	'a session without the publish capability is refused',
	(await status('project=clean', { authorization: 'Bearer viewer' })) === 403,
);
check(
	'a session that fails never falls back to the deploy token',
	(await status(`project=clean&k=${TOKEN}`, { authorization: 'Bearer stale' })) === 401,
);

// ── 2. The build ────────────────────────────────────────────────────────────────────────────────
console.log('2. the bake stops on each, ships past the overridable ones when told, fails closed');

/** How the portal answers the check: the route, an older portal (404), or a body with no verdict. */
type CheckMode = 'route' | '404' | 'garbage';
type Run = {
	code: number | null;
	log: string;
	refusal: { gate?: string; error?: string; details?: string[]; override?: unknown } | null;
	report: { status?: string; overridden?: string[]; blocking?: string[] } | null;
	asked: string[];
	exported: string[];
	baked: boolean;
};
type Setup = { bake: string; cwd: string; answer: Handler };
type Scenario = {
	id: string;
	project: string;
	args?: string[];
	env?: Record<string, string>;
	mode?: CheckMode;
	token?: false;
	claims: (r: Run) => [string, boolean][];
};

const CLEAN_ENV = Object.fromEntries(
	Object.entries(process.env).filter(([k]) => !/^(IE_|ALLOW_|EDITOR_DOC|LIVE_ASSETS)/.test(k)),
);
const UMBRELLA = JSON.stringify({ flag: '--publish-anyway', env: 'IE_PUBLISH_ANYWAY' });
const portalRuns = new Map<string, { mode: CheckMode; answer: Handler; seen: string[] }>();
const portal = createServer((req, res) => {
	const url = new URL(req.url ?? '/', 'http://portal.test');
	const [, runId, ...rest] = url.pathname.split('/');
	const run = portalRuns.get(runId);
	const path = `/${rest.join('/')}`;
	const send = (status: number, body: unknown) => {
		res.writeHead(status, { 'content-type': 'application/json' });
		res.end(typeof body === 'string' ? body : JSON.stringify(body));
	};
	if (!run) return send(500, { error: `fixture: no run ${runId}` });
	run.seen.push(`${req.method} ${path}${url.search}`);
	if (path === '/api/launcher/publish-check') {
		if (run.mode === '404') return send(404, 'Not Found');
		if (run.mode === 'garbage') return send(200, {});
		const at = new URL(`https://portal.test${path}${url.search}`);
		run.answer(at).then(
			({ status: code, body }) => send(code, body),
			(e: unknown) => send(500, { error: String(e) }),
		);
		return;
	}
	if (path === '/api/editor/doc') return send(200, { doc: { scenes: [{ id: 's', nodes: [] }] } });
	send(200, {});
});
await new Promise<void>((ready) => portal.listen(0, '127.0.0.1', ready));
const { port } = portal.address() as AddressInfo;

let runCount = 0;
async function bakeRun(setup: Setup, s: Scenario): Promise<Run> {
	const runId = `r${(runCount += 1)}`;
	const seen: string[] = [];
	portalRuns.set(runId, { mode: s.mode ?? 'route', answer: setup.answer, seen });
	const dir = mkdtempSync(join(tmpdir(), 'ie-publish-check-'));
	const dest = join(dir, 'out.json');
	const refusalPath = join(dir, 'refusal.json');
	const reportDir = join(dir, 'report');
	const args = [
		setup.bake,
		'--project',
		s.project,
		'--base',
		`http://127.0.0.1:${port}/${runId}`,
		'--dest',
		dest,
		...(s.token === false ? [] : ['--token', TOKEN]),
		...(s.args ?? []),
	];
	const env = {
		...CLEAN_ENV,
		IE_BUILD_REFUSAL_JSON: refusalPath,
		IE_BUILD_REPORT_DIR: reportDir,
		...s.env,
	};
	const { code, log } = await new Promise<{ code: number | null; log: string }>((done) => {
		const child = spawn(process.execPath, args, { cwd: setup.cwd, env, stdio: 'pipe' });
		let out = '';
		child.stdout.on('data', (d) => (out += d));
		child.stderr.on('data', (d) => (out += d));
		child.on('close', (c) => done({ code: c, log: out }));
	});
	const json = (path: string) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);
	const run: Run = {
		code,
		log,
		refusal: json(refusalPath),
		report: json(join(reportDir, 'publish-check.json')),
		asked: seen.filter((r) => r.includes('/api/launcher/publish-check')),
		exported: seen
			.filter((r) => r.startsWith('POST /api/editor/export/'))
			.map((r) => r.slice('POST /api/editor/export/'.length)),
		baked: existsSync(dest),
	};
	portalRuns.delete(runId);
	rmSync(dir, { recursive: true, force: true });
	return run;
}

/** A build the checks stopped: exit 1, the refusal as data, the verdict reported, nothing exported. */
const stopped = (r: Run, gate: string, override: string | null): [string, boolean][] => [
	['exits 1', r.code === 1],
	['writes the refusal with its gate', r.refusal?.gate === gate],
	[
		override ? 'names the override' : 'offers no override',
		JSON.stringify(r.refusal?.override ?? null) === (override ?? 'null'),
	],
	['reports the verdict as refused', r.report?.status === 'refused'],
	['stops before any export writes deploy/', r.exported.length === 0],
	['compiles nothing', !r.baked],
];
const through = (r: Run): [string, boolean][] => [
	['exits 0', r.code === 0],
	['exports', r.exported[0]?.startsWith('art') === true],
	['bakes the bundle', r.baked],
];

const SCENARIOS: Scenario[] = [
	{
		id: 'a clean project',
		project: 'clean',
		claims: (r) => [
			...through(r),
			['asks the portal once', r.asked.length === 1],
			['reports passed', r.report?.status === 'passed'],
			['says so in the log', r.log.includes('✓ publish checks: sounds, flow, family pass')],
		],
	},
	{
		id: 'draft sounds',
		project: 'drafts',
		claims: (r) => [
			...stopped(r, 'unapproved-sounds', UMBRELLA),
			['every draft in the refusal', r.refusal?.details?.join() === 'sfx_coin,sfx_win'],
			[
				'the log says what and where to fix it',
				['still marked draft', 'sfx_coin', 'sfx_win', 'Invisible Sound'].every((t) =>
					r.log.includes(t),
				),
			],
			['the log names the override', r.log.includes('IE_PUBLISH_ANYWAY=1')],
		],
	},
	{
		id: 'flow errors',
		project: 'badflow',
		claims: (r) => [
			...stopped(r, 'invalid-flow', UMBRELLA),
			['the log says where to fix it', r.log.includes('Invisible Flow (Validation panel)')],
			['the log lists the errors', r.log.includes(FLOW_ERRORS[1].message)],
		],
	},
	{
		id: 'a flow of another kind',
		project: 'wrongkind',
		claims: (r) => [
			...stopped(r, 'flow-wrong-kind', null),
			['the log says where to fix it', r.log.includes('/admin')],
			['the log offers no override', !r.log.includes('re-run with')],
		],
	},
	{
		id: 'an unplayable family',
		project: 'arcade',
		claims: (r) => [
			...stopped(r, 'unplayable-family', null),
			['the log says where to fix it', r.log.includes('Invisible Game Config')],
		],
	},
	{
		id: 'two failures',
		project: 'everything',
		claims: (r) => [
			...stopped(r, 'publish-checks', UMBRELLA),
			[
				'the refusal lists both',
				r.refusal?.details?.some((d) => d.includes('sfx_coin')) === true &&
					r.refusal?.details?.some((d) => d.includes('Invisible Flow')) === true,
			],
		],
	},
	{
		id: 'draft sounds, IE_PUBLISH_ANYWAY=1',
		project: 'drafts',
		env: { IE_PUBLISH_ANYWAY: '1' },
		claims: (r) => [
			...through(r),
			['reports overridden', r.report?.status === 'overridden'],
			['records what shipped anyway', r.report?.overridden?.join() === 'unapproved-sounds'],
			['says so in the log', r.log.includes('shipping anyway') && r.log.includes('sfx_win')],
		],
	},
	{
		id: 'draft sounds, --publish-anyway',
		project: 'drafts',
		args: ['--publish-anyway'],
		claims: through,
	},
	{
		id: 'draft sounds, IE_PUBLISH_ANYWAY=0',
		project: 'drafts',
		env: { IE_PUBLISH_ANYWAY: '0' },
		claims: (r) => stopped(r, 'unapproved-sounds', UMBRELLA),
	},
	{
		id: 'two failures, only the sounds lifted',
		project: 'everything',
		env: { IE_PUBLISH_ANYWAY: 'unapproved-sounds' },
		claims: (r) => [
			...stopped(r, 'invalid-flow', UMBRELLA),
			['records the lifted one', r.report?.overridden?.join() === 'unapproved-sounds'],
		],
	},
	{
		id: 'two failures, IE_PUBLISH_ANYWAY=1',
		project: 'everything',
		env: { IE_PUBLISH_ANYWAY: '1' },
		claims: (r) => [
			...through(r),
			[
				'the flow export is told too, so it does not refuse the same flow again',
				r.exported.some((e) => e.startsWith('flow?') && e.includes('allowInvalidFlow=1')),
			],
		],
	},
	{
		id: "flow errors, the launcher's ALLOW_INVALID_FLOW=1",
		project: 'badflow',
		env: { ALLOW_INVALID_FLOW: '1' },
		claims: through,
	},
	{
		id: 'an unplayable family, IE_PUBLISH_ANYWAY=1',
		project: 'arcade',
		env: { IE_PUBLISH_ANYWAY: '1' },
		claims: (r) => stopped(r, 'unplayable-family', null),
	},
	{
		id: 'a flow of another kind, IE_PUBLISH_ANYWAY=1',
		project: 'wrongkind',
		env: { IE_PUBLISH_ANYWAY: '1' },
		claims: (r) => stopped(r, 'flow-wrong-kind', null),
	},
	{
		id: 'a portal without the route',
		project: 'drafts',
		mode: '404',
		claims: (r) => [
			['exits 1', r.code === 1],
			['refuses as unreachable', r.refusal?.gate === 'publish-check-unreachable'],
			['names the override', JSON.stringify(r.refusal?.override) === UMBRELLA],
			['reports unreachable', r.report?.status === 'unreachable'],
			['stops before any export', r.exported.length === 0 && !r.baked],
			['says why in the log', r.log.includes('Could not run the publish checks: HTTP 404')],
		],
	},
	{
		id: 'a portal without the route, IE_PUBLISH_ANYWAY=1',
		project: 'drafts',
		mode: '404',
		env: { IE_PUBLISH_ANYWAY: '1' },
		claims: (r) => [
			...through(r),
			['reports unchecked', r.report?.status === 'unchecked'],
			['says UNCHECKED in the log', r.log.includes('UNCHECKED')],
		],
	},
	{
		id: 'a portal without the route, only the sounds lifted',
		project: 'drafts',
		mode: '404',
		env: { IE_PUBLISH_ANYWAY: 'unapproved-sounds' },
		claims: (r) => [['exits 1', r.code === 1]],
	},
	{
		id: 'an answer with no verdict',
		project: 'clean',
		mode: 'garbage',
		claims: (r) => [
			['exits 1', r.code === 1],
			['refuses as unreachable', r.refusal?.gate === 'publish-check-unreachable'],
		],
	},
	{
		id: 'a dev build: no token, --optional',
		project: 'drafts',
		token: false,
		args: ['--optional'],
		claims: (r) => [
			['exits 0', r.code === 0],
			['never asks the portal anything', r.asked.length === 0],
			['writes no verdict', r.report === null],
		],
	},
	{
		id: 'a dry run',
		project: 'drafts',
		args: ['--dry-run'],
		claims: (r) => [
			['exits 0', r.code === 0],
			['never asks for the checks', r.asked.length === 0],
		],
	},
];

const realSetup: Setup = {
	bake: fileURLToPath(new URL('./bake-editor-doc.mjs', import.meta.url)),
	cwd: ROOT,
	answer: viaRoute,
};

/** Every scenario under `setup`, a few at a time; each claim as `<scenario>: <claim>` → held. */
async function runClaims(
	setup: Setup,
): Promise<{ claims: [string, boolean][]; runs: Map<string, Run> }> {
	const runs = new Map<string, Run>();
	const queue = [...SCENARIOS];
	await Promise.all(
		Array.from({ length: 6 }, async () => {
			for (let s = queue.shift(); s; s = queue.shift()) runs.set(s.id, await bakeRun(setup, s));
		}),
	);
	const claims = SCENARIOS.flatMap((s) =>
		s.claims(runs.get(s.id)!).map(([label, ok]): [string, boolean] => [`${s.id}: ${label}`, ok]),
	);
	return { claims, runs };
}

const { claims, runs } = await runClaims(realSetup);
for (const [label, ok] of claims) {
	const r = runs.get(label.slice(0, label.indexOf(': ')))!;
	check(label, ok, ok ? '' : `exit ${r.code}\n${r.log.split('\n').slice(-12).join('\n        ')}`);
}

// The verdicts the bake cannot be driven into against a live socket without minutes of retries.
const verdict = (
	get: (url: string) => Promise<Response>,
	lifted = client.publishAnywayFrom([], {}),
) => client.runPublishCheck({ base: 'http://portal.test', project: 'p', token: 't', lifted, get });
const down = await verdict(async () => {
	throw new TypeError('fetch failed');
});
check(
	'a network failure is unreachable, and refused',
	down.status === 'unreachable' &&
		client.publishCheckRefusal(down)?.gate === 'publish-check-unreachable',
	JSON.stringify(down),
);
const failing = await verdict(async () => new Response('upstream error', { status: 502 }));
check('a 5xx after the retries is unreachable', failing.status === 'unreachable');
const mismatch = await verdict(async () =>
	Response.json({ ok: true, checked: ['sounds'], failed: [{ id: 'unapproved-sounds' }] }),
);
check('an answer that contradicts itself is no verdict', mismatch.status === 'unreachable');
check(
	'--publish-anyway <ids> lifts only those ids',
	(() => {
		const lifted = client.publishAnywayFrom(['--publish-anyway', 'invalid-flow', '--x'], {});
		return (
			!lifted.all &&
			client.lifts(lifted, 'invalid-flow') &&
			!client.lifts(lifted, 'unapproved-sounds')
		);
	})(),
);

// ── 3. Local and CI builds ──────────────────────────────────────────────────────────────────────
console.log('3. local and CI builds stay off the portal');
const linesBuild = JSON.parse(read('apps/lines/package.json')).scripts?.build as string;
check(
	'`pnpm build` in apps/lines runs no bake (so never the checks)',
	typeof linesBuild === 'string' && !/bake|publish-check/.test(linesBuild),
	linesBuild,
);
const workflows = readdirSync(join(ROOT, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f));
const baking = workflows.filter((f) => {
	const code = read(`.github/workflows/${f}`)
		.split('\n')
		.filter((l) => !l.trim().startsWith('#'))
		.join('\n');
	return /bake-editor-doc|bake:doc/.test(code);
});
check('no CI workflow bakes (so none needs the portal)', baking.length === 0, baking.join());
const scaffold = read('scripts/new-game.mjs');
const buildLine = /build:\s*\n?\s*'([^']*bake:doc[^']*)'/.exec(scaffold)?.[1] ?? '';
check(
	'a scaffolded game bakes before it pulls or compiles, so the checks come first',
	buildLine.indexOf('bake:doc') >= 0 &&
		buildLine.indexOf('bake:doc') < buildLine.indexOf('pull:assets') &&
		buildLine.indexOf('pull:assets') < buildLine.indexOf('vite build'),
	buildLine,
);

// ── 4. The build breakdown ──────────────────────────────────────────────────────────────────────
console.log('4. the build breakdown shows a build shipped past the checks');
const overriddenReport = runs.get('draft sounds, IE_PUBLISH_ANYWAY=1')?.report;
const passedReport = runs.get('a clean project')?.report;
const breakdownIssues = (report: unknown): { title: string; level: string; items: string[] }[] => {
	const dir = mkdtempSync(join(tmpdir(), 'ie-publish-check-breakdown-'));
	try {
		mkdirSync(join(dir, 'build'));
		writeFileSync(join(dir, 'build', 'index.html'), '<!doctype html><title>g</title>');
		mkdirSync(join(dir, 'report'));
		if (report) writeFileSync(join(dir, 'report', 'publish-check.json'), JSON.stringify(report));
		const run = spawnSync(
			process.execPath,
			[
				join(ROOT, 'scripts/build-breakdown.mjs'),
				'--build',
				join(dir, 'build'),
				'--report-dir',
				join(dir, 'report'),
			],
			{ encoding: 'utf8' },
		);
		if (run.status !== 0) return [{ title: 'FAILED', level: 'error', items: [run.stderr] }];
		return JSON.parse(readFileSync(join(dir, 'report', 'build-breakdown.json'), 'utf8')).issues;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
};
const shipped = breakdownIssues(overriddenReport);
const past = shipped.find((i) => i.title === 'Shipped past the publish checks');
check(
	'a build shipped past the checks says so, naming each draft',
	past?.level === 'warn' && past.items.some((i) => i.includes('sfx_coin')),
	JSON.stringify(shipped.map((i) => i.title)),
);
check(
	'a build that passed adds nothing',
	!breakdownIssues(passedReport).some((i) => /publish checks/i.test(i.title)),
);
check(
	'an unchecked build is a warning of its own',
	client
		.publishCheckIssues({ status: 'unchecked', error: 'HTTP 404', failed: [], overridden: [] })
		.some((i: { title: string }) => i.title === 'Publish checks never ran'),
);

// ── 5. Mutants ──────────────────────────────────────────────────────────────────────────────────
console.log('5. planted mutants are caught');
type Mutant = { name: string; file: 'portal' | 'client' | 'bake'; from: string; to: string };
const MUTANTS: Mutant[] = [
	{
		name: 'the portal skips the sound check',
		file: 'portal',
		from: 'if (sounds.unapproved.length) {',
		to: 'if (sounds.unapproved.length < 0) {',
	},
	{
		name: 'the portal lets a flow of another kind be overridden',
		file: 'portal',
		from: 'overridable: flowGateRefusal(flow, gameType, true) === null,',
		to: 'overridable: true,',
	},
	{
		name: 'the portal skips the family check',
		file: 'portal',
		from: 'const unplayable = unplayableFamilyMessage(config);',
		to: 'const unplayable = unplayableFamilyMessage(null);',
	},
	{
		name: 'an unanswered check passes',
		file: 'client',
		from: "if (verdict.status === 'unreachable') {",
		to: "if (verdict.status === 'never') {",
	},
	{
		name: 'the override lifts a finding with none',
		file: 'client',
		from: 'failed.filter((f) => f.overridable && lifts(lifted, f.id))',
		to: 'failed.filter((f) => lifts(lifted, f.id))',
	},
	{
		name: 'the override never lifts',
		file: 'client',
		from: 'export const lifts = (lifted, id) => lifted.all || lifted.ids.has(id);',
		to: 'export const lifts = () => false;',
	},
	{
		name: 'any IE_PUBLISH_ANYWAY value lifts everything',
		file: 'client',
		from: 'take(env[PUBLISH_ANYWAY.env]);',
		to: 'if (env[PUBLISH_ANYWAY.env]) lifted.all = true;',
	},
	{
		name: 'the bake never runs the checks',
		file: 'bake',
		from: 'else await publishChecks();',
		to: 'else void publishChecks;',
	},
	{
		name: 'the bake warns instead of stopping',
		file: 'bake',
		from: 'if (refusal) refuseAtGate(refusal);',
		to: 'if (refusal) console.warn(refusal.error);',
	},
	{
		name: 'the bake asks the portal on a dev build',
		file: 'bake',
		from: 'async function main() {\n',
		to: 'async function main() {\n\tif (!token) await runPublishCheck({ base, project, token: "", lifted: publishAnyway });\n',
	},
	{
		name: 'the bake asks on a dry run',
		file: 'bake',
		from: "if (dryRun) console.info('(dry run) skipping the publish checks.');\n\telse await publishChecks();",
		to: 'await publishChecks();',
	},
	{
		name: 'the bake writes no verdict',
		file: 'bake',
		from: 'writeBuildReport(PUBLISH_CHECK_REPORT, verdict);',
		to: 'void PUBLISH_CHECK_REPORT;',
	},
	{
		name: "the override does not reach the flow export's gate",
		file: 'bake',
		from: "const allowInvalidFlow = lifts(publishAnyway, 'invalid-flow');",
		to: "const allowInvalidFlow = hasFlag('allow-invalid-flow') || process.env.ALLOW_INVALID_FLOW === '1';",
	},
];

const PORTAL_SRC = fileURLToPath(src('lib/server/publishChecks.ts'));
const SCRIPTS = fileURLToPath(new URL('./', import.meta.url));
const mutate = (text: string, m: Mutant): string | null =>
	text.split(m.from).length === 2 ? text.replace(m.from, m.to) : null;

for (const m of MUTANTS) {
	const dir = mkdtempSync(join(tmpdir(), 'ie-publish-check-mutant-'));
	try {
		let setup = realSetup;
		let applied: string | null;
		if (m.file === 'portal') {
			applied = mutate(readFileSync(PORTAL_SRC, 'utf8'), m);
			if (applied) {
				const file = join(dir, 'publishChecks.ts');
				writeFileSync(
					file,
					applied.replace(
						/from '\.\/(\w+)'/g,
						(_, mod: string) => `from '${src(`lib/server/${mod}.ts`)}'`,
					),
				);
				const mutant = await import(file);
				const answer: Handler = async (url) => ({
					status: 200,
					body: await mutant.runPublishChecks(url.searchParams.get('project') ?? ''),
				});
				setup = { ...realSetup, answer };
			}
		} else {
			// A copy of the bake and its leaf modules, laid out as in the engine, with one file mutated.
			const scripts = join(dir, 'apps/launcher-api/scripts');
			cpSync(join(SCRIPTS, 'bake-editor-doc.mjs'), join(scripts, 'bake-editor-doc.mjs'));
			for (const f of readdirSync(join(SCRIPTS, 'lib')).filter((n) => n.endsWith('.mjs'))) {
				cpSync(join(SCRIPTS, 'lib', f), join(scripts, 'lib', f));
			}
			cpSync(
				join(ROOT, 'packages/config-svelte/appSrc.js'),
				join(dir, 'packages/config-svelte/appSrc.js'),
			);
			const target = join(
				scripts,
				m.file === 'bake' ? 'bake-editor-doc.mjs' : 'lib/publishCheck.mjs',
			);
			applied = mutate(readFileSync(target, 'utf8'), m);
			if (applied) writeFileSync(target, applied);
			setup = { ...realSetup, bake: join(scripts, 'bake-editor-doc.mjs'), cwd: dir };
		}
		check(`mutant "${m.name}" still applies`, applied !== null, m.from);
		if (!applied) continue;
		const caught = (await runClaims(setup)).claims.filter(([, ok]) => !ok);
		check(`mutant "${m.name}" is caught`, caught.length > 0);
		if (caught.length) console.log(`  mutant "${m.name}" caught by: ${caught[0][0]}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

portal.closeAllConnections();
portal.close();
console.log(`${checks - failures}/${checks} desktop publish-check claims hold.`);
if (failures) process.exit(1);
