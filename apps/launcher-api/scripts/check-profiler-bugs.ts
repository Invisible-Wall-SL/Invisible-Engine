/**
 * P5 File as bug, run by `pnpm --filter launcher-api check:profiler` (imported by
 * `check-profiler.ts`):
 *
 * 17. A finding's list and area: every rule and variant against the real `owners.json` — a game
 *     bug for the game's own content, a pipeline bug for the engine or a tool, the tool the owning
 *     agent owns — each area one Bug Reports knows, and a planted mutant the table must catch. The
 *     form's text (rule, measurement, saving, evidence links, the finding's id) and its prefill.
 * 18. Once per finding: two filings at once link one bug and refuse the other, each filing keeps
 *     its evidence (and files nothing when a cited row was purged meanwhile), a finding whose bug
 *     is deleted files again — over an in-memory store with the table's key — and the real schema
 *     carries that key and the delete cascade. The purge's real claim SQL never takes a cited
 *     reading or build, and un-Keep reads the bug that cites a row.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { SQL } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { isBugArea, MAX_DESCRIPTION, MAX_TITLE } from '../src/lib/bugReports.ts';
import {
	fileFindingHref,
	findingBugDescription,
	findingBugTarget,
	findingBugTitle,
	type FindingBugTarget,
} from '../src/lib/profilerFindings/bug.ts';
import {
	agent,
	areaOwner,
	BUILD_CHANGES,
	FINDING_RULES,
	kindOwner,
	PROJECT_AUTHOR,
	PUBLISHER,
	toolOwner,
	type Finding,
	type FindingOwner,
	type FindingRule,
	type OwnerMap,
} from '../src/lib/profilerFindings/finding.ts';
import { perfFindingBugs } from '../src/lib/server/db/schema.ts';
import {
	AlreadyFiled,
	citingQuery,
	EvidenceGone,
	evidenceIds,
	linkFinding,
	type FindingLink,
	type FindingLinkStore,
} from '../src/lib/server/profiler/findingBugLink.ts';
import { withFindingDraft } from '../src/routes/(app)/bugs/view.ts';

const ARCADE_RULES = ['simCatchUp', 'spawnChurn', 'bodyCost', 'patchStutter'] as const;
/** How the game is delivered: the server's caching and compression, its boot, its API traffic. */
const DELIVERY_RULES = ['uncompressedText', 'notCached', 'firstFrame', 'netTraffic'] as const;

const OWNERS: OwnerMap = JSON.parse(
	readFileSync(new URL('../../../docs/knowledge/owners.json', import.meta.url), 'utf8'),
);

const finding = (rule: FindingRule, id: string, owner: FindingOwner): Finding => ({
	id,
	rule,
	severity: 'medium',
	title: `v12 spinning 41 fps on phone · Mali-G52 MC2 (slots)`,
	detail: ['median of 3 readings', 'p95 31 ms'],
	evidence: [
		{ type: 'reading', id: 'r-shipped', label: 'v12 · phone · Mali-G52 MC2' },
		{ type: 'reading', id: 'r-switch', label: 'v12 · phone · particles=off' },
		{ type: 'build', id: 'b-12', label: 'v12 · slots (publish)' },
	],
	estimate: { value: 9, unit: 'fps', basis: 'fps short of the warn line' },
	owner,
	deviceClass: 'phone',
	gameKey: 'slots',
});

