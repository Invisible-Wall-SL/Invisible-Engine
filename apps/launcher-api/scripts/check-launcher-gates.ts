/**
 * Contract check for the launcher auth gates, run over the REAL modules:
 *   pnpm --filter launcher-api check:launcher-gates
 *
 * It exists because this app has no type-check — a type error compiles and ships green (see
 * `apps/launcher-api/CLAUDE.md` §Validate) — and because a gate that quietly stops refusing,
 * or one that refuses somebody it was explicitly told to let in, is invisible until a human
 * hits it. Both had already happened: `gamePublish` opened the deploy token while the very
 * next call in the same publish compared a hard-coded `user.role !== 'admin'`, so no grant in
 * /admin could ever reach it.
 *
 * Two halves:
 *  1. the DECISION (`$lib/launcherGates`) resolved over the real role matrix — admin in, a
 *     granted role in, an ungranted role 403, no session 401;
 *  2. a SOURCE scan of every `src/routes/api` handler, because the decision being right is
 *     worth nothing if a route doesn't call it. A literal role comparison anywhere under
 *     `api/` fails this check by name, and so does a raw read of the session's stored project
 *     anywhere under `src/`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	bearerToken,
	launcherGateDenial,
	NO_SESSION_DENIAL,
	OWNER_ROLE,
} from '../src/lib/launcherGates.ts';
import {
	adminAccountDenial,
	entitledByAny,
	leaseEntitlingTool,
	mayTargetClient,
	SHADER_EFFECTS_READ_TOOLS,
	SHADER_READ_TOOLS,
	SHADER_TOOL,
	settingValueVisible,
} from '../src/lib/accessRules.ts';
import {
	GAME_PUBLISH_CAPABILITY,
	ROLES,
	ROLE_TOOLS,
	TOOLS,
	roleHasCapability,
} from '../src/lib/roles.ts';

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

const DENIED_401 = { status: 401, error: 'Unauthorized' };
const DENIED_403 = { status: 403, error: 'Forbidden' };

// ── The publish gate: a grant must reach it, and nothing else may ─────────────
check('admin publishes by default', launcherGateDenial('admin', 'publish'), null);
check(
	'developer without the grant is refused',
	launcherGateDenial('developer', 'publish'),
	DENIED_403,
);
check(
	'a role-level grant lets a developer publish',
	launcherGateDenial('developer', 'publish', { [GAME_PUBLISH_CAPABILITY]: true }),
	null,
);
check(
	'and so does a per-user grant on a role that has none',
	launcherGateDenial('artist', 'publish', {}, { [GAME_PUBLISH_CAPABILITY]: true }),
	null,
);
check(
	'a per-user revoke still beats the role grant',
	launcherGateDenial(
		'pipelineTester',
		'publish',
		{ [GAME_PUBLISH_CAPABILITY]: true },
		{ [GAME_PUBLISH_CAPABILITY]: false },
	),
	DENIED_403,
);
// The bug this whole change undoes: publish used to be gated on `adminPanel`, so the only way
// to let a developer publish was to hand them the entire admin panel.
check(
	'an adminPanel grant does NOT open publish',
	launcherGateDenial('developer', 'publish', { adminPanel: true }),
	DENIED_403,
);
check('no session is a 401, not a 403', launcherGateDenial(null, 'publish'), DENIED_401);
// `requireLauncherGate` returns this constant directly (it has to, to narrow the session away),
// so the fixture pins it rather than only the branch that produces it.
check('and it is the constant the helper answers with', NO_SESSION_DENIAL, DENIED_401);

// ── The owner gate: deliberately NOT delegable ────────────────────────────────
check('the owner gate is the admin role', launcherGateDenial(OWNER_ROLE, 'owner'), null);
check('no session is a 401 there too', launcherGateDenial(null, 'owner'), DENIED_401);
for (const grant of ['adminPanel', GAME_PUBLISH_CAPABILITY]) {
	check(
		`no '${grant}' grant opens an owner-only endpoint`,
		launcherGateDenial('developer', 'owner', { [grant]: true }, { [grant]: true }),
		DENIED_403,
	);
}

// ── The baseline stays owner-only: the grant is an explicit act in /admin ─────
for (const role of ROLES) {
	check(
		`'${role}' has gamePublish by default: ${role === 'admin'}`,
		roleHasCapability(role, GAME_PUBLISH_CAPABILITY),
		role === 'admin',
	);
}
// The roles the owner is expected to grant it to — they are the ones that can reach the
// Game Maker page at all, so a Publish button there is otherwise a button that 403s.
for (const role of ['developer', 'pipelineTester'] as const) {
	check(`'${role}' can open Game Maker`, ROLE_TOOLS[role].includes('gameMaker'), true);
}

// ── The bearer parser ─────────────────────────────────────────────────────────
check('bearer token', bearerToken('Bearer abc.def'), 'abc.def');
check('scheme is case-insensitive', bearerToken('bearer abc'), 'abc');
check('no header', bearerToken(null), undefined);
check('another scheme is not a bearer token', bearerToken('Basic abc'), undefined);

// ── Every api route goes through the gate ─────────────────────────────────────
const api = fileURLToPath(new URL('../src/routes/api/', import.meta.url));
const source = (route: string): string => readFileSync(`${api}${route}/+server.ts`, 'utf8');

/** Every step of a game publish, bearer-authed from the desktop launcher. */
const PUBLISH_BEARER = [
	'launcher/deploy-token',
	'launcher/git-credentials',
	'launcher/register-game',
	'launcher/game-upload',
	'launcher/delivery-upload',
	'launcher/projects',
];
for (const route of PUBLISH_BEARER) {
	check(
		`${route} gates on the publish capability`,
		source(route).includes('requireLauncherPublisher'),
		true,
	);
}

