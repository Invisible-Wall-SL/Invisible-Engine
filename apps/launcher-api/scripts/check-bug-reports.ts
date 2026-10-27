/**
 * Contract check for the two bug tools on one set of modules — Invisible Pipeline Bug Reports
 * (`/bugs`) and Invisible Game Bug Reports (`/game-bugs`) — and the Bugs tab of Invisible Pipeline
 * Changes:
 *   pnpm --filter launcher-api check:bug-reports
 *
 * Runs the REAL modules — `$lib/bugReports.ts`, `bugReports.ts`, both page loaders and the view,
 * the routes under `/api/bugs` and `/api/pipeline/bugs`, and the registry in `roles.ts` — with the
 * database (`bugReportsStore.ts`), R2, the project grants, the tool scope and the role / user
 * overrides replaced at their boundaries, and a fake GitHub App handed to the link sync.
 *
 * Pinned:
 *  - every role reports both kinds by default; triage is one capability per kind
 *    (`pipelineBugTriage`, `gameBugTriage`, each also settable per user), admin, developer and Pipeline
 *    Tester by default, and the override layers win; pipeline bugs sit in the Pipeline stage beside
 *    Pipeline Changes, game bugs in the Build stage, and both guides exist;
 *  - a list is one kind: the pipeline list every pipeline bug, a game list one project's game bugs
 *    (a project the viewer can open); each kind needs its own tool, and a bug of a kind the viewer
 *    lacks reads as no bug;
 *  - a game bug names its project and a part of the game, is never sent to Pipeline Changes, and its
 *    fix brief asks for a fix in that project alone; a purged project's game bug screenshots go;
 *  - a report records the signed-in user as its reporter, and refuses what it must: no title, an
 *    unknown area, a project the reporter cannot open, a page address that is not http(s);
 *  - a bug naming a project the viewer cannot open is not listed, not read, and its screenshots are
 *    not served — the same 404 as a bug that does not exist;
 *  - the text is edited by its reporter or a triager, pinned to the revision opened (409 after);
 *    priority, status, send and take back are triage only; a comment is anyone's;
 *  - screenshots: PNG / JPEG / WebP by their bytes, 10 MB, 10 per bug (the 11th's object is deleted
 *    again), removed by whoever added it, the reporter or a triager, served only through their row;
 *  - linked pull requests: `BUG-<n>` in a title, branch or body of a pull request into main from this
 *    repository links it; open → Working on, merged → Resolved, closed unmerged → back to Open only
 *    when a pull request set Working on and no other is open; only a CHANGE moves a status, so a
 *    status set by hand stays; a link left open is read again by number; a fork's pull request and
 *    an unknown number move nothing; once a minute at most; off (naming the variables) without the
 *    App, and a GitHub failure is a state, not an error;
 *  - Pipeline Changes' Bugs tab lists only what was sent, still-to-do first, behind its own gate;
 *  - the page's filters survive the address, and the activity lines read as sentences.
 */
import { existsSync, readFileSync } from 'node:fs';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { error as httpError, isHttpError } from '@sveltejs/kit';
import { GithubAppError } from '../src/lib/server/githubApp.ts';
import type {
	BugEventInput,
	BugFull,
	BugPatch,
	BugReport,
	BugReportEvent,
	BugReportLink,
	BugReportScreenshot,
	LinkPlanner,
	NewBug,
	Actor,
} from '../src/lib/server/bugReportsStore.ts';

const src = (rel: string) => new URL(`../src/${rel}`, import.meta.url).href;

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

function exportNames(rel: string): string[] {
	const text = readFileSync(fileURLToPath(src(rel)), 'utf8');
	const names = new Set<string>();
	for (const m of text.matchAll(/^export (?:async )?(?:function\*?|class|const|let) (\w+)/gm)) {
		names.add(m[1]);
	}
	return [...names];
}
function fake(rel: string, impl: Record<string, unknown>): void {
	const namedExports: Record<string, unknown> = {};
	for (const name of exportNames(rel)) {
		namedExports[name] =
			name in impl
				? impl[name]
				: () => {
						throw new Error(`fixture: ${rel} ${name} is not faked`);
					};
	}
	for (const name of Object.keys(impl)) {
		if (!(name in namedExports)) throw new Error(`fixture: ${rel} has no export ${name}`);
	}
	mock.module(src(rel), { namedExports });
}

// ── The database, in memory ───────────────────────────────────────────────────
const db: {
	bugs: BugReport[];
	shots: BugReportScreenshot[];
	events: BugReportEvent[];
	links: BugReportLink[];
} = {
	bugs: [] as BugReport[],
	shots: [] as BugReportScreenshot[],
	events: [] as BugReportEvent[],
	links: [] as BugReportLink[],
};
let clock = Date.parse('2026-10-26T10:00:00Z');
const tick = () => new Date((clock += 1000));
const pushEvents = (number: number, actor: Actor, events: BugEventInput[]) => {
	for (const e of events) {
		db.events.push({
			id: db.events.length + 1,
			bugNumber: number,
			at: tick(),
			kind: e.kind,
			actorId: actor.id,
			actor: actor.name,
			data: e.data ?? {},
		});
	}
};
const fullOf = (bug: BugReport): BugFull => ({
	bug: { ...bug },
	screenshots: db.shots.filter((s) => s.bugNumber === bug.number),
	events: db.events.filter((e) => e.bugNumber === bug.number),
	links: db.links.filter((l) => l.bugNumber === bug.number).sort((a, b) => a.prNumber - b.prNumber),
});

