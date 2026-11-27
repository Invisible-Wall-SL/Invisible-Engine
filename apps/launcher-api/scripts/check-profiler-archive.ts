/**
 * Archive, delete, duplicates and filed findings, run by `pnpm --filter launcher-api check:profiler`
 * (imported by `check-profiler.ts`):
 *
 * 22. Duplicates: the probe names its measuring window (`sendKey`); of the sends of one window only
 *     the fullest is listed, an exact copy is one reading, and two real measurements — another
 *     window, another load, another device — are never folded. Stored sends are decided in SQL, so
 *     the conditions are rendered and held to the rule.
 * 23. Archive and delete: archived rows leave every list unless asked for; the purge holds an
 *     archived row 90 days from its archiving; a Delete is the purge's own path, and its SQL claims
 *     nothing an open bug cites and nothing kept (but a kept row a closed bug cites).
 * 24. Findings: one row per subject (the finding without its build, merged across the readings
 *     behind it); a bug follows its finding to the next build, leaves the list while open or being
 *     fixed, and comes back "regressed" when it was closed as fixed and a later reading shows it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
	ARCHIVE_RETENTION_MS,
	PERF_RETENTION_MS,
	retentionEnd,
	summarizePerfReport,
	type PerfPhaseSummary,
	type PerfReportListItem,
} from '../src/lib/profiler.ts';
import { repeatedReadings, withoutRepeats } from '../src/lib/profilerDedupe.ts';
import { effectiveBudgets } from '../src/lib/profilerBudgets.ts';
import {
	findings,
	mergeBySubject,
	RULES,
	type Finding,
	type FindingContext,
} from '../src/lib/profilerFindings/index.ts';
import {
	activeBugFor,
	filedViews,
	type FindingLinkRow,
} from '../src/lib/profilerFindings/filed.ts';
import { removeClaimed } from '../src/lib/server/profiler/purge.ts';
import {
	earlierSendsOf,
	fullerSendOf,
	listedBuilds,
	listedReports,
} from '../src/lib/server/profiler/rowFilters.ts';

const DAY = 24 * 60 * 60 * 1000;
const at = (h: number, day = 17) => new Date(Date.UTC(2026, 10, day, h)).toISOString();
const phase = (frames: number, fps: number, p95 = 19): PerfPhaseSummary => ({
	frames,
	fps,
	p50: 1000 / fps,
	p95,
	hitches: 0,
});

const reading = (id: string, over: Partial<PerfReportListItem> = {}): PerfReportListItem => ({
	id,
	capturedAt: at(10),
	source: 'capture',
	label: null,
	gameKey: 'slots',
	deviceClass: 'phone',
	gpu: 'Mali-G52 MC2',
	uaFamily: 'Chrome 131 · Android',
	dpr: 2,
	canvas: null,
	buildVersion: '12',
	buildSha: 'abcdef1',
	runtimeRelease: null,
	flags: {},
	kind: null,
	phaseSet: 'slot',
	idle: phase(600, 59.8),
	spinning: phase(300, 57),
	round: phase(900, 58),
	loading: null,
	lobby: null,
	menu: null,
	play: null,
	spectate: null,
	capped30: false,
	drawsMean: 80,
	textureMb: 90,
	counts: null,
	network: null,
	sendKey: null,
	perfVersion: 10,
	keep: false,
	archivedAt: null,
	expiresAt: null,
	...over,
});

/** A window sent at three moments: each a superset of the last, as the probe's are. */
const window3 = (key: string, over: Partial<PerfReportListItem> = {}) => [
	reading(`${key}-tap`, {
		sendKey: key,
		capturedAt: at(10),
		spinning: phase(300, 57),
		...over,
	}),
	reading(`${key}-hide`, {
		sendKey: key,
		capturedAt: at(11),
		spinning: phase(900, 56),
		...over,
	}),
	reading(`${key}-back`, {
		sendKey: key,
		capturedAt: at(12),
		spinning: phase(1500, 55),
		...over,
	}),
];