/** The same publish, driven from the portal page, where the session is already on `locals`. */
for (const route of ['game-maker/publish', 'game-maker/publish-all']) {
	const s = source(route);
	check(
		`${route} gates on the publish capability`,
		s.includes('userHasCapability') && s.includes('GAME_PUBLISH_CAPABILITY'),
		true,
	);
	check(`${route} no longer gates on adminPanel`, s.includes('ADMIN_PANEL_CAPABILITY'), false);
}

/** Setting the deploy token (the desktop Key Vault) is the owner's alone. */
check(
	'launcher/deploy-token PUT is owner-only',
	/export const PUT[\s\S]*requireLauncherAdmin\(/.test(source('launcher/deploy-token')),
	true,
);

/** Owner-only by nature: machine secrets and the owner's own GPU box. */
for (const route of [
	'launcher/tunnel-bundle',
	'launcher/models-manifest',
	'launcher/comfyui-nodes',
]) {
	check(`${route} stays owner-only`, source(route).includes('requireLauncherAdmin'), true);
}

/**
 * The current-games CI list is gated on its bearer token ALONE (`check-pipeline-games.ts` holds the
 * behaviour): a session must never stand in for it, so the handler may not touch `locals`.
 */
check(
	'pipeline/games gates on the CI token',
	source('pipeline/games').includes('pipelineCiDenial('),
	true,
);
check('pipeline/games never reads the session', /\blocals\b/.test(source('pipeline/games')), false);

/**
 * The game server's config read is gated on its own bearer secret ALONE
 * (`check-game-server-config.ts` holds the behaviour): a session must never stand in for it.
 */
check(
	'game-server/config gates on the game-server secret',
	source('game-server/config').includes('gameServerAuthorized('),
	true,
);
check(
	'game-server/config never reads the session',
	/\blocals\b/.test(source('game-server/config')),
	false,
);

/**
 * The Director adapter gate is the service token's alone (`check-director-adapters.ts` holds the
 * behaviour): the worker acts as the run's owner, never as whoever holds a session.
 */
check(
	'director adapters go through runAdapterCall',
	source('director/adapter/[tool]/[op]').includes('runAdapterCall('),
	true,
);
check(
	'director adapters never read the session',
	/\blocals\b/.test(source('director/adapter/[tool]/[op]')),
	false,
);

/**
 * No handler may compare a role STRING: that is the shape no override can ever reach, which is
 * how the publish chain refused the publishers the owner had just granted.
 */
const LITERAL_ROLE = /\brole\s*[!=]==\s*['"]/;
const handlers = readdirSync(api, { recursive: true, encoding: 'utf8' }).filter((f) =>
	f.endsWith('+server.ts'),
);
check('the api tree was actually walked', handlers.length > 20, true);
for (const file of handlers) {
	check(
		`api/${file.replaceAll('\\', '/')} compares no literal role`,
		LITERAL_ROLE.test(readFileSync(`${api}${file}`, 'utf8')),
		false,
	);
}

/**
 * A handler that takes a project from the request — `?project=` or a body `project` — must check
 * that the caller may reach THAT project. The tool grant is not a project grant: game-config,
 * win-text, symbols, sounds and the component routes once resolved any key they were handed, and
 * single publish took any key that merely existed, so anyone with the tool could read and write
 * another client's project by editing the request. Accepted checks: `requireProjectScope` /
 * `requireOptionalProjectKey` (their behaviour is `check-project-scope.ts`),
 * `requireDirectorProjectScope` (the same rule, or a PENDING project the caller could create —
 * `check-director-runs.ts`), `canAccessProject`, or a token — `projectAllowsRead` is per project,
 * the deploy token is the build runner's and spans them all.
 *
 * Judged PER HANDLER, not per file, so a checked GET cannot vouch for an unchecked PUT beside it.
 */
const PROJECT_READS = [
	/searchParams\.get\(\s*['"`]project['"`]\s*\)/,
	/\bbody\.project\b/,
	/\{[^}]*\bproject\b[^}]*\}\s*=\s*body\b/,
];
const PROJECT_CHECKS = [
	'requireProjectScope(',
	'requireOptionalProjectKey(',
	'requireDirectorProjectScope(',
	'canAccessProject(',
	'projectAllowsRead(',
	'getDeployToken(',
	// The game server's secret reads every project's PUBLISHED config, like the deploy token.
	'gameServerAuthorized(',
];
const PROJECT_READ_EXEMPT: Record<string, string> = {
	'admin/project-footprint': 'gated on adminPanel, which spans every project',
	'admin/rigs': 'gated on adminPanel, which spans every project',
	'flipbook/clip': 'scoped by the session; ?project= only refuses a tab on a stale project',
	'flow-v2/backups': 'scoped by the session; ?project= only refuses a tab on a stale project',
	'flow-v2/instances': 'scoped by the session; ?project= only refuses a tab on a stale project',
	'fx/effect': 'scoped by the session; ?project= only refuses a tab on a stale project',
};
/**
 * Each exported handler's source (the module preamble dropped), declared `export const GET = …` or
 * `export (async) function GET`. Any other way of exporting one fails below, so no handler slips
 * past the per-handler scans unread.
 */
const HANDLER_HEAD = /^export (?:const|(?:async )?function) (GET|POST|PUT|PATCH|DELETE)\b/;
const handlerBlocks = (src: string): string[] =>
	src.split(/^(?=export (?:const|(?:async )?function) (?:GET|POST|PUT|PATCH|DELETE)\b)/m).slice(1);
const handlerMethod = (block: string): string | undefined => HANDLER_HEAD.exec(block)?.[1];
/** `src` without its comments, so a scan matches code and never a sentence about it. */
const codeOf = (src: string): string =>
	src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
for (const file of handlers) {
	const src = codeOf(readFileSync(`${api}${file}`, 'utf8'));
	const route = file.replaceAll('\\', '/').replace(/\/\+server\.ts$/, '');
	check(
		`api/${route} declares its handlers in a form the scans read`,
		[
			handlerBlocks(src).length > 0,
			/\bexport\s*\{[^}]*\b(?:GET|POST|PUT|PATCH|DELETE)\b|\bexport (?:let|var) (?:GET|POST|PUT|PATCH|DELETE)\b/.test(
				src,
			),
		],
		[true, false],
	);
}
const readsProject = new Set<string>();
for (const file of handlers) {
	const route = file.replaceAll('\\', '/').replace(/\/\+server\.ts$/, '');
	const blocks = handlerBlocks(readFileSync(`${api}${file}`, 'utf8'));
	for (const block of blocks) {
		if (!PROJECT_READS.some((re) => re.test(block))) continue;
		readsProject.add(route);
		if (route in PROJECT_READ_EXEMPT) continue;
		const method = handlerMethod(block);
		check(
			`api/${route} ${method} checks access to the project it takes from the request`,
			PROJECT_CHECKS.some((c) => block.includes(c)),
			true,
		);
	}
}
const FIXED = [
	'game-config',
	'game-config/backups',
	'game-config/server-paytable',
	'win-text',
	'editor/symbols',
	'editor/symbols/backups',
	'sounds',
	'sounds/file',
	'editor/component',
	'editor/component-defaults',
	'editor/component-defaults/backups',
	'editor/components',
	'game-maker/publish',
	'launcher/register-game',
];
for (const route of [...FIXED, ...Object.keys(PROJECT_READ_EXEMPT)]) {
	check(`the scan sees api/${route} take a project`, readsProject.has(route), true);
}

/**
 * A body `projectKey` is the scan above's blind spot: the doc-save routes send it only to refuse a
 * tab left on a stale project, then write the SESSION's project, so matching the name would flag
 * them all. Every handler that reads it is therefore named as one or the other. `api/lease` acted
 * on it: anyone could raise a "someone is editing" banner on another client's doc and read back
 * the holder's name and email, and it must also refuse a `clientKey` that is not the project's own.
 * Its behaviour is `check-lease-scope.ts`. Read per FILE, because lease parses its key in a helper
 * outside the handler, so every handler in such a file must carry the checks.
 */
// A tab's project key, from its body or its query string (`?projectKey=` on the GETs).
const BODY_PROJECT_KEY =
	/\bbody\??\.projectKey\b|\(body as [^)]*\)\.projectKey\b|\{[^}]*\bprojectKey\b[^}]*\}\s*=\s*body\b|searchParams\.get\(\s*['"`]projectKey['"`]\s*\)/;
const ACTS_ON_BODY_PROJECT_KEY: Record<string, string[]> = {
	lease: ['canAccessProject(', 'projectClientKey('],
};
const STALE_TAB_GUARDS = [
	'cinematics/delete',
	'cinematics/get',
	'cinematics/list',
	'cinematics/save',
	'editor/art-bounds',
	'editor/art-slices',
	'editor/backups',
	'editor/effect',
	'editor/flipbooks',
	'editor/import',
	'editor/rigs/reindex',
	'editor/rigs/upload',
	'flipbook/save',
	'flow-v2/backups',
	'flow-v2/save',
	'fx/save',
	'rigger/backups',
	'rigger/save',
	'rigger/text',
	'shaders/backups',
	'shaders/delete',
	'shaders/doc',
	'shaders/effects',
	'shaders/list',
	'shaders/publish',
	'shaders/save',
	'shaders/unpublish',
];
const readsBodyProjectKey = new Set<string>();
for (const file of handlers) {
	const route = file.replaceAll('\\', '/').replace(/\/\+server\.ts$/, '');
	const src = readFileSync(`${api}${file}`, 'utf8');
	if (!BODY_PROJECT_KEY.test(src)) continue;
	readsBodyProjectKey.add(route);
	if (STALE_TAB_GUARDS.includes(route)) {
		check(
			`api/${route} only compares body.projectKey against the session's project`,
			/\bbody\.projectKey\s*!==\s*projectKey\b/.test(src) ||
				/\bscopeMismatch\(\s*(?:body\??|\(body as [^)]*\)|url\.searchParams\.get\(\s*'projectKey'\s*\))(?:\.projectKey)?[^,]*,\s*projectKey\b/.test(
					src,
				),
			true,
		);
		// A guard whose answer is dropped guards nothing: every `scopeMismatch(` in the route is
		// followed by returning its refusal.
		const guards = (src.match(/\bscopeMismatch\(/g) ?? []).length;
		const returned = (src.match(/if \(mismatch\) return mismatch;/g) ?? []).length;
		if (guards > 0 && src.includes("from '$lib/server/scopeGuard'")) {
			check(`api/${route} returns every scopeMismatch refusal it computes`, returned, guards);
		}
		continue;
	}
	const required = ACTS_ON_BODY_PROJECT_KEY[route];
	check(`api/${route} reads body.projectKey and is named above`, required !== undefined, true);
	for (const block of handlerBlocks(src)) {
		const method = handlerMethod(block);
		for (const c of required ?? []) {
			check(`api/${route} ${method} calls ${c.slice(0, -1)} on it`, block.includes(c), true);
		}
	}
}
// The shared stale-tab guard only ever COMPARES the sent key; it is never a write target.
const scopeGuard = readFileSync(
	new URL('../src/lib/server/scopeGuard.ts', import.meta.url),
	'utf8',
);
check(
	'scopeMismatch only compares the sent project against the session’s',
	/typeof sent !== 'string' \|\| sent === projectKey/.test(scopeGuard),
	true,
);
for (const route of [...Object.keys(ACTS_ON_BODY_PROJECT_KEY), ...STALE_TAB_GUARDS]) {
	check(`the scan sees api/${route} read body.projectKey`, readsBodyProjectKey.has(route), true);
}

/**
 * The session's stored project is access-checked only when it is SET, so a raw read hands back a
 * project whose grant was revoked since, for as long as the session lives. Every read goes through
 * the re-checking `sessionProjectScope` (its behaviour is `check-project-scope.ts`), except where
 * named below. Matches the identifiers, not just calls, so an aliased import or a direct drizzle
 * read of the column is caught too; scans the whole `src/` tree, since page loaders and `(app)`
 * endpoints read the session as well as `api/` does.
 */
const RAW_SESSION_PROJECT = /\bgetActive(?:ProjectKey|Scope)\b|\bsessions\.activeProjectKey\b/;
const RAW_SESSION_PROJECT_ALLOWED: Record<string, string> = {
	'lib/server/auth.ts': 'defines the raw reads',
	'lib/server/projects.ts': 'soft delete clears the column — a write, never a read',
	'lib/server/toolScope.ts': 'sessionProjectScope, the re-checking read',
	'routes/(app)/+layout.server.ts': 're-checks against the accessible list it already holds',
};
const srcRoot = fileURLToPath(new URL('../src/', import.meta.url));
const rawReaders = readdirSync(srcRoot, { recursive: true, encoding: 'utf8' })
	.map((f) => f.replaceAll('\\', '/'))
	.filter(
		(f) => f.endsWith('.ts') && RAW_SESSION_PROJECT.test(readFileSync(`${srcRoot}${f}`, 'utf8')),
	);
check(
	'nothing reads the stored session project raw — it goes through sessionProjectScope',
	rawReaders.filter((f) => !(f in RAW_SESSION_PROJECT_ALLOWED)),
	[],
);
for (const file of Object.keys(RAW_SESSION_PROJECT_ALLOWED)) {
	check(`the scan sees ${file} read the session project`, rawReaders.includes(file), true);
}

/** A save writes the project its page named, so a refused `?project=` must 403, not fall back. */
for (const page of ['editor', 'localization']) {
	check(
		`the ${page} save action scopes through resolveActionScope`,
		readFileSync(`${srcRoot}routes/(app)/${page}/+page.server.ts`, 'utf8').includes(
			'resolveActionScope({',
		),
		true,
	);
}

// ── Access rules (`$lib/accessRules`) ─────────────────────────────────────────
for (const id of Object.keys(TOOLS)) {
	check(
		`a lease on '${id}' is entitled by ${id === 'componentEditor' ? "'editor', its page's gate" : 'itself'}`,
		leaseEntitlingTool(id),
		id === 'componentEditor' ? 'editor' : id,
	);
}
for (const id of ['probe', '', 'constructor', '__proto__', 'toString']) {
	check(`a lease toolId '${id}' names no tool`, leaseEntitlingTool(id), null);
}

check('an admin may create under any client', mayTargetClient('admin', 'eagaming', []), true);
check('anyone may create unassigned', mayTargetClient('developer', null, []), true);
check(
	'a non-admin may create under a client they are granted',
	mayTargetClient('developer', 'borut', ['borut']),
	true,
);
check(
	'but not under one they are not',
	mayTargetClient('pipelineTester', 'eagaming', ['borut']),
	false,
);

check('an admin may act on any account', adminAccountDenial('admin', { newRole: 'admin' }), null);
for (const role of ROLES.filter((r) => r !== 'admin')) {
	check(
		`an adminPanel holder with role '${role}' cannot grant the admin role`,
		adminAccountDenial(role, { newRole: 'admin' }) !== null,
		true,
	);
	check(
		`nor act on an admin's account`,
		adminAccountDenial(role, { targetRole: 'admin', newRole: 'artist' }) !== null &&
			adminAccountDenial(role, { targetRole: 'admin' }) !== null,
		true,
	);
	check(
		`but may still manage a '${role}' account`,
		adminAccountDenial(role, { targetRole: 'artist', newRole: 'developer' }),
		null,
	);
}

check('the deploy token setting is never shown', settingValueVisible('deployToken'), false);
check('an unknown setting is hidden until allow-listed', settingValueVisible('newSecret'), false);
check('an operational setting is shown', settingValueVisible('runpodIdleMinutes'), true);
check('a non-string key is hidden', settingValueVisible(null), false);

// ── And the routes apply them ─────────────────────────────────────────────────
const routeSource = (path: string): string => readFileSync(`${srcRoot}routes/${path}`, 'utf8');
check(
	'the lease checks the tool through leaseEntitlingTool + userHasTool',
	['leaseEntitlingTool(', 'userHasTool('].every((c) => source('lease').includes(c)),
	true,
);
check(
	'partner-session only mints for a card whose project the caller can reach',
	source('partner-session').includes('canAccessProject('),
	true,
);
check(
	'duplicate goes through duplicateProject',
	source('game-maker/duplicate').includes('duplicateProject('),
	true,
);
check(
	'duplicateProject checks the source project and the destination client',
	['canAccessProject(', 'mayCreateUnderClient('].every((c) =>
		readFileSync(`${srcRoot}lib/server/duplicateProject.ts`, 'utf8').includes(c),
	),
	true,
);
check(
	'Game Maker ?/create checks the destination client',
	routeSource('(app)/game-maker/+page.server.ts').includes('mayCreateUnderClient('),
	true,
);
{
	const admin = routeSource('(app)/admin/+page.server.ts');
	const actionBlock = (name: string): string => {
		const start = admin.indexOf(`\t${name}: async`);
		const next = admin.slice(start + 1).search(/\n\t[a-zA-Z]+: async/);
		return start < 0 ? '' : admin.slice(start, next < 0 ? undefined : start + 1 + next);
	};
	for (const action of [
		'createUser',
		'setRole',
		'setActive',
		'setExpiry',
		'resetPassword',
		'setToolAccess',
		'revokeSession',
		'revokeAllSessions',
		'deleteUser',
		'loadSessions',
	]) {
		check(
			`admin ?/${action} refuses a non-admin acting on the admin role`,
			actionBlock(action).includes('adminAccountRefusal('),
			true,
		);
	}
	check(
		"admin ?/setRoleToolAccess refuses a non-admin editing the admin role's tools",
		actionBlock('setRoleToolAccess').includes('adminAccountDenial('),
		true,
	);
	check(
		'admin ?/resetPassword signs the user out',
		actionBlock('resetPassword').includes('revokeUserSessions('),
		true,
	);
	for (const action of ['createUser', 'resetPassword']) {
		check(
			`admin ?/${action} applies the shared password minimum`,
			actionBlock(action).includes('passwordLengthProblem('),
			true,
		);
	}
}
check(
	'sign-in never applies the new-password minimum (older, shorter passwords keep working)',
	[
		'routes/login/+page.server.ts',
		'routes/api/launcher/login/+server.ts',
		'lib/server/auth.ts',
	].some((path) => readFileSync(`${srcRoot}${path}`, 'utf8').includes('passwordPolicy')),
	false,
);
check(
	'the DB browser redacts by row as well as by column',
	readFileSync(`${srcRoot}lib/server/dbBrowser.ts`, 'utf8').includes('settingValueVisible('),
	true,
);

// ── Shader graph reads: /fx and the Rigger read the compiled effects alone; /shaders writes ─────
/**
 * `shaderReadScope` (docs, list, history, Custom GLSL source) admits {@link SHADER_READ_TOOLS};
 * `shaderEffectsReadScope` (`GET /api/shaders/effects`, the compiled set) admits
 * {@link SHADER_EFFECTS_READ_TOOLS}, which adds `/fx` and the Rigger: they draw a particle material
 * (`custom:<id>`) and need nothing else. Both stay on the session's project; writes keep `/shaders`.
 */
for (const id of SHADER_EFFECTS_READ_TOOLS) {
	check(`the shader read tool '${id}' is a registered tool`, Object.hasOwn(TOOLS, id), true);
}
check('the shader write tool is /shaders', SHADER_TOOL, 'shaders');
check('the graph read set', SHADER_READ_TOOLS, [
	'shaders',
	'editor',
	'componentEditor',
	'symbols',
	'flow',
]);
check('the effects read set is the graph read set, /fx and the Rigger', SHADER_EFFECTS_READ_TOOLS, [
	...SHADER_READ_TOOLS,
	'fx',
	'rigger',
]);
check(
	'an animator (the Rigger alone) reads the effects, never the graphs, and writes nothing',
	[
		entitledByAny('animator', SHADER_EFFECTS_READ_TOOLS),
		entitledByAny('animator', SHADER_READ_TOOLS),
		entitledByAny('animator', [SHADER_TOOL]),
	],
	[true, false, false],
);
check(
	'a revoked Rigger takes the effects read with it',
	entitledByAny('animator', SHADER_EFFECTS_READ_TOOLS, { rigger: false }),
	false,
);
check(
	'a per-user /fx grant alone opens the effects, not the graphs',
	[
		entitledByAny('animator', SHADER_EFFECTS_READ_TOOLS, { rigger: false }, { fx: true }),
		entitledByAny('animator', SHADER_READ_TOOLS, { rigger: false }, { fx: true }),
	],
	[true, false],
);
check(
	'the tool gate decides through entitledByAny',
	codeOf(readFileSync(`${srcRoot}lib/server/toolScope.ts`, 'utf8')).includes(
		'entitledByAny(locals.user.role, candidates, roleOverrides, overrides)',
	),
	true,
);
{
	const scope = codeOf(readFileSync(`${srcRoot}lib/server/shaderScope.ts`, 'utf8'));
	const gateOf = (name: string): string =>
		new RegExp(`export const ${name} = [^]*?gate\\(locals, cookies, \\{([^}]*)\\}\\)`).exec(
			scope,
		)?.[1] ?? '';
	check(
		"…the alternatives being every tool but /shaders, the gate's own",
		scope.includes(
			'const besidesShaders = (tools: readonly string[]): string[] =>\n\ttools.filter((tool) => tool !== SHADER_TOOL);',
		),
		true,
	);
	check(
		'shaderScope has three gates: graphs, effects and writes',
		(scope.match(/gate\(locals, cookies, \{/g) ?? []).length,
		3,
	);
	check(
		'the graph read gates on SHADER_READ_TOOLS',
		/^\s*tool: SHADER_TOOL,\s*altTools: besidesShaders\(SHADER_READ_TOOLS\),/.test(
			gateOf('shaderReadScope'),
		),
		true,
	);
	check(
		'the effects read gates on SHADER_EFFECTS_READ_TOOLS',
		/^\s*tool: SHADER_TOOL,\s*altTools: besidesShaders\(SHADER_EFFECTS_READ_TOOLS\),/.test(
			gateOf('shaderEffectsReadScope'),
		),
		true,
	);
	check(
		'the write gates on /shaders alone',
		[
			/tool: SHADER_TOOL,/.test(gateOf('shaderWriteScope')),
			/altTools/.test(gateOf('shaderWriteScope')),
		],
		[true, false],
	);
	check(
		'…and the publish scope builds on the write scope',
		/shaderPublishScope[\s\S]*await shaderWriteScope\(locals, cookies\)/.test(scope),
		true,
	);
}
{
	const shaderHandlers = handlers
		.map((f) => f.replaceAll('\\', '/'))
		.filter((f) => f.startsWith('shaders/'));
	check('the scan sees the shader routes', shaderHandlers.length >= 8, true);
	for (const file of shaderHandlers) {
		const route = file.replace(/\/\+server\.ts$/, '');
		const blocks = handlerBlocks(codeOf(readFileSync(`${api}${file}`, 'utf8')));
		check(`api/${route} yields its handlers to the scope scan`, blocks.length > 0, true);
		for (const block of blocks) {
			const method = handlerMethod(block);
			const used = [
				'shaderReadScope',
				'shaderEffectsReadScope',
				'shaderWriteScope',
				'shaderPublishScope',
			].filter((name) => block.includes(`${name}(`));
			const expected =
				method !== 'GET'
					? used.filter((name) => name === 'shaderWriteScope' || name === 'shaderPublishScope')
					: route === 'shaders/effects'
						? ['shaderEffectsReadScope']
						: ['shaderReadScope'];
			check(
				`api/${route} ${method} takes ${method === 'GET' ? expected[0] : 'a write scope'}`,
				[used, used.length === 1],
				[expected, true],
			);
		}
	}
}

console.log();
if (failures) {
	console.error(`${failures} of ${checks} launcher-gate checks FAILED`);
	process.exit(1);
}
console.log(`all ${checks} launcher-gate checks pass`);