fake('lib/server/bugReportsStore.ts', {
	listBugRows: async (where: { kind: string; projectKey?: string }) => {
		const screenshots = new Map<number, number>();
		for (const s of db.shots) screenshots.set(s.bugNumber, (screenshots.get(s.bugNumber) ?? 0) + 1);
		const links = new Map<number, BugReportLink[]>();
		for (const l of db.links) links.set(l.bugNumber, [...(links.get(l.bugNumber) ?? []), l]);
		return {
			bugs: db.bugs
				.filter(
					(b) =>
						b.kind === where.kind &&
						(where.projectKey === undefined || b.projectKey === where.projectKey),
				)
				.sort((a, b) => b.number - a.number)
				.map((b) => ({ ...b })),
			screenshots,
			links,
		};
	},
	getBugFull: async (number: number) => {
		const bug = db.bugs.find((b) => b.number === number);
		return bug ? fullOf(bug) : null;
	},
	getScreenshot: async (number: number, id: string) =>
		db.shots.find((s) => s.bugNumber === number && s.id === id) ?? null,
	existingBugNumbers: async (numbers: number[], kind: string) =>
		numbers.filter((n) => db.bugs.some((b) => b.number === n && b.kind === kind)),
	listOpenLinks: async () =>
		db.links
			.filter((l) => l.state === 'open')
			.map(({ bugNumber, prNumber, updatedAt }) => ({ bugNumber, prNumber, updatedAt })),
	insertBug: async (values: NewBug, actor: Actor, data: Record<string, unknown> = {}) => {
		const at = tick();
		const bug: BugReport = {
			number: db.bugs.length + 1,
			status: 'open',
			statusBy: null,
			statusAt: null,
			statusAuto: false,
			sentAt: null,
			sentBy: null,
			revision: 1,
			createdAt: at,
			updatedAt: at,
			...values,
		};
		db.bugs.push(bug);
		pushEvents(bug.number, actor, [
			{
				kind: 'reported',
				data: { ...data, ...(values.priority ? { priority: values.priority } : {}) },
			},
		]);
		return { ...bug };
	},
	bugsReportedAs: async (reporter: string) =>
		db.bugs
			.filter((b) => b.reporter === reporter)
			.map((b) => ({
				number: b.number,
				kind: b.kind,
				projectKey: b.projectKey,
				status: b.status,
				data: db.events.find((e) => e.bugNumber === b.number && e.kind === 'reported')!.data,
			})),
	mutateBug: async (
		number: number,
		actor: Actor,
		decide: (bug: BugReport) => { set: BugPatch; events: BugEventInput[] } | null,
	) => {
		const bug = db.bugs.find((b) => b.number === number);
		if (!bug) return null;
		const decision = decide({ ...bug });
		if (!decision) return { ...bug };
		Object.assign(bug, decision.set, { updatedAt: tick() });
		pushEvents(number, actor, decision.events);
		return { ...bug };
	},
	insertScreenshot: async (
		row: Omit<BugReportScreenshot, 'uploadedAt'>,
		max: number,
		actor: Actor,
	) => {
		const bug = db.bugs.find((b) => b.number === row.bugNumber);
		if (!bug) return 'missing';
		if (db.shots.filter((s) => s.bugNumber === row.bugNumber).length >= max) return 'full';
		db.shots.push({ ...row, uploadedAt: tick() });
		pushEvents(row.bugNumber, actor, [{ kind: 'screenshot_added', data: { id: row.id } }]);
		return 'added';
	},
	deleteScreenshot: async (number: number, id: string, actor: Actor) => {
		const i = db.shots.findIndex((s) => s.bugNumber === number && s.id === id);
		if (i < 0) return null;
		const [gone] = db.shots.splice(i, 1);
		pushEvents(number, actor, [{ kind: 'screenshot_removed', data: { id } }]);
		return gone;
	},
	reconcileLinks: async (number: number, actor: Actor, plan: LinkPlanner) => {
		const bug = db.bugs.find((b) => b.number === number);
		if (!bug) return;
		const existing = db.links.filter((l) => l.bugNumber === number).map((l) => ({ ...l }));
		const { upserts, removes, set, events } = plan({ ...bug }, existing);
		const at = tick();
		db.links = db.links.filter((l) => l.bugNumber !== number || !removes.includes(l.prNumber));
		for (const u of upserts) {
			const row = db.links.find((l) => l.bugNumber === number && l.prNumber === u.prNumber);
			if (row) Object.assign(row, u, { updatedAt: at });
			else db.links.push({ bugNumber: number, ...u, updatedAt: at });
		}
		if (Object.keys(set).length) Object.assign(bug, set, { updatedAt: at });
		pushEvents(number, actor, events);
	},
});

// ── R2, in memory ──────────────────────────────────────────────────────────────
const objects = new Map<string, { body: Uint8Array<ArrayBuffer>; contentType: string }>();
fake('lib/server/r2.ts', {
	putObjectBytes: async (
		key: string,
		body: Uint8Array,
		contentType: string,
		cond?: { ifNoneMatch?: string },
	) => {
		if (cond?.ifNoneMatch === '*' && objects.has(key)) throw new Error(`exists: ${key}`);
		objects.set(key, { body: new Uint8Array(body), contentType });
		return 'etag';
	},
	getObjectBytes: async (key: string) => {
		const o = objects.get(key);
		return o ? { ...o, etag: 'etag' } : null;
	},
	deleteObject: async (key: string) => {
		objects.delete(key);
	},
	listAllKeys: async (prefix: string) => [...objects.keys()].filter((k) => k.startsWith(prefix)),
	deleteObjects: async (keys: string[]) => {
		for (const k of keys) objects.delete(k);
	},
});

// ── Grants ─────────────────────────────────────────────────────────────────────
type Role = 'admin' | 'developer' | 'artist' | 'pipelineTester' | 'animator';
interface TestUser {
	id: string;
	email: string;
	name: string | null;
	role: Role;
}
const ADMIN: TestUser = {
	id: 'u-admin',
	email: 'boss@example.com',
	name: 'Gualtiero',
	role: 'admin',
};
const DEV: TestUser = { id: 'u-dev', email: 'dev@example.com', name: 'Dana', role: 'developer' };
const ARTIST: TestUser = {
	id: 'u-artist',
	email: 'ann.artist@example.com',
	name: null,
	role: 'artist',
};
const OTHER: TestUser = { id: 'u-anim', email: 'otto@example.com', name: 'Otto', role: 'animator' };
const TESTER: TestUser = {
	id: 'u-test',
	email: 'tess@example.com',
	name: 'Tess',
	role: 'pipelineTester',
};

const PROJECTS = ['cloud', 'borut', 'secret'];
const grants: Record<string, string[]> = {
	'u-admin': PROJECTS,
	'u-dev': ['cloud', 'borut'],
	'u-artist': ['cloud', 'borut'],
	'u-anim': ['cloud'],
	'u-test': ['cloud', 'borut'],
};
fake('lib/server/projects.ts', {
	accessibleProjects: async (userId: string) =>
		(grants[userId] ?? []).map((key) => ({ key, name: key, clientKey: null })),
});
const userOverrides: Record<string, Record<string, boolean>> = {};
fake('lib/server/auth.ts', { SESSION_COOKIE: 'session' });
fake('lib/server/toolScope.ts', {
	resolveToolScope: async ({ url, user }: { url: URL; user: TestUser }) => {
		const asked = url.searchParams.get('project') ?? '';
		return {
			clientKey: 'unassigned',
			projectKey: (grants[user.id] ?? []).includes(asked) ? asked : 'cloud',
		};
	},
	requireProjectScope: async (user: TestUser, project: string | null) => {
		const projectKey = project?.trim() || 'cloud';
		if (!(grants[user.id] ?? []).includes(projectKey)) {
			throw httpError(403, `You do not have access to the project "${projectKey}".`);
		}
		return { clientKey: 'unassigned', projectKey };
	},
});
fake('lib/server/roleToolAccess.ts', { getRoleOverrides: async () => ({}) });
fake('lib/server/userToolAccess.ts', {
	getToolOverrides: async (userId: string) => userOverrides[userId] ?? {},
});

// ── The modules under test ────────────────────────────────────────────────────
const shared = await import(src('lib/bugReports.ts'));
const roles = await import(src('lib/roles.ts'));
const server = await import(src('lib/server/bugReports.ts'));
const view = await import(src('routes/(app)/bugs/view.ts'));
const { reportBugHref } = await import(src('lib/toolLinks.ts'));
const { load: pageLoad } = await import(src('routes/(app)/bugs/+page.server.ts'));
const { load: gamePageLoad } = await import(src('routes/(app)/game-bugs/+page.server.ts'));
const listRoute = await import(src('routes/api/bugs/+server.ts'));
const bugRoute = await import(src('routes/api/bugs/[number]/+server.ts'));
const shotsRoute = await import(src('routes/api/bugs/[number]/screenshots/+server.ts'));
const shotRoute = await import(src('routes/api/bugs/[number]/screenshots/[id]/+server.ts'));
const pipelineRoute = await import(src('routes/api/pipeline/bugs/+server.ts'));

type Json = Record<string, unknown>;
type Answer = { status: number; body: Json; bytes?: Uint8Array; type?: string | null };