const sqlOf = (cond: SQL | undefined) => {
	assert.ok(cond, 'a condition');
	return new PgDialect().sqlToQuery(cond.getSQL());
};

// ── 22. Duplicates ──

test('22. the probe’s report names its window; a key that is not the probe’s is none', () => {
	const base = {
		perf: 10,
		kind: 'slot',
		idle: { frames: 600, fps: 59, p50: 17, p95: 19, over33: 0 },
		spinning: { frames: 300, fps: 57, p50: 17, p95: 20, over33: 0 },
		round: { frames: 0, fps: 0, p50: 0, p95: 0, over33: 0 },
	};
	const read = (sendKey: unknown) => {
		const r = summarizePerfReport({ ...base, sendKey });
		assert.ok(r.ok);
		return r.summary;
	};
	const named = read('1795000000123.2');
	assert.equal(named.sendKey, '1795000000123.2');
	assert.equal(named.sendFrames, 900, 'frames over every phase');
	for (const bad of [undefined, 7, '', 'abc', '12.x', '12.3.4', `${'9'.repeat(17)}.1`]) {
		assert.equal(read(bad).sendKey, null, `${String(bad)} is no key`);
	}
});

test('22. of the sends of one window only the fullest is listed', () => {
	const sends = window3('w1');
	assert.deepEqual([...repeatedReadings(sends)].sort(), ['w1-hide', 'w1-tap']);
	assert.deepEqual(
		withoutRepeats(sends).map((r) => r.id),
		['w1-back'],
	);
	// A late short send (the hide's short form landing after the fuller one) is still the repeat.
	const late = [
		...sends,
		reading('w1-late', { sendKey: 'w1', capturedAt: at(13), spinning: phase(40, 50) }),
	];
	assert.deepEqual(
		withoutRepeats(late).map((r) => r.id),
		['w1-back'],
	);
	// Of two as full, the earlier receipt stays, so a resend is the one hidden.
	const resend = [
		reading('first', { sendKey: 'w2', capturedAt: at(10) }),
		reading('again', { sendKey: 'w2', capturedAt: at(11) }),
	];
	assert.deepEqual(
		withoutRepeats(resend).map((r) => r.id),
		['first'],
	);
});

test('22. a Reset, another load, another device and another game are other readings', () => {
	const all = [
		...window3('100.0'),
		...window3('100.1'),
		...window3('200.0'),
		...window3('100.0', { gameKey: 'other' }).map((r) => ({ ...r, id: `${r.id}-g` })),
	];
	assert.deepEqual(
		withoutRepeats(all)
			.map((r) => r.id)
			.sort(),
		['100.0-back', '100.0-back-g', '100.1-back', '200.0-back'],
	);
});

test('22. a kept reading is never folded away', () => {
	const sends = window3('w3').map((r) => (r.id === 'w3-tap' ? { ...r, keep: true } : r));
	assert.deepEqual(
		withoutRepeats(sends)
			.map((r) => r.id)
			.sort(),
		['w3-back', 'w3-tap'],
	);
});

test('22. readings stored before windows had a name: only an exact copy is one reading', () => {
	const a = reading('a');
	const copy = reading('copy', { capturedAt: at(11) });
	const other = reading('other', { spinning: phase(300, 56.9) });
	const differentDevice = reading('phone2', { gpu: 'Adreno 740' });
	const throttled = reading('flagged', { flags: { particles: 'off' } });
	assert.deepEqual(
		withoutRepeats([a, copy, other, differentDevice, throttled])
			.map((r) => r.id)
			.sort(),
		['a', 'flagged', 'other', 'phone2'],
		'the later copy goes; a reading differing in any number, device or switch stays',
	);
});

