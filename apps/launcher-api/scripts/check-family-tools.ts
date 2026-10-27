/**
 * check:family-tools — which tools a game family is offered (`docs/design/game-families.md` §6.5,
 * §7.2 P10.1b).
 *
 *   pnpm --filter launcher-api check:family-tools
 *
 *  1. THE LIST. Every id `FAMILY_TOOLS` names is a real tool, every family has a row, and slot and
 *     match-3 hide only Invisible Characters (arcade-only, P10.11). Every Director adapter tool maps
 *     to a real launcher tool.
 *  2. THE MANIFEST. The REAL `(app)/+layout.server.ts` load, for every role: a slot project, a
 *     project with no recorded kind and the shared `cloud` scope get `manifestForRole` without
 *     Invisible Characters — the list from before that tool existed, pinned by name; a match-3
 *     project the same; an arcade project the role's whole manifest minus Symbols and Win Text. A tool
 *     page's `?project=` decides the family before the page syncs it into the session, and the
 *     load reads it TRACKED (the event has no `untrack`), so a client-side hop to another
 *     project's `?project=` re-runs it. Onboarding keeps the role's whole manifest.
 *  3. THE NOTICE. The REAL `(app)/+layout.svelte`, rendered on the server: a hidden tool's URL (and
 *     a path under it) shows the notice, naming the project, and not the page; a slot project, and
 *     any tool the family uses, render the page untouched. `/characters` is the notice for a slot
 *     or match-3 project and the page for an arcade one.
 *  4. DIRECTOR'S GATE. The REAL `director/gate.ts` refuses an op on a tool the project's family
 *     does not use (`not_for_family`) and runs the same op for a slot project. No Director op
 *     authors characters, so the gate needs no row for them.
 *
 * Postgres-backed modules are replaced by in-memory tables; any export the fixture does not
 * implement throws when called, so a path that reaches past the fakes fails loudly.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { GAME_FAMILIES } from 'constants-shared/gameKinds';
import type { Project } from '../src/lib/server/db/schema.ts';
import {
	FAMILY_LABELS,
	FAMILY_TOOLS,
	ROLES,
	TOOLS,
	manifestForRole,
	type Role,
	type ToolDef,
} from '../src/lib/roles.ts';

const src = (rel: string) => new URL(`../src/${rel}`, import.meta.url).href;
const srcPath = (rel: string) => fileURLToPath(src(rel));

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
	const text = readFileSync(srcPath(rel), 'utf8');
	const names = new Set<string>();
	for (const m of text.matchAll(/^export (?:async )?(?:function\*?|class|const|let) (\w+)/gm)) {
		names.add(m[1]);
	}
	return [...names];
}

/** Fake a module: the given implementations, and a loud failure for every other export. */
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

// ── 1. The list ──────────────────────────────────────────────────────────────────────────────────
check('1. every family has a row', Object.keys(FAMILY_TOOLS).sort(), [...GAME_FAMILIES].sort());
for (const [family, ids] of Object.entries(FAMILY_TOOLS)) {
	check(
		`1. every tool the ${family} family hides is a real tool`,
		ids.filter((id) => !TOOLS[id]),
		[],
	);
}
check('1. the slot family hides only Invisible Characters', FAMILY_TOOLS.slot, ['characters']);
check('1. match-3 hides only Invisible Characters', FAMILY_TOOLS.match3, ['characters']);
check('1. arcade hides Symbols and Win Text (§6.5)', [...FAMILY_TOOLS.arcade].sort(), [
	'symbols',
	'winText',
]);

// The real `projectFamily`, read before `projects.ts` is faked (a query makes it another module).
const { projectFamily } = (await import(
	`${src('lib/server/projects.ts')}?real`
)) as typeof import('../src/lib/server/projects.ts');