async function call(
	handler: (event: unknown) => Promise<Response>,
	user: TestUser | null,
	params: Record<string, string> = {},
	init: { method?: string; json?: unknown; form?: FormData; search?: string } = {},
): Promise<Answer> {
	const url = new URL(`https://app.example/api/bugs${init.search ?? ''}`);
	const request = new Request(url, {
		method: init.method ?? (init.json !== undefined || init.form ? 'POST' : 'GET'),
		headers: init.json !== undefined ? { 'content-type': 'application/json' } : {},
		body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
	});
	try {
		const res = await handler({ locals: { user }, params, request, url });
		const type = res.headers.get('content-type');
		if (type?.startsWith('image/')) {
			return { status: res.status, body: {}, bytes: new Uint8Array(await res.arrayBuffer()), type };
		}
		return { status: res.status, body: (await res.json()) as Json, type };
	} catch (err) {
		if (isHttpError(err)) return { status: err.status, body: { error: err.body.message } };
		throw err;
	}
}
const list = (u: TestUser | null) => call(listRoute.GET, u, {}, { search: '?kind=pipeline' });
const gameList = (u: TestUser, project: string) =>
	call(listRoute.GET, u, {}, { search: `?kind=game&project=${project}` });
const numbers = (a: Answer) => (a.body.bugs as { number: number }[]).map((b) => b.number);
const report = (u: TestUser, json: Record<string, unknown>) =>
	call(listRoute.POST, u, {}, { json: { kind: 'pipeline', ...json } });
const reportGame = (u: TestUser, json: Record<string, unknown>) =>
	call(listRoute.POST, u, {}, { json: { kind: 'game', ...json } });
const read = (u: TestUser, n: number) => call(bugRoute.GET, u, { number: String(n) });
const act = (u: TestUser, n: number, json: unknown) =>
	call(bugRoute.POST, u, { number: String(n) }, { json });
const upload = (u: TestUser, n: number, bytes: Uint8Array, name = 'shot.png') => {
	const form = new FormData();
	form.append('file', new File([bytes], name));
	return call(shotsRoute.POST, u, { number: String(n) }, { form });
};
const shot = (u: TestUser, n: number, id: string, method = 'GET') =>
	call(shotRoute[method as 'GET' | 'DELETE'], u, { number: String(n), id }, { method });

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const WEBP = new Uint8Array(
	[...'RIFF']
		.map((c) => c.charCodeAt(0))
		.concat(
			[0, 0, 0, 0],
			[...'WEBP'].map((c) => c.charCodeAt(0)),
		),
);

// ── Shared vocabulary ──────────────────────────────────────────────────────────
check(
	'bugRefsIn: titles, branches and bodies; not debug-3; not bug-0; once each, sorted',
	shared.bugRefsIn('fix: BUG-12 and bug-7\nfix/bug-12-crash debug-3 BUG-0 xbug-4 Bug-41'),
	[7, 12, 41],
);
const auto = shared.autoStatus;
check(
	'autoStatus: open moves only Open; merged resolves Open and Working on; closed reopens only an automatic Working on with no other open link',
	[
		auto('open', 'open', false, false),
		auto('working', 'open', false, false),
		auto('resolved', 'open', false, false),
		auto('open', 'merged', false, false),
		auto('working', 'merged', true, true),
		auto('wontFix', 'merged', false, false),
		auto('resolved', 'merged', true, false),
		auto('working', 'closed', true, false),
		auto('working', 'closed', true, true),
		auto('working', 'closed', false, false),
		auto('open', 'closed', true, false),
	],
	['working', null, null, 'resolved', 'resolved', null, null, 'open', null, null, null],
);
check(
	'cleanPageUrl: http(s) only',
	[
		shared.cleanPageUrl('https://app.invisiblewall.org/rigger?x=1'),
		shared.cleanPageUrl('javascript:alert(1)'),
		shared.cleanPageUrl('data:text/html,hi'),
		shared.cleanPageUrl('not a url'),
	],
	['https://app.invisiblewall.org/rigger?x=1', null, null, null],
);
check(
	'areas: a pipeline bug is in a tool, the engine, the launcher or other; a game bug in a part of the game',
	[
		shared.isBugArea('pipeline', 'rigger'),
		shared.isBugArea('pipeline', 'engine'),
		shared.isBugArea('pipeline', 'wins'),
		shared.isBugArea('game', 'wins'),
		shared.isBugArea('game', 'rigger'),
		shared.bugAreas('pipeline').length,
		shared.bugAreas('game').map((a: { id: string }) => a.id),
		shared.bugAreaName('pipeline', 'engine'),
		shared.bugAreaName('game', 'features'),
	],
	[
		true,
		true,
		false,
		true,
		false,
		Object.keys(roles.TOOLS).length + 3,
		['gameplay', 'wins', 'features', 'art', 'ui', 'text', 'sound', 'loading', 'other'],
		'Game runtime (engine)',
		'Bonus and free spins',
	],
);
check(
	"areas: an object's own built-ins are not areas",
	[
		shared.isBugArea('game', 'constructor'),
		shared.isBugArea('pipeline', 'toString'),
		shared.isBugArea('game', '__proto__'),
		shared.bugAreaName('game', 'constructor'),
	],
	[false, false, false, 'constructor'],
);
check(
	'bugPath: a pipeline bug on /bugs, a game bug under its project',
	[
		shared.bugPath({ number: 4, kind: 'pipeline', projectKey: 'borut' }),
		shared.bugPath({ number: 5, kind: 'game', projectKey: 'my game' }),
	],
	['/bugs?bug=4', '/game-bugs?project=my%20game&bug=5'],
);
const brief: string = shared.bugBrief(
	{
		number: 12,
		kind: 'pipeline',
		title: 'Rigger freezes',
		description: 'It hangs.',
		area: 'rigger',
		projectKey: 'borut',
		pageUrl: null,
		priority: 'high',
		reporter: 'Ann',
		createdAt: '2026-10-26T09:00:00Z',
		screenshots: 2,
	},
	'https://app.example',
);
check(
	'the fix brief: the reference, the facts, the link, and how a pull request links back',
	[
		brief.split('\n')[0],
		brief.includes('Priority: High'),
		brief.includes('Area: Invisible Rigger'),
		brief.includes('https://app.example/bugs?bug=12 (2 screenshots)'),
		brief.includes('Start with the `pipeline-triage` agent, and name the branch `bug-12-…`.'),
	],
	['Fix BUG-12: Rigger freezes', true, true, true, true],
);
const gameBrief: string = shared.bugBrief(
	{
		number: 13,
		kind: 'game',
		title: 'Counter shows 0',
		description: 'After the third free spin.',
		area: 'features',
		projectKey: 'borut',
		pageUrl: null,
		priority: null,
		reporter: 'Ann',
		createdAt: '2026-10-26T09:00:00Z',
		screenshots: 0,
	},
	'https://app.example',
);
check(
	"a game bug's brief: about that game alone, with no pull-request instructions",
	[
		gameBrief.split('\n')[0],
		gameBrief.includes("Fix it in that project's own content"),
		gameBrief.includes('Do not change the engine, a tool, a template or another project'),
		gameBrief.includes('Part of the game: Bonus and free spins'),
		gameBrief.includes('https://app.example/game-bugs?project=borut&bug=13'),
		gameBrief.includes('pull request'),
		gameBrief.includes('pipeline-triage') || gameBrief.includes('bug-13'),
	],
	['Fix BUG-13 in the game borut: Counter shows 0', true, true, true, true, false, false],
);