test('22. the fixture fails its mutants: keeping the earliest send, or folding by device', () => {
	const sends = window3('m');
	const fullestStays = (hide: (readings: PerfReportListItem[]) => Set<string>) =>
		assert.deepEqual([...hide(sends)].sort(), ['m-hide', 'm-tap']);
	fullestStays(repeatedReadings);
	const keepsEarliest = (rs: PerfReportListItem[]) =>
		new Set(rs.filter((r) => r.id !== 'm-tap').map((r) => r.id));
	assert.throws(() => fullestStays(keepsEarliest), assert.AssertionError);
	const byDevice = (rs: PerfReportListItem[]) => {
		const first = new Map<string, string>();
		for (const r of rs)
			first.set(`${r.deviceClass}|${r.gpu}`, first.get(`${r.deviceClass}|${r.gpu}`) ?? r.id);
		return new Set(rs.filter((r) => ![...first.values()].includes(r.id)).map((r) => r.id));
	};
	const windows = [...sends, ...window3('n')];
	assert.deepEqual(
		withoutRepeats(windows)
			.map((r) => r.id)
			.sort(),
		['m-back', 'n-back'],
		'two windows of one device are two readings',
	);
	assert.notDeepEqual([...byDevice(windows)].sort(), [...repeatedReadings(windows)].sort());
});

test('22. a stored send is decided by its window, session and frames; earlier sends by the id kept', () => {
	process.env.DATABASE_URL ??= 'postgres://check@127.0.0.1:1/none';
	const full = sqlOf(fullerSendOf('p', '10.1', 'sess', 900));
	assert.ok(full.sql.includes('"project_key" = $1') && full.sql.includes('"send_key" = $2'));
	assert.ok(full.sql.includes('"session" = $3'), 'a session reading matches its own session');
	assert.ok(full.sql.includes('"send_frames" >= $4'), 'no fuller than one stored');
	assert.ok(full.sql.includes('"purging_at" is null'), 'a claimed one is not an answer');
	assert.deepEqual(full.params, ['p', '10.1', 'sess', 900]);
	assert.ok(sqlOf(fullerSendOf('p', '10.1', null, 900)).sql.includes('"session" is null'));
	const earlier = sqlOf(earlierSendsOf('p', '10.1', 'sess', 'new-id', 900));
	assert.ok(earlier.sql.includes('"id" <> $4'), 'never the reading just stored');
	assert.ok(earlier.sql.includes('"send_frames" < $5'), 'only the shorter ones: never the fuller');
});

// ── 23. Archive and delete ──

test('23. the lists leave archived rows out unless asked for, and the purge’s claims out always', () => {
	const live = sqlOf(listedReports('p', false)).sql;
	assert.ok(live.includes('"archived_at" is null') && live.includes('"purging_at" is null'));
	const all = sqlOf(listedReports('p', true)).sql;
	assert.ok(!all.includes('archived_at'), 'Show archived lists them');
	assert.ok(all.includes('"purging_at" is null'));
	assert.ok(sqlOf(listedBuilds('p', false)).sql.includes('"archived_at" is null'));
	assert.ok(!sqlOf(listedBuilds('p', true)).sql.includes('archived_at'));
});

test('23. an archived row is held 90 days from its archiving, an unarchived one 15 from capture', () => {
	const at0 = new Date('2026-11-01T00:00:00Z');
	const archivedAt = new Date('2026-11-20T00:00:00Z');
	assert.equal(
		+retentionEnd({ keep: false, at: at0, archivedAt: null })! - +at0,
		PERF_RETENTION_MS,
	);
	assert.equal(
		+retentionEnd({ keep: false, at: at0, archivedAt })! - +archivedAt,
		ARCHIVE_RETENTION_MS,
		'measured from the archiving, not the capture',
	);
	assert.equal(ARCHIVE_RETENTION_MS, 90 * DAY);
	assert.equal(retentionEnd({ keep: true, at: at0, archivedAt }), null, 'kept: never');
});