// ── Fakes ────────────────────────────────────────────────────────────────────────────────────────
const project = (key: string, gameType: string | null): Project => ({
	key,
	name: key,
	clientKey: 'acme',
	gameType,
	readToken: null,
	launcherProfile: null,
	deletedAt: null,
	directorTemplate: false,
	createdAt: new Date('2026-01-01T00:00:00Z'),
});
const PROJECTS = new Map<string, Project>(
	[
		project('cloud', 'arcade'),
		project('slot', 'holdAndWin'),
		project('legacy', null),
		project('custom', 'my_custom_kind'),
		project('gems', 'match3'),
		project('catcher', 'arcade'),
	].map((p) => [p.key, p]),
);
let sessionProject: string | null = null;
fake('lib/server/projects.ts', {
	DEFAULT_PROJECT_KEY: 'cloud',
	ensureDefaultProject: async () => {},
	accessibleProjects: async () => [...PROJECTS.values()],
	projectFamily,
	storedProjectGameType: async (key: string) => PROJECTS.get(key)?.gameType ?? null,
	projectKeyTaken: async (key: string) => PROJECTS.has(key),
});
fake('lib/server/auth.ts', {
	SESSION_COOKIE: 'iw_session',
	getActiveProjectKey: async () => sessionProject,
});
fake('lib/server/clients.ts', { listClients: async () => [{ key: 'acme', name: 'Acme' }] });
fake('lib/server/roleToolAccess.ts', { getRoleOverrides: async () => ({}) });
fake('lib/server/userToolAccess.ts', { getToolOverrides: async () => ({}) });
fake('lib/server/engineSource.ts', { enginePending: async () => null });
fake('lib/server/toolInstalls.ts', { getInstallPaths: async () => ({}) });
fake('lib/server/testServerManifest.ts', {
	engineDeployStatus: async () => ({ status: 'unknown' }),
});

// ── 2. The manifest ──────────────────────────────────────────────────────────────────────────────
const { load } = (await import(src('routes/(app)/+layout.server.ts'))) as {
	load: (event: unknown) => Promise<{ tools: ToolDef[]; family: string; familyProjectKey: string }>;
};
const loadFor = async (role: Role, session: string | null, search = '') => {
	sessionProject = session;
	return load({
		locals: { user: { id: 'u', email: 'u@example.com', name: 'u', role } },
		cookies: { get: () => 'token' },
		// No `untrack`: SvelteKit tracks `url.searchParams.get('project')` per param, and reading it
		// untracked would leave the tool bar on the last project's family after a client-side hop.
		url: new URL(`https://app.example/win-text${search}`),
	});
};
const ids = (tools: ToolDef[]) => tools.map((t) => t.id);
/** Every tool id before Invisible Characters (P10.11): a slot project's manifest stays inside it. */
const BEFORE_CHARACTERS = new Set([
	'atlasTool',
	'spineViewer',
	'rigger',
	'invisibleLauncher',
	'sheetMaker',
	'comfyui',
	'localization',
	'winText',
	'sound',
	'gameConfig',
	'editor',
	'ftpBrowser',
	'storybook',
	'componentEditor',
	'fontMaker',
	'symbols',
	'gameMaker',
	'flow',
	'fx',
	'shaders',
	'flipbook',
	'director',
	'pipelineChanges',
	'pipelineBugs',
	'gameBugs',
]);
check(
	'2. the registry is the pre-P10.11 list plus Invisible Characters',
	Object.keys(TOOLS).sort(),
	[...BEFORE_CHARACTERS, 'characters'].sort(),
);
for (const role of ROLES) {
	const all = ids(manifestForRole(role));
	const today = all.filter((id) => BEFORE_CHARACTERS.has(id));
	check(
		`2. ${role}: holds Invisible Characters exactly when it holds Game Config`,
		all.includes('characters'),
		all.includes('gameConfig'),
	);
	for (const [key, family] of [
		['slot', 'slot'],
		['legacy', 'slot'],
		['custom', 'slot'],
		['cloud', 'slot'],
		['gems', 'match3'],
	] as const) {
		const data = await loadFor(role, key);
		check(
			`2. ${role}, ${key}: the role's manifest as before Invisible Characters`,
			ids(data.tools),
			today,
		);
		check(`2. ${role}, ${key}: plays as ${family}`, data.family, family);
	}
	const arcade = await loadFor(role, 'catcher');
	check(
		`2. ${role}, an arcade project: the manifest without Symbols and Win Text`,
		ids(arcade.tools),
		all.filter((id) => id !== 'symbols' && id !== 'winText'),
	);
	check(
		`2. ${role}, an arcade project: Invisible Characters when the role has it`,
		ids(arcade.tools).includes('characters'),
		all.includes('characters'),
	);
	const opened = await loadFor(role, 'slot', '?project=catcher');
	check(
		`2. ${role}, a slot session opening an arcade project's ?project=: arcade`,
		[opened.family, opened.familyProjectKey],
		['arcade', 'catcher'],
	);
	check(
		`2. ${role}, an arcade session opening a slot project's ?project=: slot`,
		(await loadFor(role, 'catcher', '?project=slot')).family,
		'slot',
	);
	check(
		`2. ${role}, an unknown ?project= falls back to the session's project`,
		(await loadFor(role, 'catcher', '?project=nope')).family,
		'arcade',
	);
	const onboarding = (await import(src('routes/(app)/onboarding/+page.server.ts'))) as {
		load: (event: unknown) => Promise<{ tools: ToolDef[] }>;
	};
	check(
		`2. ${role}: onboarding lists the role's whole manifest, whatever the family`,
		ids((await onboarding.load({ locals: { user: { id: 'u', role } } })).tools),
		all,
	);
}