// ── The registry ───────────────────────────────────────────────────────────────
check(
	'every role reports both kinds by default',
	roles.ROLES.filter(
		(r: string) => !roles.roleHasTool(r, 'pipelineBugs') || !roles.roleHasTool(r, 'gameBugs'),
	),
	[],
);
check('each kind is reported in its own tool', shared.BUG_TOOL, {
	pipeline: 'pipelineBugs',
	game: 'gameBugs',
});
check('each kind has its own triage capability', shared.BUG_TRIAGE, {
	pipeline: 'pipelineBugTriage',
	game: 'gameBugTriage',
});
check(
	'triage defaults, each kind: admin, developer, Pipeline Tester',
	[shared.BUG_TRIAGE.pipeline, shared.BUG_TRIAGE.game].map((key: string) =>
		roles.ROLES.filter((r: string) => roles.roleHasCapability(r, key)),
	),
	[
		['admin', 'developer', 'pipelineTester'],
		['admin', 'developer', 'pipelineTester'],
	],
);
check(
	'triage follows the role and user overrides, one kind without touching the other',
	[
		roles.roleHasCapability('artist', 'gameBugTriage', { gameBugTriage: true }),
		roles.roleHasCapability('artist', 'pipelineBugTriage', { gameBugTriage: true }),
		roles.roleHasCapability('developer', 'pipelineBugTriage', {}, { pipelineBugTriage: false }),
		roles.roleHasCapability('developer', 'gameBugTriage', {}, { pipelineBugTriage: false }),
	],
	[true, false, false, true],
);
check(
	'Admin lists both triage capabilities by name, and only they are also set per user',
	[[shared.bugTriageName('pipeline'), shared.bugTriageName('game')], [...roles.USER_CAPABILITIES]],
	[
		['Triage pipeline bugs', 'Triage game bugs'],
		['pipelineBugTriage', 'gameBugTriage'],
	],
);
const stageOf = (id: string) => roles.stageOfTool(id)?.id;
check(
	'pipeline bugs in the Pipeline section beside Pipeline Changes; game bugs in Create',
	[roles.TOOL_STAGES.find((s: { id: string }) => s.id === 'pipeline')?.tools, stageOf('gameBugs')],
	[['pipelineChanges', 'pipelineBugs'], 'create'],
);
for (const [id, slug] of [
	['pipelineBugs', 'pipeline-bugs'],
	['gameBugs', 'game-bugs'],
]) {
	check(`${id}: doc path`, roles.toolDocPath(id), `docs/${slug}`);
	check(
		`${id}: docs/tools/${slug}.md exists`,
		existsSync(fileURLToPath(new URL(`../../../docs/tools/${slug}.md`, import.meta.url))),
		true,
	);
}

// ── The page loader ────────────────────────────────────────────────────────────
async function loadPage(tools: { id: string }[], search: string, load = pageLoad) {
	try {
		return await load({
			locals: { user: ARTIST },
			parent: async () => ({ tools, bugTriage: { pipeline: false, game: true } }),
			url: new URL(`https://app.example/bugs${search}`),
			cookies: { get: () => 'token' },
		} as never);
	} catch (e) {
		return { status: (e as { status?: number }).status };
	}
}
check('page: 403 without the tool', await loadPage([{ id: 'gameBugs' }], ''), { status: 403 });
const loaded = (await loadPage(
	[{ id: 'pipelineBugs' }],
	'?bug=7&new=1&for=rigger&page=https://x.example/',
)) as {
	selected: number | null;
	report: unknown;
	canTriage: boolean;
};
check(
	'page: ?bug= selects; ?new=1 opens the form with the tool and page it names',
	[loaded.selected, loaded.report, loaded.canTriage],
	[7, { area: 'rigger', pageUrl: 'https://x.example/' }, false],
);
const fromRigger = reportBugHref('/bugs', 'rigger', 'https://app.example/rigger', 'borut');
check(
	"a tool's Report bug button: the pipeline form with that tool filled in, and the page without its query",
	[
		fromRigger,
		(
			(await loadPage([{ id: 'pipelineBugs' }], fromRigger.slice('/bugs'.length))) as {
				report: unknown;
			}
		).report,
	],
	[
		'/bugs?new=1&for=rigger&page=https%3A%2F%2Fapp.example%2Frigger%3Fproject%3Dborut',
		{ area: 'rigger', pageUrl: 'https://app.example/rigger?project=borut' },
	],
);
check(
	'page: an unknown ?for= is dropped',
	((await loadPage([{ id: 'pipelineBugs' }], '?new=1&for=bogus')) as { report: unknown }).report,
	{ area: '', pageUrl: '' },
);
check(
	'game page: 403 without its own tool',
	await loadPage([{ id: 'pipelineBugs' }], '?project=borut', gamePageLoad),
	{ status: 403 },
);
const gamePage = (await loadPage(
	[{ id: 'gameBugs' }],
	'?project=borut&new=1&for=wins',
	gamePageLoad,
)) as { projectKey: string; report: unknown; areas: { id: string }[]; canTriage: boolean };
check(
	"game page: scoped to the project the link names (when the user can open it); the game's parts; its own triage",
	[gamePage.projectKey, gamePage.report, gamePage.areas.length, gamePage.canTriage],
	['borut', { area: 'wins', pageUrl: '' }, 9, true],
);
check(
	"game page: a pipeline area is not a part of the game; a project the user can't open falls back",
	[
		(
			(await loadPage([{ id: 'gameBugs' }], '?new=1&for=rigger', gamePageLoad)) as {
				report: unknown;
			}
		).report,
		(
			(await loadPage([{ id: 'gameBugs' }], '?project=secret', gamePageLoad)) as {
				projectKey: string;
			}
		).projectKey,
	],
	[{ area: '', pageUrl: '' }, 'cloud'],
);

// ── Gates ──────────────────────────────────────────────────────────────────────
check('list: not signed in → 401', (await list(null)).status, 401);
userOverrides['u-anim'] = { pipelineBugs: false, gameBugs: false };
check('list: both tools revoked for the user → 403', (await list(OTHER)).status, 403);
userOverrides['u-anim'] = { pipelineBugs: false };
check(
	'list: one kind revoked → that list 403, the other still answers',
	[(await list(OTHER)).status, (await gameList(OTHER, 'cloud')).status],
	[403, 200],
);
delete userOverrides['u-anim'];
check(
	'list: no kind → 400; a game list of a project the viewer cannot open → 403; none named → the default',
	[
		(await call(listRoute.GET, ARTIST)).status,
		(await gameList(ARTIST, 'secret')).status,
		(await gameList(ARTIST, '')).status,
	],
	[400, 403, 200],
);
const firstList = await list(ARTIST);
check(
	'list: GitHub App unset → the sync is off and names what is missing',
	[firstList.status, (firstList.body.sync as { state: string }).state],
	[200, 'off'],
);