test('23. the purge claims an archived row by its archiving, and still never a cited or kept one', async () => {
	process.env.DATABASE_URL ??= 'postgres://check@127.0.0.1:1/none';
	const { claimableBuild, claimableReport } =
		await import('../src/lib/server/profiler/purgeJob.ts');
	const cutoff = new Date('2026-11-12T00:00:00Z');
	for (const [name, cond, at] of [
		['reading', claimableReport(cutoff), 'captured_at'],
		['build', claimableBuild(cutoff), 'registered_at'],
	] as const) {
		const q = sqlOf(cond);
		assert.ok(
			q.sql.includes(`"archived_at" is null and "${at}" < `) ||
				q.sql.includes(`"archived_at" is null and "perf_`),
			`${name}: a live row by its age`,
		);
		assert.ok(
			q.sql.includes('"archived_at" is not null and'),
			`${name}: an archived one by its archiving`,
		);
		const stamps = q.params
			.filter((p): p is string => typeof p === 'string' && /^\d{4}-\d\d-\d\dT/.test(p))
			.map((p) => +new Date(p));
		assert.ok(stamps.includes(+cutoff), `${name}: a live row by the 15-day cutoff`);
		assert.ok(
			stamps.includes(+cutoff - (ARCHIVE_RETENTION_MS - PERF_RETENTION_MS)),
			`${name}: an archived one by the cutoff 90 days back`,
		);
		if (name === 'build') {
			assert.ok(
				q.sql.includes('"newer_build"."archived_at" is null'),
				'a build is the newest of its line among the live ones, as the page lists them',
			);
			assert.equal(
				q.sql.split('"newer_build"').length > 1 &&
					q.sql.indexOf('"archived_at" is not null and') > -1,
				true,
			);
		}
		assert.ok(q.sql.includes('"keep" = $1'), `${name}: only unkept`);
		assert.ok(q.sql.includes('not exists (select 1 from "perf_finding_bugs"'), `${name}: uncited`);
	}
});