// ── 3. The notice ────────────────────────────────────────────────────────────────────────────────
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
	configFile: `${root}vite.config.js`,
	server: { middlewareMode: true, hmr: false },
	appType: 'custom',
	logLevel: 'error',
	ssr: {
		noExternal: [
			/^(game-config|engine-|constants-|rgs-|utils-|components-|pixi-svelte|state-shared|config-)/,
		],
	},
});
try {
	const { render } = (await server.ssrLoadModule(
		'svelte/server',
	)) as typeof import('svelte/server');
	const { createRawSnippet } = (await server.ssrLoadModule('svelte')) as typeof import('svelte');
	const layout = (await server.ssrLoadModule('/src/routes/(app)/+layout.svelte')) as {
		default: never;
	};
	const PAGE = 'THE-TOOL-PAGE';
	const children = createRawSnippet(() => ({ render: () => `<p>${PAGE}</p>` }));
	const renderAt = (pathname: string, family: string) => {
		const data = {
			tools: manifestForRole('admin'),
			family,
			familyProjectKey: 'catcher',
			projects: [{ key: 'catcher', name: 'Catch the Salmon' }],
		};
		// `$app/state` reads the request from this context key, as SvelteKit's root sets it.
		const page = { url: new URL(`https://app.example${pathname}`) };
		const context = new Map([['__request__', { page }]]);
		return render(layout.default, { props: { data, children }, context } as never).body;
	};
	for (const [path, name] of [
		['/win-text', 'Invisible Win Text'],
		['/symbols', 'Invisible Symbols State Machine'],
		['/symbols/anything', 'Invisible Symbols State Machine'],
	] as const) {
		const body = renderAt(path, 'arcade');
		check(
			`3. arcade ${path}: the notice`,
			body.includes(`${name} is not used by arcade games`),
			true,
		);
		check(`3. arcade ${path}: not the tool`, body.includes(PAGE), false);
		check(`3. arcade ${path}: names the project`, body.includes('Catch the Salmon'), true);
		check(`3. arcade ${path}: a link home`, body.includes('href="/"'), true);
		for (const family of ['slot', 'match3']) {
			const page = renderAt(path, family);
			check(
				`3. ${family} ${path}: the tool`,
				[page.includes(PAGE), page.includes('not used by')],
				[true, false],
			);
		}
	}
	for (const family of ['slot', 'match3'] as const) {
		for (const path of ['/characters', '/characters/anything']) {
			const body = renderAt(path, family);
			check(
				`3. ${family} ${path}: the notice`,
				body.includes(`Invisible Characters is not used by ${FAMILY_LABELS[family]} games`),
				true,
			);
			check(`3. ${family} ${path}: not the tool`, body.includes(PAGE), false);
		}
	}
	for (const path of ['/', '/config', '/editor', '/win-textual', '/flow-v2', '/characters']) {
		const body = renderAt(path, 'arcade');
		check(
			`3. arcade ${path}: the page, no notice`,
			[body.includes(PAGE), body.includes('not used by')],
			[true, false],
		);
	}
	check(
		'3. a slot render is the page and nothing else',
		renderAt('/win-text', 'slot')
			.replace(/<!--[^>]*-->/g, '')
			.trim(),
		`<p>${PAGE}</p>`,
	);
} finally {
	await server.close();
}