// ── Reporting ──────────────────────────────────────────────────────────────────
const refusals = await Promise.all([
	report(ARTIST, { title: '  ', area: 'rigger' }),
	report(ARTIST, { title: 'x', area: 'nope' }),
	report(ARTIST, { title: 'x', area: 'rigger', project: 'secret' }),
	report(ARTIST, { title: 'x', area: 'rigger', pageUrl: 'javascript:alert(1)' }),
	report(ARTIST, { title: 'x', area: 'rigger', priority: 'urgent' }),
	report(ARTIST, { title: 'x'.repeat(201), area: 'rigger' }),
]);
check(
	'report: refuses no title, an unknown area, a project not theirs, a non-http page, an unknown priority, a long title',
	refusals.map((r) => r.status),
	[400, 400, 400, 400, 400, 400],
);
check('report: nothing was stored by a refusal', db.bugs.length, 0);
const created = await report(ARTIST, {
	title: '  The   Rigger freezes ',
	description: 'Delete a bone.\r\nIt hangs.',
	area: 'rigger',
	project: 'borut',
	pageUrl: 'https://app.example/rigger',
	priority: 'high',
});
check(
	'report: 201, numbered, the reporter is the signed-in user (no name → the email local part)',
	[
		created.status,
		created.body.number,
		created.body.title,
		created.body.description,
		created.body.reporter,
		created.body.status,
		created.body.priority,
		created.body.mine,
		created.body.canEdit,
		(created.body.events as { kind: string }[]).map((e) => e.kind),
	],
	[
		201,
		1,
		'The Rigger freezes',
		'Delete a bone.\nIt hangs.',
		'ann.artist',
		'open',
		'high',
		true,
		true,
		['reported'],
	],
);
const secret = await report(ADMIN, {
	title: 'Secret project crash',
	area: 'engine',
	project: 'secret',
});
const general = await report(DEV, { title: 'Launcher logo blurry', area: 'launcher' });
check('report: two more', [secret.body.number, general.body.number], [2, 3]);
check(
	"report: the reporter's priority is recorded in the activity",
	(created.body.events as { data: Json }[])[0].data,
	{ priority: 'high' },
);

// ── Game bugs: the same modules, one project's list ──────────────────────────
check(
	'game report: refuses no project, a pipeline area, a project not theirs; stores nothing',
	[
		(await reportGame(ARTIST, { title: 'x', area: 'wins' })).status,
		(await reportGame(ARTIST, { title: 'x', area: 'rigger', project: 'borut' })).status,
		(await reportGame(ARTIST, { title: 'x', area: 'wins', project: 'secret' })).status,
		db.bugs.length,
	],
	[400, 400, 400, 3],
);
const gameBug = await reportGame(ARTIST, {
	title: 'Free spins counter shows 0',
	area: 'features',
	project: 'borut',
});
const secretGame = await reportGame(ADMIN, {
	title: 'Secret reels',
	area: 'art',
	project: 'secret',
});
check(
	'game report: 201, a game bug of its project',
	[
		gameBug.status,
		gameBug.body.number,
		gameBug.body.kind,
		gameBug.body.projectKey,
		secretGame.body.number,
	],
	[201, 4, 'game', 'borut', 5],
);
check(
	"lists: the pipeline list has no game bug; a game list is its project's game bugs alone",
	[
		numbers(await list(ADMIN)),
		numbers(await gameList(ADMIN, 'borut')),
		numbers(await gameList(ADMIN, 'secret')),
	],
	[[3, 2, 1], [4], [5]],
);
check(
	'game bugs: never sent to Pipeline Changes, even by a triager',
	[(await act(DEV, 4, { action: 'send' })).status, db.bugs[3].sentAt],
	[400, null],
);
check(
	"game bugs: a project the viewer can't open reads as no bug",
	(await read(OTHER, 4)).status,
	404,
);
userOverrides['u-dev'] = { gameBugs: false };
check(
	'game bugs: without the game tool, a game bug reads as none; a pipeline bug still reads',
	[
		(await read(DEV, 4)).status,
		(await read(DEV, 3)).status,
		(await reportGame(DEV, { title: 'x', area: 'wins', project: 'borut' })).status,
	],
	[404, 200, 403],
);
delete userOverrides['u-dev'];
check(
	'game bugs: an edit keeps it in its project (no project change) and checks the game parts',
	[
		(await act(ARTIST, 4, { action: 'edit', revision: 1, area: 'rigger' })).status,
		(await act(ARTIST, 4, { action: 'edit', revision: 1, project: null })).status,
		(await act(ARTIST, 4, { action: 'edit', revision: 1, project: 'cloud' })).status,
		(await act(ARTIST, 4, { action: 'edit', revision: 1, area: 'ui' })).body.area,
	],
	[400, 400, 400, 'ui'],
);
userOverrides['u-test'] = { pipelineBugTriage: false };
const gameTriage = await act(TESTER, 4, { action: 'priority', priority: 'high' });
const pipelineTriage = await act(TESTER, 3, { action: 'priority', priority: 'high' });
check(
	'triage per card: a game triager without pipeline triage sets a game bug, not a pipeline bug',
	[gameTriage.status, pipelineTriage.status, pipelineTriage.body.error],
	[200, 403, "Changing a bug's priority needs the “Triage pipeline bugs” permission."],
);
delete userOverrides['u-test'];
await upload(ARTIST, 4, PNG);
await upload(ARTIST, 4, JPG, 'b.jpg');
const before = objects.size;
await server.deleteBugScreenshots([4]);
check(
	"purge: a purged project's game bug screenshots go, nothing else",
	[[...objects.keys()].some((k) => k.startsWith('_bugs/4/')), before - objects.size],
	[false, 2],
);

// ── Visibility ─────────────────────────────────────────────────────────────────
const artistList = await list(ARTIST);
check(
	"list: a bug on a project the viewer can't open is not listed",
	(artistList.body.bugs as { number: number }[]).map((b) => b.number),
	[3, 1],
);
check(
	'list: the admin sees all',
	((await list(ADMIN)).body.bugs as { number: number }[]).map((b) => b.number),
	[3, 2, 1],
);
check(
	"read: an unseen project's bug is the same 404 as none",
	[
		(await read(ARTIST, 2)).status,
		(await read(ARTIST, 99)).status,
		(await read(ARTIST, 2)).body.error,
	],
	[404, 404, 'There is no BUG-2.'],
);
grants['u-artist'] = ['cloud'];
check(
	"read: a reporter still sees their own bug on a project they lost; others don't",
	[(await read(ARTIST, 1)).status, numbers(await list(ARTIST)), (await read(OTHER, 1)).status],
	[200, [3, 1], 404],
);
grants['u-artist'] = ['cloud', 'borut'];
check(
	'read: a bad number is a 404',
	(await call(bugRoute.GET, ARTIST, { number: '1e3' })).status,
	404,
);