/** Every rule, and each variant whose list differs, with the list and area it is filed in. */
const CASES: [string, Finding, FindingBugTarget][] = [
	[
		'fps below budget → the engine',
		finding('fpsBelowBudget', 'fpsBelowBudget:slots:12:g:fps:spinning', kindOwner(OWNERS, 'lines')),
		{ kind: 'pipeline', area: 'engine' },
	],
	[
		'GPU- or CPU-bound → the engine',
		finding('gpuCpuBound', 'gpuCpuBound:k:12:spinning', agent('engine-pixi-svelte')),
		{ kind: 'pipeline', area: 'engine' },
	],
	[
		'particles cost → the game’s art',
		finding('featureCost', 'featureCost:r-switch', toolOwner(OWNERS, 'fx', 'invisible-fx')),
		{ kind: 'game', area: 'art' },
	],
	[
		'Element FX cost → the game’s art',
		finding(
			'featureCost',
			'featureCost:r-fx',
			toolOwner(OWNERS, 'shaders', 'invisible-shader-graph'),
		),
		{ kind: 'game', area: 'art' },
	],
	[
		'antialiasing cost → the engine',
		finding('featureCost', 'featureCost:r-aa', agent('engine-pixi-svelte')),
		{ kind: 'pipeline', area: 'engine' },
	],
	[
		'particle spikes → Invisible FX',
		finding('spikes', 'spikes:k:12:particles', toolOwner(OWNERS, 'fx', 'invisible-fx')),
		{ kind: 'pipeline', area: 'fx' },
	],
	[
		'rig spikes → Invisible Rigger',
		finding('spikes', 'spikes:k:12:rigs', toolOwner(OWNERS, 'rigger', 'invisible-rigger')),
		{ kind: 'pipeline', area: 'rigger' },
	],
	[
		'game-code spikes → the engine (the kind’s agent)',
		finding('spikes', 'spikes:k:12:game code', kindOwner(OWNERS, 'holdAndWin')),
		{ kind: 'pipeline', area: 'engine' },
	],
	[
		'shader-compile spikes → the engine',
		finding('spikes', 'spikes:k:12:shader compile', agent('engine-pixi-svelte')),
		{ kind: 'pipeline', area: 'engine' },
	],
	[
		'texture MB past the line → the game’s art',
		finding('textures', 'textures:gpu:k:12', toolOwner(OWNERS, 'atlasTool', 'atlas-python-tools')),
		{ kind: 'game', area: 'art' },
	],
	[
		'oversize pages → the game’s art',
		finding(
			'textures',
			'textures:oversize:b-12',
			toolOwner(OWNERS, 'atlasTool', 'atlas-python-tools'),
		),
		{ kind: 'game', area: 'art' },
	],
	[
		'KTX2 fallback → Invisible Atlas Maker',
		finding('textures', 'textures:ktx2:k:12', toolOwner(OWNERS, 'atlasTool', 'atlas-python-tools')),
		{ kind: 'pipeline', area: 'atlasTool' },
	],
	[
		'unused bytes → the game’s loading',
		finding('unusedBytes', 'unusedBytes:never:b-12', PROJECT_AUTHOR),
		{ kind: 'game', area: 'loading' },
	],
	[
		'Optimize off → the game’s loading',
		finding('optimizeOff', 'optimizeOff:b-12', PUBLISHER),
		{ kind: 'game', area: 'loading' },
	],
	[
		'a build that grew → the game’s loading',
		finding('regression', 'regression:shipped:b-12', BUILD_CHANGES),
		{ kind: 'game', area: 'loading' },
	],
	[
		'fps that dropped → the engine',
		finding('regression', 'regression:fps:slots:11>12:phone:spinning', BUILD_CHANGES),
		{ kind: 'pipeline', area: 'engine' },
	],
	[
		'lab counts that moved → the engine',
		finding('regression', 'regression:counts:slots:11>12', BUILD_CHANGES),
		{ kind: 'pipeline', area: 'engine' },
	],
	[
		'arcade sim spikes → the engine (the arcade kind’s agent)',
		finding('spikes', 'spikes:k:3:sim catch-up', kindOwner(OWNERS, 'arcade')),
		{ kind: 'pipeline', area: 'engine' },
	],
	...ARCADE_RULES.map((rule): [string, Finding, FindingBugTarget] => [
		`${rule} → the engine (the arcade runtime, its kind’s agent)`,
		finding(rule, `${rule}:k:3`, kindOwner(OWNERS, 'arcade')),
		{ kind: 'pipeline', area: 'engine' },
	]),
	[
		'a heavy art file → the game’s loading',
		finding('heavyTransfer', 'heavyTransfer:files:k|phone:12', areaOwner(OWNERS, 'assets', 'x')),
		{ kind: 'game', area: 'loading' },
	],
	[
		'the runtime’s own heavy code → the engine',
		finding('heavyTransfer', 'heavyTransfer:files:k|phone:13', agent('engine-pixi-svelte')),
		{ kind: 'pipeline', area: 'engine' },
	],
	[
		'uncompressed text → the engine (delivery: the infra agent owns no tool)',
		finding('uncompressedText', 'uncompressedText:k:12', areaOwner(OWNERS, 'delivery', 'x')),
		{ kind: 'pipeline', area: 'engine' },
	],
	[
		'downloaded again → the engine (delivery)',
		finding('notCached', 'notCached:loads:k:12', areaOwner(OWNERS, 'delivery', 'x')),
		{ kind: 'pipeline', area: 'engine' },
	],
	[
		'before the first frame → the engine',
		finding('firstFrame', 'firstFrame:k|phone:12', agent('engine-pixi-svelte')),
		{ kind: 'pipeline', area: 'engine' },
	],
	[
		'room traffic → the engine (the game server, the arcade kind’s agent)',
		finding('netTraffic', 'netTraffic:socket:k:12', areaOwner(OWNERS, 'gameServer', 'x')),
		{ kind: 'pipeline', area: 'engine' },
	],
];

