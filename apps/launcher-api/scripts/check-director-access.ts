/**
 * Access contract for Invisible Director + Invisible Pipeline Changes, run over the REAL modules:
 *   pnpm --filter launcher-api check:director-access
 *
 * `docs/director/SPEC.md` §3 fixes the defaults: `director` is Admin only, `pipelineChanges` is
 * Admin plus Pipeline Tester, and `pipelineMerge` is Admin only — seeing the tool must never imply
 * the right to merge. Both override layers (`role_tool_access`, then `user_tool_access`) must move
 * each of the three independently. The page loaders must refuse a manifest without the tool.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	CAPABILITIES,
	PIPELINE_MERGE_CAPABILITY,
	ROLES,
	TOOL_STAGES,
	manifestForRole,
	roleHasCapability,
	roleHasTool,
	toolDocPath,
	type Role,
	type ToolDef,
	type ToolOverrides,
} from '../src/lib/roles.ts';
import { load as directorLoad } from '../src/routes/(app)/director/+page.server.ts';
import { load as pipelineLoad } from '../src/routes/(app)/pipeline/+page.server.ts';

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

function access(role: Role, roleOv: ToolOverrides = {}, userOv: ToolOverrides = {}) {
	return {
		director: roleHasTool(role, 'director', roleOv, userOv),
		pipelineChanges: roleHasTool(role, 'pipelineChanges', roleOv, userOv),
		pipelineMerge: roleHasCapability(role, PIPELINE_MERGE_CAPABILITY, roleOv, userOv),
	};
}

// Admin › Roles rejects a key that is in neither `TOOLS` nor `CAPABILITIES` as an unknown tool.
check(
	'pipelineMerge is a managed capability',
	CAPABILITIES.some((c) => c.key === PIPELINE_MERGE_CAPABILITY),
	true,
);

// ── Defaults (no overrides) ────────────────────────────────────────────────────
for (const role of ROLES) {
	check(`${role}: defaults`, access(role), {
		director: role === 'admin',
		pipelineChanges: role === 'admin' || role === 'pipelineTester',
		pipelineMerge: role === 'admin',
	});
}

// ── Role overrides ─────────────────────────────────────────────────────────────
check(
	'developer: a role grant opens all three',
	access('developer', { director: true, pipelineChanges: true, [PIPELINE_MERGE_CAPABILITY]: true }),
	{ director: true, pipelineChanges: true, pipelineMerge: true },
);
check(
	'pipelineTester: a role revoke closes the default tool',
	access('pipelineTester', { pipelineChanges: false }),
	{ director: false, pipelineChanges: false, pipelineMerge: false },
);
check(
	'admin: a role revoke closes each one, independently',
	access('admin', { director: false, [PIPELINE_MERGE_CAPABILITY]: false }),
	{ director: false, pipelineChanges: true, pipelineMerge: false },
);
check(
	'pipelineTester: the tool grant does not carry merge',
	access('pipelineTester', { pipelineChanges: true }).pipelineMerge,
	false,
);

// ── User overrides win over role overrides ─────────────────────────────────────
check(
	'artist: a user grant opens what the role lacks',
	access('artist', {}, { director: true, [PIPELINE_MERGE_CAPABILITY]: true }),
	{ director: true, pipelineChanges: false, pipelineMerge: true },
);
check(
	'developer: a user revoke beats a role grant',
	access(
		'developer',
		{ director: true, pipelineChanges: true, [PIPELINE_MERGE_CAPABILITY]: true },
		{ director: false, pipelineChanges: false, [PIPELINE_MERGE_CAPABILITY]: false },
	),
	{ director: false, pipelineChanges: false, pipelineMerge: false },
);
check(
	'pipelineTester: a user grant beats a role revoke',
	access('pipelineTester', { pipelineChanges: false }, { pipelineChanges: true }),
	{ director: false, pipelineChanges: true, pipelineMerge: false },
);

// ── Placement + docs ───────────────────────────────────────────────────────────
const stage = (id: string) => TOOL_STAGES.find((s) => s.id === id);
check('create stage order', stage('create')?.tools, ['gameMaker', 'gameConfig', 'director']);
check('pipeline stage', stage('pipeline'), {
	id: 'pipeline',
	label: 'Pipeline',
	accent: '#f778ba',
	tools: ['pipelineChanges'],
});
check('director doc path', toolDocPath('director'), 'docs/director');
check('pipelineChanges doc path', toolDocPath('pipelineChanges'), 'docs/pipeline-changes');
for (const id of ['director', 'pipelineChanges']) {
	const slug = toolDocPath(id).replace(/^docs\//, '');
	const md = fileURLToPath(new URL(`../../../docs/tools/${slug}.md`, import.meta.url));
	check(`${id}: docs/tools/${slug}.md exists`, existsSync(md), true);
}

// ── Page loaders: 403 without the tool, through with it ────────────────────────
type Load = (event: unknown) => Promise<unknown>;
/** The event a page loader gets: the layout's manifest and capability, and the page's URL. */
const event = (tools: ToolDef[], canPipelineMerge = false, search = '') => ({
	locals: { user: { id: 'u', role: 'developer' } },
	parent: async () => ({ tools, canPipelineMerge }),
	url: new URL(`https://app.example/pipeline${search}`),
});
async function loadStatus(load: Load, tools: ToolDef[]): Promise<number> {
	try {
		await load(event(tools));
		return 200;
	} catch (e) {
		return (e as { status?: number }).status ?? -1;
	}
}
const pages: [string, Load, string][] = [
	['/director', directorLoad as Load, 'director'],
	['/pipeline', pipelineLoad as Load, 'pipelineChanges'],
];
for (const [path, load, id] of pages) {
	check(`${path}: artist manifest → 403`, await loadStatus(load, manifestForRole('artist')), 403);
	check(`${path}: admin manifest → 200`, await loadStatus(load, manifestForRole('admin')), 200);
	check(
		`${path}: a user grant on an artist → 200`,
		await loadStatus(load, manifestForRole('artist', {}, { [id]: true })),
		200,
	);
}
check(
	'/pipeline: pipelineTester manifest → 200',
	await loadStatus(pipelineLoad as Load, manifestForRole('pipelineTester')),
	200,
);
check(
	'/director: pipelineTester manifest → 403',
	await loadStatus(directorLoad as Load, manifestForRole('pipelineTester')),
	403,
);

// ── /pipeline hands the page what the Changes tab needs ────────────────────────
const pipelineData = (canPipelineMerge: boolean, search: string) =>
	pipelineLoad(event(manifestForRole('admin'), canPipelineMerge, search) as never);
check(
	"/pipeline: canMerge is the layout's pipelineMerge, never recomputed from the role",
	[(await pipelineData(true, '')).canMerge, (await pipelineData(false, '')).canMerge],
	[true, false],
);
check(
	'/pipeline: ?change=<n> selects a change; anything else selects none',
	[
		(await pipelineData(true, '?change=1070')).selected,
		(await pipelineData(true, '?change=0')).selected,
		(await pipelineData(true, '?change=abc')).selected,
		(await pipelineData(true, '')).selected,
	],
	[1070, null, null, null],
);

if (failures) {
	console.error(`\n${failures} of ${checks} director-access checks failed.`);
	process.exit(1);
}
console.log(`All ${checks} director-access checks pass.`);