// ── Editing ────────────────────────────────────────────────────────────────────
check(
	'edit: not the reporter, not a triager → 403',
	(await act(OTHER, 3, { action: 'edit', revision: 1, title: 'mine now' })).status,
	403,
);
const edited = await act(ARTIST, 1, {
	action: 'edit',
	revision: 1,
	title: 'Rigger freezes on bone delete',
	description: 'Delete a bone.\nIt hangs.',
	area: 'rigger',
});
check(
	'edit: the reporter edits; only what changed is recorded; the revision moves',
	[
		edited.status,
		edited.body.title,
		edited.body.revision,
		(edited.body.events as { kind: string; data: Json }[]).at(-1),
	],
	[
		200,
		'Rigger freezes on bone delete',
		2,
		{
			...(edited.body.events as Json[]).at(-1),
			kind: 'edited',
			data: { fields: ['title'] },
		},
	],
);
const stale = await act(DEV, 1, { action: 'edit', revision: 1, description: 'overwritten' });
check(
	'edit: a stale revision → 409, nothing written',
	[stale.status, db.bugs[0].description],
	[409, 'Delete a bone.\nIt hangs.'],
);
const eventsBefore = db.events.length;
await act(ARTIST, 1, { action: 'edit', revision: 2, title: 'Rigger freezes on bone delete' });
check('edit: no change records nothing', db.events.length, eventsBefore);
check(
	'edit: a project the editor cannot open → 400',
	(await act(ARTIST, 1, { action: 'edit', revision: 2, project: 'secret' })).status,
	400,
);

// ── Triage ─────────────────────────────────────────────────────────────────────
const artistTriage = await Promise.all([
	act(ARTIST, 1, { action: 'priority', priority: 'critical' }),
	act(ARTIST, 1, { action: 'status', status: 'working' }),
	act(ARTIST, 1, { action: 'send' }),
	act(ARTIST, 1, { action: 'unsend' }),
]);
check(
	'triage: a reporter without the capability → 403 for each, naming it',
	[artistTriage.map((r) => r.status), artistTriage[0].body.error],
	[[403, 403, 403, 403], "Changing a bug's priority needs the “Triage pipeline bugs” permission."],
);
const prio = await act(DEV, 1, { action: 'priority', priority: 'critical' });
const status = await act(TESTER, 1, { action: 'status', status: 'working' });
check(
	'triage: a developer sets the priority, a Pipeline Tester the status (by hand)',
	[prio.body.priority, status.body.status, status.body.statusBy, status.body.statusAuto],
	['critical', 'working', 'Tess', false],
);
check(
	'triage: an unknown status → 400',
	(await act(DEV, 1, { action: 'status', status: 'done' })).status,
	400,
);
const sent = await act(DEV, 1, { action: 'send' });
await act(DEV, 1, { action: 'send' });
check(
	'send: once; who and when recorded; a second send records nothing',
	[
		sent.body.sentBy,
		typeof sent.body.sentAt,
		db.events.filter((e) => e.bugNumber === 1 && e.kind === 'sent').length,
	],
	['Dana', 'string', 1],
);
check(
	'comment: anyone who sees the bug',
	(await act(OTHER, 3, { action: 'comment', text: ' Same here. ' })).body.events,
	[...((await read(OTHER, 3)).body.events as Json[])],
);
check('comment: empty → 400', (await act(OTHER, 3, { action: 'comment', text: '  ' })).status, 400);
check('an unknown action → 400', (await act(DEV, 3, { action: 'delete' })).status, 400);

// ── Screenshots ────────────────────────────────────────────────────────────────
const up = await upload(ARTIST, 1, PNG);
const shotId = (up.body.screenshotList as { id: string }[])[0]?.id ?? '';
check(
	'upload: a PNG lands, create-only under _bugs/<n>/, typed by its bytes',
	[
		up.status,
		up.body.screenshots,
		[...objects.keys()],
		(up.body.screenshotList as Json[])[0]?.mediaType,
	],
	[200, 1, [`_bugs/1/${shotId}.png`], 'image/png'],
);
check(
	'upload: JPEG and WebP too; text is 415; empty 400; over 10 MB 413',
	[
		(await upload(DEV, 1, JPG, 'a.jpg')).status,
		(await upload(DEV, 1, WEBP, 'a.webp')).status,
		(await upload(DEV, 1, new TextEncoder().encode('<svg/>'), 'a.svg')).status,
		(await upload(DEV, 1, new Uint8Array(0))).status,
		(await upload(DEV, 1, new Uint8Array(10 * 1024 * 1024 + 1).fill(0x89))).status,
	],
	[200, 200, 415, 400, 413],
);
for (let i = 0; i < 7; i++) await upload(DEV, 1, PNG);
const objectsAtTen = objects.size;
const eleventh = await upload(DEV, 1, PNG);
check(
	'upload: the 11th is refused and its object deleted again',
	[eleventh.status, objects.size, db.shots.filter((s) => s.bugNumber === 1).length],
	[409, objectsAtTen, 10],
);
check("upload: an unseen project's bug → 404", (await upload(ARTIST, 2, PNG)).status, 404);
const served = await shot(OTHER, 1, shotId);
check(
	'serve: the bytes and type, through the row',
	[served.status, served.type, served.bytes?.length],
	[404, undefined, undefined],
);
const servedDev = await shot(DEV, 1, shotId);
check(
	'serve: to a viewer of the bug',
	[servedDev.status, servedDev.type, servedDev.bytes?.length],
	[200, 'image/png', PNG.length],
);
check(
	'serve: an id not on this bug, or not an id → 404',
	[(await shot(DEV, 3, shotId)).status, (await shot(DEV, 1, '../x')).status],
	[404, 404],
);
const devShot = db.shots.find((s) => s.bugNumber === 1 && s.uploadedById === 'u-dev')!;
check(
	'remove: not the uploader, reporter or a triager → 403',
	(await shot(TESTER, 1, devShot.id, 'DELETE')).status,
	200,
);
userOverrides['u-test'] = { pipelineBugTriage: false };
const anotherDevShot = db.shots.find((s) => s.bugNumber === 1 && s.uploadedById === 'u-dev')!;
check(
	"remove: without triage, someone else's screenshot → 403",
	(await shot(TESTER, 1, anotherDevShot.id, 'DELETE')).status,
	403,
);
delete userOverrides['u-test'];
const removed = await shot(ARTIST, 1, anotherDevShot.id, 'DELETE');
check(
	'remove: the reporter removes it, and its object goes',
	[removed.status, objects.has(`_bugs/1/${anotherDevShot.file}`), removed.body.screenshots],
	[200, false, 8],
);

// ── Linked pull requests ──────────────────────────────────────────────────────
const REPO = 'Invisible-Wall-SL/Invisible-Engine';
interface Pull {
	number: number;
	title: string;
	body: string | null;
	state: 'open' | 'closed';
	merged_at: string | null;
	closed_at: string | null;
	head: { ref: string; repo: { full_name: string } | null };
	base: { ref: string };
	html_url: string;
}
const pulls = new Map<number, Pull>();
const pull = (number: number, title: string, opts: Partial<Pull> = {}) =>
	pulls.set(number, {
		number,
		title,
		body: null,
		state: 'open',
		merged_at: null,
		closed_at: null,
		head: { ref: `claude/${number}`, repo: { full_name: REPO } },
		base: { ref: 'main' },
		html_url: `https://github.com/${REPO}/pull/${number}`,
		...opts,
	});
const requests: string[] = [];
let githubDown = false;
const app = {
	missing: () => null,
	json: async <T>(path: string): Promise<T> => {
		requests.push(path);
		if (githubDown) throw new Error('GitHub 502: Bad gateway');
		const one = /\/pulls\/(\d+)$/.exec(path);
		if (one) {
			const found = pulls.get(Number(one[1]));
			if (!found) throw new GithubAppError('GitHub 404: Not Found', 404);
			return found as T;
		}
		const state = /state=(open|closed)/.exec(path)?.[1];
		return [...pulls.values()].filter((p) => p.state === state) as T;
	},
	fetch: async () => {
		throw new Error('not used');
	},
	download: async () => {
		throw new Error('not used');
	},
	slug: async () => 'invisible-pipeline',
};
const sync = async () => {
	server.forgetBugSync();
	return server.syncBugLinks(app);
};
const bug = (n: number) => db.bugs.find((b) => b.number === n)!;
const linksOf = (n: number) =>
	db.links.filter((l) => l.bugNumber === n).map((l) => [l.prNumber, l.state]);