type Target = (f: Finding, o: OwnerMap) => FindingBugTarget;

test('17. the arcade rules are owned by the arcade kind’s agent, which owns a tool too', () => {
	assert.equal(kindOwner(OWNERS, 'arcade').id, 'arcade-games', 'owners.json kinds.arcade');
	assert.ok(
		Object.values(OWNERS.tools).some((agents) => agents[0] === 'arcade-games'),
		'arcade-games also owns a tool first (characters): the area must not follow it',
	);
});

function checkTable(target: Target): void {
	for (const [name, f, want] of CASES) assert.deepEqual(target(f, OWNERS), want, name);
}

test('17. every rule and variant is filed in its list, against an area Bug Reports knows', () => {
	checkTable(findingBugTarget);
	assert.deepEqual(
		[...new Set(CASES.map(([, f]) => f.rule))].sort(),
		[...FINDING_RULES].sort(),
		'every rule has a case',
	);
	for (const [name, f] of CASES) {
		const t = findingBugTarget(f, OWNERS);
		assert.ok(isBugArea(t.kind, t.area), `${name}: ${t.area} is a ${t.kind} area`);
	}
	// Mutants: the owning agent's first tool taken as-is (the engine's agent owns Storybook), and
	// every texture finding called the game's art (a KTX2 fallback is the loader's).
	const firstTool: Target = (f, o) => {
		const t = findingBugTarget(f, o);
		const tool = Object.entries(o.tools).find(([, a]) => a[0] === f.owner.id);
		return t.kind === 'pipeline' && tool ? { kind: 'pipeline', area: tool[0] } : t;
	};
	const allArt: Target = (f, o) =>
		f.rule === 'textures' ? { kind: 'game', area: 'art' } : findingBugTarget(f, o);
	// …and the arcade runtime's findings filed as the game's own content.
	const arcadeAsGame: Target = (f, o) =>
		(ARCADE_RULES as readonly FindingRule[]).includes(f.rule)
			? { kind: 'game', area: 'art' }
			: findingBugTarget(f, o);
	// …and the delivery findings (the server's caching and compression) filed as the game's loading.
	const deliveryAsGame: Target = (f, o) =>
		(DELIVERY_RULES as readonly FindingRule[]).includes(f.rule)
			? { kind: 'game', area: 'loading' }
			: findingBugTarget(f, o);
	for (const [name, mutant] of [
		['first tool', firstTool],
		['all art', allArt],
		['arcade as game', arcadeAsGame],
		['delivery as game', deliveryAsGame],
	] as const) {
		assert.throws(() => checkTable(mutant), assert.AssertionError, `${name}: must be caught`);
	}
});

