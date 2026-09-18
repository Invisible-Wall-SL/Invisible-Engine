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
 *     `api/` fails this check by name.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	bearerToken,
	launcherGateDenial,
	NO_SESSION_DENIAL,
	OWNER_ROLE,
} from '../src/lib/launcherGates.ts';
import { GAME_PUBLISH_CAPABILITY, ROLES, ROLE_TOOLS, roleHasCapability } from '../src/lib/roles.ts';

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
	'launcher/register-game',
	'launcher/game-upload',
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

/** Owner-only by nature: machine secrets and the owner's own GPU box. */
for (const route of [
	'launcher/tunnel-bundle',
	'launcher/models-manifest',
	'launcher/comfyui-nodes',
]) {
	check(`${route} stays owner-only`, source(route).includes('requireLauncherAdmin'), true);
}

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

console.log();
if (failures) {
	console.error(`${failures} of ${checks} launcher-gate checks FAILED`);
	process.exit(1);
}
console.log(`all ${checks} launcher-gate checks pass`);