check(
	'sync: off without the App, nothing read',
	[
		(await server.syncBugLinks({ ...app, missing: () => 'GITHUB_APP_ID is not set.' })).state,
		requests.length,
	],
	['off', 0],
);

pull(500, 'launcher: sharper logo (BUG-3)');
pull(501, 'engine: something', { head: { ref: 'fix/bug-1-freeze', repo: { full_name: REPO } } });
pull(502, 'fork: BUG-3 too', { head: { ref: 'x', repo: { full_name: 'someone/fork' } } });
pull(503, 'docs: mentions BUG-999 and BUG-2');
pull(504, 'release branch BUG-3', { base: { ref: 'release' } });
pull(512, 'docs: an example', { body: 'For example, BUG-1 and BUG-3 in passing.' });
const first = await sync();
check(
	'sync: an open pull request naming an Open bug → Working on, automatically, by that pull request',
	[first.state, bug(3).status, bug(3).statusAuto, bug(3).statusBy, linksOf(3)],
	['ok', 'working', true, '#500', [[500, 'open']]],
);
check(
	'sync: a bug already Working on by hand stays as it is, but the link is recorded',
	[bug(1).status, bug(1).statusAuto, linksOf(1)],
	['working', false, [[501, 'open']]],
);
check(
	'sync: a fork, another base, an unknown number and a mention in a description link nothing',
	[linksOf(2), db.links.some((l) => [502, 504, 512].includes(l.prNumber))],
	[[[503, 'open']], false],
);
const linkedEvent = db.events.filter((e) => e.bugNumber === 3).slice(-2);
check(
	'sync: recorded as GitHub (no person), a link then a status',
	linkedEvent.map((e) => [e.actor, e.actorId, e.kind, e.data]),
	[
		['GitHub', null, 'linked', { pr: 500, title: 'launcher: sharper logo (BUG-3)', state: 'open' }],
		['GitHub', null, 'status', { from: 'open', to: 'working', pr: 500, because: 'open' }],
	],
);
const asked = requests.length;
await server.syncBugLinks(app);
check('sync: at most once a minute', requests.length, asked);

pulls.set(500, { ...pulls.get(500)!, state: 'closed', merged_at: null });
await sync();
check(
	'sync: closed unmerged → back to Open (it was automatic, nothing else open)',
	[bug(3).status, linksOf(3)],
	['open', [[500, 'closed']]],
);

pull(505, 'launcher: logo, take two (BUG-3)');
pull(506, 'launcher: logo, take three BUG-3');
await sync();
pulls.set(505, { ...pulls.get(505)!, state: 'closed' });
await sync();
check('sync: one closes while another is open → stays Working on', bug(3).status, 'working');
pulls.set(506, { ...pulls.get(506)!, state: 'closed', merged_at: '2026-10-26T12:00:00Z' });
await sync();
check('sync: merged → Resolved', [bug(3).status, bug(3).statusBy], ['resolved', '#506']);
await act(DEV, 3, { action: 'status', status: 'open' });
await sync();
check(
	'sync: reopened by hand after the merge → stays Open (the link did not change)',
	bug(3).status,
	'open',
);

pulls.set(501, { ...pulls.get(501)!, state: 'closed', merged_at: '2026-10-26T12:00:00Z' });
// Push #501 out of the recent closed page: only a read by number can still see it.
const realJson = app.json;
app.json = async <T>(path: string): Promise<T> =>
	path.includes('state=closed') ? ([] as T) : realJson<T>(path);
requests.length = 0;
await sync();
check(
	'sync: a link still open that the lists no longer show is read by number',
	[requests.some((p) => p.endsWith('/pulls/501')), bug(1).status, linksOf(1)],
	[true, 'resolved', [[501, 'merged']]],
);
app.json = realJson;

pull(509, 'chore: bug-2 lookalike from long ago', {
	state: 'closed',
	merged_at: '2025-01-01T00:00:00Z',
	closed_at: '2025-01-01T00:00:00Z',
});
await sync();
check(
	'sync: a pull request merged before the bug was reported is linked but moves nothing',
	[bug(2).status, linksOf(2)],
	[
		'working',
		[
			[503, 'open'],
			[509, 'merged'],
		],
	],
);

pull(507, 'BUG-2 opened and merged at once', {
	state: 'closed',
	merged_at: '2026-10-26T13:00:00Z',
	closed_at: '2026-10-26T13:00:00Z',
});
await sync();
check('sync: one read with an open and a merged link ends Resolved', bug(2).status, 'resolved');

pull(510, 'engine: BUG-3 again');
await sync();
check('sync: a new open pull request → Working on again', bug(3).status, 'working');
pulls.set(510, { ...pulls.get(510)!, title: 'engine: something else' });
await sync();
check(
	'sync: a pull request that stops naming the bug is unlinked, and its automatic Working on undone',
	[
		bug(3).status,
		linksOf(3).some(([pr]) => pr === 510),
		db.events.filter((e) => e.bugNumber === 3).at(-2)?.kind,
	],
	['open', false, 'unlinked'],
);

pull(511, 'engine: BUG-2 follow-up');
await sync();
pulls.delete(511);
await sync();
check(
	'sync: a linked pull request GitHub no longer has is unlinked',
	linksOf(2).some(([pr]) => pr === 511),
	false,
);

pull(508, 'engine: the free spins counter, BUG-4');
await sync();
check(
	'sync: a game bug is never linked (it is fixed in its project)',
	[bug(4).status, linksOf(4)],
	['open', []],
);

githubDown = true;
const down = await sync();
githubDown = false;
check(
	'sync: GitHub down → a state with its sentence, never a throw',
	[down.state, down.message],
	['error', 'GitHub did not answer: GitHub 502: Bad gateway'],
);

check(
	'planLinks: an existing link whose state did not change moves nothing',
	server.planLinks(
		{ status: 'open', statusAuto: false, createdAt: new Date() },
		[{ prNumber: 9, title: 't', url: 'u', state: 'merged' }],
		[{ prNumber: 9, title: 't', url: 'u', state: 'merged', closedAt: null }],
		[],
		new Date(),
	),
	{ upserts: [], removes: [], set: {}, events: [] },
);

// ── Pipeline Changes' Bugs tab ─────────────────────────────────────────────────
check(
	'pipeline bugs: an artist (no Pipeline Changes) → 403',
	(await call(pipelineRoute.GET, ARTIST)).status,
	403,
);
await act(ADMIN, 2, { action: 'send' });
await act(ADMIN, 3, { action: 'send' });
await act(ADMIN, 3, { action: 'status', status: 'working' });
const tab = await call(pipelineRoute.GET, TESTER);
check(
	'pipeline bugs: only what was sent, still to do first; scoped like Bug Reports (no secret project)',
	(tab.body.bugs as { number: number; status: string }[]).map((b) => [b.number, b.status]),
	[
		[3, 'working'],
		[1, 'resolved'],
	],
);
await act(DEV, 1, { action: 'unsend' });
check(
	'pipeline bugs: taken back → gone from the tab',
	((await call(pipelineRoute.GET, TESTER)).body.bugs as { number: number }[]).map((b) => b.number),
	[3],
);