test('17. the bug says what was measured, what it saves, and links back to its evidence', () => {
	const f = CASES[2][1];
	const target = findingBugTarget(f, OWNERS);
	const text = findingBugDescription(f, 'acme-slots', 'https://app.example', target);
	const base = 'https://app.example/profiler?project=acme-slots';
	for (const want of [
		'Rule: Feature cost · severity medium · phone',
		`Measured: ${f.title}`,
		'- p95 31 ms',
		'Estimated saving: 9 fps (fps short of the warn line)',
		`${base}&tab=compare&a=r-shipped&b=r-switch`,
		`${base}&tab=compare&a=r-switch&b=r-shipped`,
		'https://app.example/api/profiler/reports/r-shipped',
		`${base}&tab=builds&build=b-12`,
		'https://app.example/api/profiler/builds/b-12',
		`${base}&tab=findings`,
		`Finding id: ${f.id}`,
	]) {
		assert.ok(text.includes(want), `the text carries ${want}`);
	}
	assert.equal(
		findingBugDescription({ ...f, estimate: null }, 'acme-slots', 'https://app.example', target)
			.split('\n')
			.find((l) => l.startsWith('Estimated saving')),
		'Estimated saving: unmeasured',
	);
	assert.equal(findingBugTitle(f), `Profiler: ${f.title}`);
	assert.ok(findingBugTitle({ title: 'x'.repeat(400) }).length <= MAX_TITLE);
	const long = { ...f, detail: Array.from({ length: 2000 }, () => 'y'.repeat(20)) };
	assert.ok(
		findingBugDescription(long, 'acme-slots', 'https://app.example', target).length <=
			MAX_DESCRIPTION,
	);
	assert.equal(
		fileFindingHref(f, 'acme slots', 'game'),
		`/game-bugs?new=1&project=acme%20slots&finding=${encodeURIComponent(f.id)}`,
	);
	assert.ok(fileFindingHref(f, 'p', 'pipeline').startsWith('/bugs?new=1&project=p&finding='));
});

test('17. the form opens on the draft, or says why this finding cannot be filed here', () => {
	const asked = { area: '', pageUrl: '', title: '', description: '' };
	const draft = {
		finding: { id: 'optimizeOff:b-12', project: 'p' },
		kind: 'game' as const,
		area: 'loading',
		title: 'Profiler: Optimize off',
		description: 'text',
		pageUrl: 'https://app.example/profiler?project=p&tab=findings',
	};
	assert.deepEqual(withFindingDraft(asked, draft, 'game'), {
		area: 'loading',
		pageUrl: draft.pageUrl,
		title: draft.title,
		description: 'text',
		project: 'p',
		finding: draft.finding,
	});
	const elsewhere = withFindingDraft(asked, draft, 'pipeline');
	assert.equal(elsewhere?.finding, undefined, 'never filed from the other list');
	assert.match(elsewhere?.findingRefused?.message ?? '', /Game Bug Reports/);
	assert.deepEqual(
		withFindingDraft(asked, { refused: 'already filed as BUG-7.', filed: 7 }, 'game')
			?.findingRefused,
		{ message: 'already filed as BUG-7.', filed: 7 },
	);
	assert.equal(withFindingDraft(null, draft, 'game'), null, 'no form asked, none opened');
});

/** `perf_finding_bugs` in memory: the primary key (project, finding), deleted with its bug. */
function memoryStore(keyed = true) {
	const rows = new Map<string, FindingLink>();
	const kept: string[] = [];
	/** Rows the purge claimed since the finding was read. */
	const gone = new Set<string>();
	let n = 0;
	const store: FindingLinkStore = {
		async link(row) {
			await new Promise((r) => setTimeout(r, 1));
			const key = keyed ? `${row.projectKey}\0${row.findingId}` : `${n++}`;
			if (rows.has(key)) return false;
			rows.set(key, row);
			return true;
		},
		async keep(projectKey, type, ids) {
			const here = ids.filter((id) => !gone.has(id));
			kept.push(...here.map((id) => `${projectKey}/${type}/${id}`));
			return here.length;
		},
	};
	const deleteBug = (bugNumber: number) => {
		for (const [k, r] of rows) if (r.bugNumber === bugNumber) rows.delete(k);
	};
	return { store, rows, kept, gone, deleteBug };
}

const fileBoth = async (store: FindingLinkStore) => {
	const f = CASES[0][1];
	const row = (bugNumber: number): FindingLink => ({
		projectKey: 'p',
		findingId: f.id,
		bugNumber,
		...evidenceIds(f),
	});
	return Promise.allSettled([linkFinding(store, row(41)), linkFinding(store, row(42))]);
};

function checkOnce(results: PromiseSettledResult<void>[]): void {
	assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'one filing links');
	const refused = results.find((r) => r.status === 'rejected');
	assert.ok(refused && refused.reason instanceof AlreadyFiled, 'the other is refused');
}