// ── 4. Director's gate ───────────────────────────────────────────────────────────────────────────
const { ADAPTER_TOOL_IDS, defineOp } = await import(src('lib/server/director/adapter.ts'));
const opsDir = srcPath('lib/server/director/ops/');
const opTools = new Set<string>();
for (const file of readdirSync(opsDir).filter((f) => f.endsWith('.ts'))) {
	for (const m of readFileSync(`${opsDir}${file}`, 'utf8').matchAll(/^\s*tool: '([a-z]+)'/gm)) {
		opTools.add(m[1]);
	}
}
check(
	'4. every adapter tool the ops declare maps to a launcher tool',
	[...opTools].filter((t) => !TOOLS[(ADAPTER_TOOL_IDS as Record<string, string>)[t]]),
	[],
);
check('4. the scan sees the ops declare their tools', opTools.has('wintext'), true);
check(
	'4. no Director op authors characters (the gate needs no row for them)',
	[...opTools].filter((t) => (ADAPTER_TOOL_IDS as Record<string, string>)[t] === 'characters'),
	[],
);

fake('lib/server/director/store.ts', {
	getRun: async (id: string) => ({
		id,
		projectKey: id,
		clientKey: 'acme',
		templateProjectKey: 'slot',
		ownerUserId: 'owner',
		projectCreateStartedAt: null,
		templateConfigEtag: null,
		projectConfigEtag: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	}),
	getRunOwner: async () => ({
		id: 'owner',
		email: 'o@example.com',
		name: 'owner',
		role: 'admin',
	}),
});
fake('lib/server/toolScope.ts', {
	requireProjectScope: async (_user: unknown, projectKey: string) => ({
		clientKey: 'acme',
		projectKey,
	}),
});
const { runAdapterCall } = await import(src('lib/server/director/gate.ts'));
const { buildRegistry } = await import(src('lib/server/director/registry.ts'));
const readOp = (tool: string) =>
	defineOp({
		tool,
		name: 'read_doc',
		description: 'A test-only read.',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		agents: ['builder'],
		scope: 'project',
		write: false,
		handler: async () => ({ ran: tool }),
	});
const registry = buildRegistry(['symbols', 'wintext', 'scene'].map(readOp));
const TOKEN = 'service-token';
const call = (tool: string, project: string) =>
	runAdapterCall(
		{
			tool,
			op: 'read_doc',
			authorization: `Bearer ${TOKEN}`,
			body: { runId: project, agent: 'builder', input: {} },
		},
		registry,
		TOKEN,
	);
for (const [tool, name] of [
	['symbols', 'Invisible Symbols State Machine'],
	['wintext', 'Invisible Win Text'],
] as const) {
	const refused = await call(tool, 'catcher');
	check(
		`4. ${tool} on an arcade project is refused`,
		[refused.status, (refused.body as { error: string }).error],
		[403, 'not_for_family'],
	);
	check(
		`4. ${tool}'s refusal names the tool and the family`,
		(refused.body as { message: string }).message,
		`${name} is not used by arcade games.`,
	);
	for (const key of ['slot', 'legacy', 'gems', 'cloud']) {
		const ran = await call(tool, key);
		check(`4. ${tool} on ${key} runs`, [ran.status, ran.body], [200, { ran: tool }]);
	}
}
const scene = await call('scene', 'catcher');
check(
	'4. a tool arcade uses runs on an arcade project',
	[scene.status, scene.body],
	[200, { ran: 'scene' }],
);
let unmapped = '';
try {
	buildRegistry([readOp('nosuchtool')]);
} catch (e) {
	unmapped = (e as Error).message;
}
check(
	'4. the registry refuses an op whose tool maps to no launcher tool',
	unmapped.includes('must map to a launcher tool'),
	true,
);

console.log(`check:family-tools — ${checks - failures}/${checks} passed`);
if (failures) process.exit(1);