// ── The page's view ────────────────────────────────────────────────────────────
const filters = {
	...view.DEFAULT_FILTERS,
	q: 'logo',
	status: [],
	priority: ['critical', 'none'],
	area: 'launcher',
	mine: true,
	sort: 'priority',
};
const query = view.filtersToQuery(filters, 'pipeline');
check(
	'filters: through the address and back',
	[query.toString(), view.filtersFromQuery(query, 'pipeline')],
	['q=logo&status=all&priority=critical%2Cnone&area=launcher&mine=1&sort=priority', filters],
);
check(
	'filters: the defaults write nothing; junk reads as the defaults',
	[
		view.filtersToQuery(view.DEFAULT_FILTERS, 'pipeline').toString(),
		view.filtersFromQuery(new URLSearchParams('status=bogus&sent=x&sort=y&priority=z'), 'pipeline'),
	],
	['', { ...view.DEFAULT_FILTERS, status: [] }],
);
check(
	"the address: a game list's project first, then the filters, then the open bug",
	[
		view.addressQuery({ ...view.DEFAULT_FILTERS, q: 'spin' }, 'game', 'borut', 4),
		view.addressQuery(view.DEFAULT_FILTERS, 'pipeline', null, null),
	],
	['project=borut&q=spin&bug=4', ''],
);
check(
	"filters: a game list's ?project= is its scope, never a filter; it has no sent filter",
	[
		view.filtersFromQuery(new URLSearchParams('project=borut&sent=sent&area=wins'), 'game'),
		view.filtersToQuery({ ...view.DEFAULT_FILTERS, project: 'x', sent: 'sent' }, 'game').toString(),
	],
	[{ ...view.DEFAULT_FILTERS, area: 'wins' }, ''],
);
const all = (await list(ADMIN)).body.bugs as Parameters<typeof view.filterBugs>[0];
check(
	'filterBugs: status, priority incl. none, search over text and BUG-<n>',
	[
		view
			.filterBugs(all, { ...view.DEFAULT_FILTERS, status: [] })
			.map((b: { number: number }) => b.number),
		view.filterBugs(all, view.DEFAULT_FILTERS).map((b: { number: number }) => b.number),
		view
			.filterBugs(all, { ...view.DEFAULT_FILTERS, status: [], priority: ['none'] })
			.map((b: { number: number }) => b.number),
		view
			.filterBugs(all, { ...view.DEFAULT_FILTERS, status: [], q: 'bug-2' })
			.map((b: { number: number }) => b.number),
		view
			.filterBugs(all, { ...view.DEFAULT_FILTERS, status: [], q: 'rigger bone' })
			.map((b: { number: number }) => b.number),
	],
	[[3, 2, 1], [3], [3, 2], [2], [1]],
);
check(
	'search: BUG-<n> and #<pr> are exact (BUG-1 is not BUG-10), words are parts of the text',
	[
		view
			.filterBugs([...all, { ...all[0], number: 10, links: [] }], {
				...view.DEFAULT_FILTERS,
				status: [],
				q: 'BUG-1',
			})
			.map((b: { number: number }) => b.number),
		view
			.filterBugs(all, { ...view.DEFAULT_FILTERS, status: [], q: '#506' })
			.map((b: { number: number }) => b.number),
		view.filterBugs(all, { ...view.DEFAULT_FILTERS, status: [], q: '#50' }).length,
	],
	[[1], [3], 0],
);
check(
	'sortBugs: priority (unset last), then newest',
	view.sortBugs(all, 'priority').map((b: { number: number }) => b.number),
	[1, 3, 2],
);
const lines = ((await read(ADMIN, 3)).body.events as Parameters<typeof view.eventText>[0][]).map(
	(e) => `${e.actor} ${view.eventText(e)}`,
);
check('activity lines read as sentences', lines, [
	'Dana reported the bug',
	'Otto commented',
	'GitHub linked #500 “launcher: sharper logo (BUG-3)”',
	'GitHub marked it Working on: #500 opened',
	'GitHub marked it Open: #500 closed without merging',
	'GitHub linked #505 “launcher: logo, take two (BUG-3)”',
	'GitHub linked #506 “launcher: logo, take three BUG-3”',
	'GitHub marked it Working on: #505 opened',
	'GitHub marked it Resolved: #506 merged',
	'Dana marked it Open',
	'GitHub linked #510 “engine: BUG-3 again”',
	'GitHub marked it Working on: #510 opened',
	'GitHub unlinked #510: it no longer names this bug',
	'GitHub marked it Open: #510 no longer names it',
	'Gualtiero sent it to Pipeline Changes',
	'Gualtiero marked it Working on',
]);

// ── Director files a pipeline bug (ADR-0009 §2) ───────────────────────────────
{
	const request = {
		runProjectKey: 'new_game',
		templateProjectKey: 'secret',
		what: 'An FX slot on the big-win screen.',
		reason: 'The mockup has one.',
	};
	const answer = await server.createDirectorBug({
		...request,
		runId: 'run-9c',
		opId: 'run-9c:coordinator-t1:0',
		ownerId: OTHER.id,
		projectKey: null,
	});
	const filed = answer.filed;
	const seen = (await read(TESTER, filed.number)).body;
	const shown = `${seen.title}\n${seen.description}`;
	check(
		'a Director run files an Open, unsent pipeline bug, reported by the run, linked to its page',
		[seen.kind, seen.status, seen.sentAt, seen.reporter, seen.area, seen.pageUrl],
		[
			'pipeline',
			'open',
			null,
			'Director run run-9c',
			'director',
			'http://localhost:3010/director/run-9c',
		],
	);
	check(
		"…naming no project it may not show: neither key nor the agent's words, and no opId in its activity",
		[
			seen.projectKey,
			['new_game', 'secret', request.what, request.reason].filter((t) => shown.includes(t)),
			(seen.events as { kind: string; data: object }[]).map((e) => [e.kind, e.data]),
		],
		[null, [], [['reported', {}]]],
	);
	check(
		"…its owner sees it as theirs; it is not in Pipeline Changes' Bugs tab until a triager sends it",
		[
			(await read(OTHER, filed.number)).body.mine,
			((await call(pipelineRoute.GET, TESTER)).body.bugs as { number: number }[]).map(
				(b) => b.number,
			),
		],
		[true, [3]],
	);
	const keyed = (
		await server.createDirectorBug({
			...request,
			runId: 'run-9d',
			opId: 'run-9d:coordinator-t1:0',
			ownerId: ADMIN.id,
			projectKey: 'secret',
			what: 'A region named BUG-3.',
		})
	).filed;
	check(
		'a bug that names the template: a viewer without it cannot open it, its owner reads it in full',
		[
			(await read(TESTER, keyed.number)).status,
			(await read(ADMIN, keyed.number)).body.description.includes(
				"Template: secret (the run's own project is not made yet)",
			),
			(await read(ADMIN, keyed.number)).body.title,
		],
		[404, true, 'A region named bug #3.'],
	);
}

if (failures) {
	console.error(`\n${failures} of ${checks} bug-reports checks failed.`);
	process.exit(1);
}
console.log(`All ${checks} bug-reports checks pass.`);