test('18. two filings of one finding at once: one bug is linked, the other refused', async () => {
	const mem = memoryStore();
	checkOnce(await fileBoth(mem.store));
	assert.equal(mem.rows.size, 1);
	assert.deepEqual(mem.kept.sort(), ['p/build/b-12', 'p/reading/r-shipped', 'p/reading/r-switch']);
	const mutant = memoryStore(false);
	await assert.rejects(async () => checkOnce(await fileBoth(mutant.store)), assert.AssertionError);
});

test('18. the same finding on another project, or after its bug is deleted, files again', async () => {
	const mem = memoryStore();
	const f = CASES[0][1];
	const row = (projectKey: string, bugNumber: number): FindingLink => ({
		projectKey,
		findingId: f.id,
		bugNumber,
		...evidenceIds(f),
	});
	await linkFinding(mem.store, row('p', 1));
	await linkFinding(mem.store, row('q', 2));
	await assert.rejects(linkFinding(mem.store, row('p', 3)), AlreadyFiled);
	mem.deleteBug(1);
	await linkFinding(mem.store, row('p', 4));
	assert.deepEqual([...mem.rows.values()].map((r) => r.bugNumber).sort(), [2, 4]);
});

test('18. the table is keyed on (project, finding) and goes with its bug', () => {
	const config = getTableConfig(perfFindingBugs);
	assert.deepEqual(
		config.primaryKeys.map((pk) => pk.columns.map((c) => c.name)),
		[['project_key', 'finding_id']],
	);
	const toBug = config.foreignKeys.find(
		(fk) => getTableConfig(fk.reference().foreignTable).name === 'bug_reports',
	);
	assert.equal(toBug?.onDelete, 'cascade', 'a deleted bug frees its finding');
	const migration = readFileSync(
		new URL('../drizzle/0047_perf_finding_bugs.sql', import.meta.url),
		'utf8',
	);
	assert.match(migration, /PRIMARY KEY\("project_key","finding_id"\)/);
	assert.match(migration, /REFERENCES "public"\."bug_reports"\("number"\) ON DELETE cascade/);
});

test('18. a cited row the purge claimed since the finding was read files nothing', async () => {
	const mem = memoryStore();
	const f = CASES[0][1];
	mem.gone.add('r-switch');
	await assert.rejects(
		linkFinding(mem.store, { projectKey: 'p', findingId: f.id, bugNumber: 1, ...evidenceIds(f) }),
		EvidenceGone,
	);
});

test('18. the purge never claims a cited reading or build; un-Keep finds the citing bug', async () => {
	// Rendered only: `getDb()` connects on a query, never on building one.
	process.env.DATABASE_URL ??= 'postgres://check@127.0.0.1:1/none';
	const { claimableBuild, claimableReport } =
		await import('../src/lib/server/profiler/purgeJob.ts');
	const render = (cond: { getSQL(): SQL }) => new PgDialect().sqlToQuery(cond.getSQL()).sql;
	const unkept = (sql: string, table: string, list: string) => {
		const guard =
			`not exists (select 1 from "perf_finding_bugs" where ("perf_finding_bugs"."project_key" = ` +
			`"${table}"."project_key" and "${table}"."id" = any("perf_finding_bugs"."${list}")))`;
		assert.ok(sql.includes(guard), `${table}: the claim skips a cited row`);
		// Only the unkept branch is guarded: a row the purge already claimed is finished.
		assert.ok(
			sql.indexOf(guard) > sql.indexOf('"keep" = $1'),
			`${table}: inside the unkept branch`,
		);
	};
	unkept(render(claimableReport(new Date())), 'perf_reports', 'reading_ids');
	unkept(render(claimableBuild(new Date())), 'perf_builds', 'build_ids');
	// The mutant: a claim without the guard must fail the check.
	assert.throws(
		() =>
			unkept(
				render(claimableReport(new Date())).replace(/ and not exists \(.*?\)\)\)/, ''),
				'perf_reports',
				'reading_ids',
			),
		assert.AssertionError,
	);
	for (const [type, list] of [
		['reading', 'reading_ids'],
		['build', 'build_ids'],
	] as const) {
		const q = citingQuery('p', type, 'r1').toSQL();
		assert.ok(q.sql.includes(`= any("perf_finding_bugs"."${list}")`), `un-Keep of a ${type}`);
		assert.deepEqual(q.params.slice(0, 2), ['p', 'r1']);
	}
});