test('23. a Delete claims nothing an open bug cites, nothing kept — bar a kept row a closed bug cites', async () => {
	process.env.DATABASE_URL ??= 'postgres://check@127.0.0.1:1/none';
	const { deletableBuild, deletableReport, supersededReport } =
		await import('../src/lib/server/profiler/purgeJob.ts');
	for (const [name, cond, list] of [
		['reading', deletableReport('p', ['a', 'b']), 'reading_ids'],
		['build', deletableBuild('p', ['a', 'b']), 'build_ids'],
	] as const) {
		const { sql, params } = sqlOf(cond);
		assert.ok(sql.includes('"project_key" = $1'), `${name}: this project only`);
		assert.ok(sql.includes('"id" in ($2, $3)'), `${name}: the named rows only`);
		const open = `not exists (select 1 from "perf_finding_bugs" inner join "bug_reports"`;
		assert.ok(sql.includes(open), `${name}: not one a bug cites…`);
		assert.ok(
			/"bug_reports"\."status" in \(\$\d+, \$\d+\)/.test(sql) &&
				params.includes('open') &&
				params.includes('working'),
			`${name}: …that is open or being fixed`,
		);
		assert.ok(sql.includes(`any("perf_finding_bugs"."${list}")`), `${name}: cited by this list`);
		assert.ok(
			/"keep" = \$\d+ or exists \(select 1 from "perf_finding_bugs"/.test(sql),
			`${name}: kept only if a (closed) bug cites it`,
		);
		assert.ok(sql.includes('"purging_at" is not null'), `${name}: a claimed row is finished`);
	}
	const sup = sqlOf(supersededReport('p', ['a'])).sql;
	assert.ok(
		sup.includes('"keep" = $') && sup.includes('not exists (select 1 from "perf_finding_bugs"'),
	);
});

test('23. a Delete ends where the purge does: file first, then row; a stuck file keeps its row claimed', async () => {
	const rows = new Set(['a', 'b', 'c']);
	const files = new Set(['fa', 'fb', 'fc']);
	const store = {
		async deleteClaimed(id: string) {
			rows.delete(id);
		},
	};
	const deleteObject = async (key: string) => {
		if (key === 'fb') throw new Error('R2 down');
		files.delete(key);
	};
	const result = await removeClaimed({
		claimed: [
			{ id: 'a', r2Key: 'fa' },
			{ id: 'b', r2Key: 'fb' },
			{ id: 'c', r2Key: 'fc' },
		],
		store,
		deleteObject,
	});
	assert.deepEqual(result, { deleted: ['a', 'c'], failed: ['b'] });
	assert.deepEqual([...rows], ['b'], 'the row whose file stayed is not dropped');
	assert.deepEqual([...files], ['fb']);
});

// ── 24. Findings ──

const ctxOf = (over: Partial<FindingContext> = {}): FindingContext => ({
	readings: [],
	builds: [],
	readingFacts: new Map(),
	buildFacts: new Map(),
	budgets: effectiveBudgets([]),
	gameKind: 'lines',
	owners: { tools: {}, kinds: { lines: ['lines-games'] } },
	...over,
});

/** The fps finding a slow phone gets on a build. */
const slowOn = (build: string, extra: Partial<PerfReportListItem> = {}) =>
	RULES.fpsBelowBudget(
		ctxOf({
			readings: [1, 2].map((n) =>
				reading(`slow${build}-${n}`, {
					buildVersion: build,
					capturedAt: at(10 + Number(build)),
					spinning: phase(300, 20),
					...extra,
				}),
			),
		}),
	);

test('24. a finding’s subject is what it is about, not the build: the same on the next build', () => {
	const [a] = slowOn('12');
	const [b] = slowOn('13');
	assert.ok(a && b);
	assert.notEqual(a.id, b.id, 'the id names its build');
	assert.equal(a.subject, b.subject, 'the subject does not');
	assert.ok(!a.subject.includes(':12') && !b.subject.includes(':13'), 'no build in it');
	assert.ok(a.subject.startsWith('fpsBelowBudget:slots:'));
});

test('24. one row per subject: two sends of the same measurement are one finding with all its evidence', () => {
	const f = (id: string, evidenceId: string, severity: Finding['severity']): Finding => ({
		id,
		subject: 'featureCost:slots:phone · Mali:particles',
		rule: 'featureCost',
		severity,
		title: 'Particles cost 4 fps',
		detail: [],
		evidence: [{ type: 'reading', id: evidenceId, label: evidenceId }],
		estimate: { value: 4, unit: 'fps', basis: 'x' },
		owner: { kind: 'agent', id: 'engine-pixi-svelte', label: 'engine-pixi-svelte' },
		deviceClass: 'phone',
		gameKey: 'slots',
	});
	const merged = mergeBySubject([
		f('featureCost:r1', 'r1', 'low'),
		f('featureCost:r2', 'r2', 'medium'),
	]);
	assert.equal(merged.length, 1);
	assert.equal(merged[0].severity, 'medium', 'the strongest speaks');
	assert.deepEqual(
		merged[0].evidence.map((e) => e.id).sort(),
		['r1', 'r2'],
		'every reading stays linked',
	);
	const other = {
		...f('featureCost:r3', 'r3', 'low'),
		owner: { ...f('x', 'x', 'low').owner, id: 'invisible-fx' },
	};
	assert.equal(
		mergeBySubject([f('featureCost:r1', 'r1', 'low'), other]).length,
		2,
		'another owner is another row',
	);
	assert.equal(
		mergeBySubject([f('a', 'r1', 'low'), { ...f('b', 'r2', 'low'), subject: 'other' }]).length,
		2,
	);
});

test('24. the real rules never list one subject twice', () => {
	const all = findings(
		ctxOf({
			readings: [
				reading('s1', { spinning: phase(300, 30), textureMb: 200 }),
				reading('s2', { spinning: phase(300, 30), textureMb: 200, capturedAt: at(11) }),
				reading('s3', { spinning: phase(300, 30), textureMb: 200, capturedAt: at(12) }),
			],
		}),
	);
	assert.ok(all.length >= 1);
	const keys = all.map((f) => `${f.subject}|${f.owner.id}`);
	assert.equal(new Set(keys).size, keys.length);
	for (const f of all) assert.ok(f.subject.length > 0, `${f.id} has a subject`);
});

const link = (
	findingId: string,
	subject: string | null,
	status: string,
	statusAt: string | null = null,
	number = 7,
): FindingLinkRow => ({
	findingId,
	subject,
	filedAt: at(9, 16),
	bug: { number, kind: 'pipeline', status, statusAt },
});

test('24. a filed finding leaves the list while its bug is open or being fixed — and follows the next build', () => {
	const [old] = slowOn('12');
	const [next] = slowOn('13');
	const newer = (r: { type: 'reading' | 'build'; id: string }) =>
		[...(old?.evidence ?? []), ...(next?.evidence ?? [])].some((e) => e.id === r.id)
			? at(14)
			: null;
	for (const status of ['open', 'working', 'wontFix']) {
		const views = filedViews([old, next], [link(old.id, old.subject, status)], newer);
		assert.equal(views[old.id].hidden, true, `${status}: hidden`);
		assert.equal(views[old.id].state, 'filed');
		assert.equal(views[old.id].exact, true);
		assert.equal(
			views[next.id].hidden,
			true,
			`${status}: the next build’s finding is the same bug`,
		);
		assert.equal(views[next.id].exact, false);
		assert.equal(views[next.id].number, 7);
	}
	assert.deepEqual(filedViews([old], [], newer), {}, 'no bug: nothing filed');
	assert.deepEqual(
		filedViews([next], [link('some-other', 'another subject', 'open')], newer),
		{},
		'another subject is another finding',
	);
});

test('24. a link filed before subjects matches on its exact id only', () => {
	const [old] = slowOn('12');
	const [next] = slowOn('13');
	const views = filedViews([old, next], [link(old.id, null, 'open')], () => null);
	assert.equal(views[old.id].hidden, true);
	assert.equal(views[next.id], undefined, 'no subject, no follow');
});

test('24. closed as fixed: back as "regressed" once a later reading shows it, hidden until then', () => {
	const [f] = slowOn('13');
	const evidenceAt = (when: string) => () => when;
	const fixed = link('old-id', f.subject, 'resolved', at(12, 18));
	const before = filedViews([f], [fixed], evidenceAt(at(11, 18)));
	assert.equal(before[f.id].hidden, true, 'read from older readings: nothing measured since');
	assert.equal(before[f.id].state, 'filed');
	const after = filedViews([f], [fixed], evidenceAt(at(13, 18)));
	assert.equal(after[f.id].state, 'regressed');
	assert.equal(after[f.id].hidden, false);
	assert.equal(after[f.id].exact, false, 'a new build’s finding can be filed again');
	assert.equal(
		filedViews([f], [{ ...fixed, bug: { ...fixed.bug, statusAt: null } }], evidenceAt(at(8, 16)))[
			f.id
		].state,
		'filed',
		'a status with no time counts from the filing',
	);
	assert.equal(
		filedViews([f], [fixed], () => null)[f.id].state,
		'filed',
		'evidence that is no longer listed is not newer',
	);
});

test('24. an active bug beats a closed one on the same subject; only an active one blocks a new filing', () => {
	const [f] = slowOn('13');
	const closed = link('old', f.subject, 'resolved', at(9, 18), 3);
	const open = { ...link('newer', f.subject, 'open', null, 9), filedAt: at(9, 19) };
	assert.equal(filedViews([f], [closed, open], () => null)[f.id].number, 9);
	assert.equal(activeBugFor(f, [closed]), null, 'closed: it may be filed again');
	assert.equal(activeBugFor(f, [closed, open]), 9);
	assert.equal(activeBugFor(f, [link('other', 'x', 'open')]), null);
	assert.equal(activeBugFor(f, [link(f.id, null, 'working', null, 4)]), 4, 'exact id, no subject');
});
