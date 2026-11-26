/**
 * P4 Findings, run by `pnpm --filter launcher-api check:profiler` (imported by `check-profiler.ts`):
 *
 * 14. Facts: a probe report and a build breakdown (the REAL analyser) are reduced to the facts the
 *     rules read — timings, spike causes, the largest textures, KTX2 fallbacks; never-loaded files,
 *     duplicates, Optimize twins, oversize pages.
 * 15. Each rule has a fixture over planted readings and builds, and a PLANTED MUTANT — the rule
 *     with one plausible bug (a lab reading's fps read, a wrong field, an old build judged, a
 *     guessed estimate…) — that the same fixture must fail, so no fixture goes vacuous.
 *     `perf: 8` arcade readings: their facts, the Salmons reading CPU-bound against a 60 Hz frame
 *     (its mutant: JS read against the achieved interval), spikes in play never the menus, and the
 *     four arcade rules (sim catch-up, spawn churn, cost per body, patch stutter), each with one.
 * 16. Ranking (severity, then saving, unmeasured last), owners from the real owners.json, Compare.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { analyzeDesktopBuild } from '../../../scripts/lib/build-breakdown.mjs';
import type { PerfPhaseSummary, PerfReportListItem } from '../src/lib/profiler.ts';
import { deviceGroups, effectiveBudgets } from '../src/lib/profilerBudgets.ts';
import type { PerfBuildListItem } from '../src/lib/profilerBuilds.ts';
import type { PerfCounts } from '../src/lib/profilerLab.ts';
import {
	ARCADE_WORK_KEYS,
	buildFacts,
	reportFacts,
	type ArcadeFacts,
	type ArcadeWorkKey,
	type BuildFacts,
	type LateStats,
	type MeanMax,
	type ReportFacts,
} from '../src/lib/profilerFindings/facts.ts';
import { gpuCpuBoundAgainst } from '../src/lib/profilerFindings/rules/gpuCpuBound.ts';
import {
	compareReadings,
	findings,
	rankFindings,
	RULES,
	type Finding,
	type FindingContext,
	type OwnerMap,
	type Rule,
} from '../src/lib/profilerFindings/index.ts';

const OWNERS: OwnerMap = JSON.parse(
	readFileSync(new URL('../../../docs/knowledge/owners.json', import.meta.url), 'utf8'),
);

const phase = (frames: number, fps: number, p95 = 19): PerfPhaseSummary => ({
	frames,
	fps,
	p50: 1000 / fps,
	p95,
	hitches: 0,
});

const counts = (spinDraws: number, idleDraws = spinDraws): PerfCounts => ({
	idle: { frames: 600, draws: idleDraws, passes: 2, textureUploads: 0, calls: 190, jsMs: 2 },
	spinning: { frames: 300, draws: spinDraws, passes: 2, textureUploads: 0, calls: 190, jsMs: 3 },
	textureMb: 90,
});

const at = (h: number) => new Date(Date.UTC(2026, 10, 17, h)).toISOString();

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
	menu: null,
	play: null,
	capped30: false,
	drawsMean: 80,
	textureMb: 90,
	counts: counts(80),
	keep: false,
	expiresAt: null,
	...over,
});

const timing = (
	frames: number,
	jsMs: number,
	renderMs: number,
	tickMs: number,
	gpuWaitMs: number | null = null,
) => ({
	frames,
	jsMs,
	renderMs,
	tickMs,
	gpuWaitMs,
});

const facts = (over: Partial<ReportFacts> = {}): ReportFacts => ({
	...reportFacts({}),
	refreshHz: 60,
	...over,
});

const breakdown = (files: unknown[], extra: Record<string, unknown> = {}) => ({
	version: 3,
	build: { version: '12', kind: 'publish', optimize: false },
	totals: { files: files.length, bytes: 1 },
	categories: [],
	files,
	issues: [],
	...extra,
});

const MB = 1048576;

const build = (id: string, over: Partial<PerfBuildListItem> = {}): PerfBuildListItem => ({
	build: '12',
	kind: 'publish',
	profile: null,
	debug: false,
	optimize: false,
	builtAt: null,
	engineSha: 'abcdef1234',
	gameSha: null,
	launcherVersion: null,
	breakdownVersion: 3,
	files: 10,
	shippedBytes: 18 * MB,
	codeBytes: 2 * MB,
	gpuBytes: 100 * MB,
	removedBytes: 0,
	unreferencedBytes: 0,
	duplicateBytes: 0,
	categories: [{ id: 'art', label: 'Art', files: 5, bytes: 14 * MB }],
	issues: { error: 0, warn: 0, info: 0 },
	id,
	gameKey: 'slots',
	registeredAt: at(9),
	keep: false,
	expiresAt: null,
	...over,
});

const ctxOf = (over: Partial<FindingContext> = {}): FindingContext => ({
	readings: [],
	builds: [],
	readingFacts: new Map(),
	buildFacts: new Map(),
	budgets: effectiveBudgets([]),
	gameKind: 'lines',
	owners: OWNERS,
	...over,
});

/** A fixture passes on the rule and throws on its planted mutant. */
function holds(name: string, check: (rule: Rule) => void, rule: Rule, mutant: Rule): void {
	check(rule);
	assert.throws(
		() => check(mutant),
		assert.AssertionError,
		`${name}: the fixture must catch its mutant`,
	);
}

// ── 14. Facts ──

test('14. a report is reduced to the facts the rules read', () => {
	const f = reportFacts({
		perf: 7,
		refreshHz: 60,
		work: {
			idle: { frames: 600, perFrame: { jsMs: { mean: 2, max: 5 }, renderMs: { mean: 1, max: 2 } } },
			spinning: {
				frames: 300,
				perFrame: {
					jsMs: { mean: 9, max: 20 },
					renderMs: { mean: 4, max: 9 },
					tickMs: { mean: 7, max: 15 },
					gpuWaitMs: { mean: 12, max: 30 },
				},
			},
			round: { frames: 0, perFrame: {} },
		},
		spikeOverMs: 41.7,
		spikeCauses: { idle: { 'first use': 4 }, spinning: { particles: 3 }, round: {} },
		spikes: [
			{ at: 2, ms: 120, cause: 'first use', why: '3 compiles', prev: {} },
			{ at: 12, ms: 60, spin: true, cause: 'particles', why: 'JS 40 ms', prev: {} },
		],
		textureList: Array.from({ length: 30 }, (_, i) => ({
			src: `assets/pages/p${i}.webp`,
			kind: 'image',
			width: i === 29 ? 8192 : 1024,
			height: 1024,
			format: 'rgba8unorm',
			mb: i === 29 ? 0.5 : 30 - i,
		})),
		ktx2Fallbacks: [{ key: 'assets/pages/p0.ktx2', reason: 'no BC7' }],
	});
	assert.deepEqual(f.timing.spinning, {
		frames: 300,
		renderMs: 4,
		tickMs: 7,
		jsMs: 9,
		gpuWaitMs: 12,
	});
	assert.equal(f.timing.round, null, 'a phase with no frames has no timing');
	assert.deepEqual(f.spikeCauses?.spinning, { particles: 3 });
	assert.deepEqual(
		f.spikes.map((s) => [s.ms, s.phase]),
		[
			[120, 'idle'],
			[60, 'spinning'],
		],
	);
	assert.equal(f.textures?.[0].src, 'assets/pages/p0.webp', 'largest first');
	assert.ok(
		f.textures?.some((t) => t.width === 8192),
		'an oversize texture is kept past the top',
	);
	assert.ok((f.textures?.length ?? 0) <= 24, 'bounded');
	assert.equal(f.ktx2Fallbacks[0].reason, 'no BC7');
	assert.equal(reportFacts({ perf: 7 }).textures, null, 'a trimmed reading has no texture list');
});

test('14. a build breakdown from the real analyser is reduced to its facts', () => {
	const json = JSON.parse(
		JSON.stringify(
			analyzeDesktopBuild({
				files: [
					{ rel: '_app/immutable/app.js', bytes: 2_000_000 },
					{ rel: 'assets/ui/frame.png', bytes: 3_000_000, hash: 'h1' },
					{ rel: 'assets/ui/frame-copy.png', bytes: 3_000_000, hash: 'h1' },
					{ rel: 'assets/ui/unused.png', bytes: 100_000 },
					{ rel: 'assets/sounds/spin.mp3', bytes: 500_000 },
					{ rel: 'assets/sounds/spin.ogg', bytes: 400_000 },
					{ rel: 'assets/pages/bg.png', bytes: 900_000 },
					{ rel: 'assets/pages/bg.webp', bytes: 300_000 },
				],
				texts: new Map([
					[
						'_app/immutable/app.js',
						'"assets/ui/frame.png" "assets/ui/frame-copy.png" "assets/sounds/spin.mp3" "assets/sounds/spin.ogg" "assets/pages/bg.webp"',
					],
				]),
				bundle: null,
				assetsPrefix: 'assets/',
				pull: null,
				images: null,
				buildInfo: { version: '12' },
				build: { kind: 'publish', optimize: false },
			}),
		),
	);
	const f = buildFacts(json);
	assert.deepEqual(
		f.unreferenced.map((x) => x.rel).sort(),
		['assets/pages/bg.png', 'assets/ui/unused.png'],
		'what the analyser calls never loaded',
	);
	assert.deepEqual(
		f.duplicates.map((x) => [x.rel, x.of, x.bytes]),
		[['assets/ui/frame.png', 'assets/ui/frame-copy.png', 3_000_000]],
	);
	assert.deepEqual(
		f.optimizeTwins.map((x) => x.rel),
		['assets/sounds/spin.ogg'],
		'the ogg beside its mp3; the PNG nothing loads is already never-loaded bytes, not counted twice',
	);
	assert.equal(f.optimizeTwinBytes, 400_000);
	const on = buildFacts({ ...json, build: { ...json.build, optimize: true } });
	assert.deepEqual(on.optimizeTwins, [], 'an Optimize build has no twins to drop');
	const sized = buildFacts(
		breakdown([
			{
				rel: 'assets/big.webp',
				bytes: 2 * MB,
				kind: 'image',
				loaded: true,
				dims: { w: 8192, h: 2048 },
			},
			{ rel: 'assets/ok.webp', bytes: MB, kind: 'image', loaded: true, dims: { w: 2048, h: 2048 } },
		]),
	);
	assert.deepEqual(
		sized.oversized.map((x) => x.rel),
		['assets/big.webp'],
	);
	assert.deepEqual(buildFacts('nonsense').unreferenced, [], 'never throws');
});

// ── 15. Rules ──

test('15. fps below budget: P3’s verdict per device, never a lab run’s fps', () => {
	const check = (rule: Rule) => {
		const ctx = ctxOf({
			readings: [
				reading('slow1', { spinning: phase(300, 40) }),
				reading('slow2', { spinning: phase(300, 42) }),
				reading('fine', { gpu: 'Adreno 740', spinning: phase(300, 59) }),
				reading('lab', {
					source: 'lab',
					deviceClass: 'desktop',
					gpu: 'SwiftShader',
					idle: phase(600, 3.4),
					spinning: phase(300, 3.2),
					round: null,
				}),
				reading('old', {
					buildVersion: '11',
					capturedAt: at(1),
					gpu: 'Adreno 740',
					spinning: phase(300, 20),
				}),
			],
		});
		const fs = rule(ctx);
		assert.equal(fs.length, 1, 'only the slow phone, on the current build');
		const f = fs[0];
		assert.equal(f.severity, 'high', 'median 41 < 50 fails');
		assert.deepEqual(f.estimate, { value: 14, unit: 'fps', basis: 'fps short of the warn line' });
		assert.equal(f.owner.id, 'lines-games', 'the game kind’s agent');
		assert.deepEqual(f.evidence.map((e) => e.id).sort(), ['slow1', 'slow2']);
		assert.equal(
			rule(ctxOf({ readings: [reading('few', { spinning: phase(50, 20) })] })).length,
			0,
			'too few frames: no verdict',
		);
	};
	const labAsPhone: Rule = (ctx) =>
		RULES.fpsBelowBudget({
			...ctx,
			readings: ctx.readings.map((r) => ({ ...r, source: 'capture' as const })),
		});
	holds('fpsBelowBudget', check, RULES.fpsBelowBudget, labAsPhone);
	assert.equal(
		deviceGroups([reading('lab', { source: 'lab' })], effectiveBudgets([])).length,
		0,
		'the Devices tab leaves lab runs out too',
	);
});

test('15. GPU- or CPU-bound: our JS against the frame interval, the GPU wait when measured', () => {
	const check = (rule: Rule) => {
		const cpu = reading('cpu', { spinning: phase(300, 40) });
		const out = reading('out', { gpu: 'Adreno 610', spinning: phase(300, 40) });
		const gpuRun = reading('gpu', {
			gpu: 'Adreno 610',
			flags: { perfgpu: '1' },
			spinning: phase(300, 20),
		});
		const ctx = ctxOf({
			readings: [cpu, out, gpuRun],
			readingFacts: new Map([
				['cpu', facts({ timing: { idle: null, round: null, spinning: timing(300, 20, 3, 16) } })],
				['out', facts({ timing: { idle: null, round: null, spinning: timing(300, 4, 2, 3) } })],
				['gpu', facts({ timing: { idle: null, round: null, spinning: timing(300, 4, 2, 3, 14) } })],
			]),
		});
		const fs = rule(ctx);
		const cpuF = fs.find((f) => f.id.includes('Mali'));
		const outF = fs.find((f) => f.id.includes('Adreno 610'));
		assert.match(cpuF?.title ?? '', /CPU-bound/, '20 ms of a 25 ms frame');
		assert.ok(cpuF?.detail.some((d) => d.includes('game code in the tick (13 ms)')));
		assert.match(outF?.title ?? '', /GPU-bound/, 'the ?perfgpu=1 wait says GPU');
		assert.ok(
			fs.every((f) => f.estimate === null),
			'names the side, never a saving',
		);
		assert.equal(fs.length, 2, 'the ?perfgpu=1 reading’s own fps is never judged');
		assert.equal(cpuF?.owner.id, 'engine-pixi-svelte');
	};
	const tickAsJs: Rule = (ctx) =>
		RULES.gpuCpuBound({
			...ctx,
			readingFacts: new Map(
				[...ctx.readingFacts].map(([id, f]) => [
					id,
					{
						...f,
						timing: {
							...f.timing,
							spinning: f.timing.spinning && {
								...f.timing.spinning,
								jsMs: f.timing.spinning.renderMs,
							},
						},
					},
				]),
			),
		});
	holds('gpuCpuBound', check, RULES.gpuCpuBound, tickAsJs);
});

test('15. feature cost: a switch beside the as-shipped reading on the same device and build', () => {
	const check = (rule: Rule) => {
		const ctx = ctxOf({
			readings: [
				reading('base', { capturedAt: at(10), spinning: phase(300, 45), counts: counts(90) }),
				reading('decoy', {
					capturedAt: at(11),
					gpu: 'Adreno 740',
					spinning: phase(300, 58),
					counts: counts(90),
				}),
				reading('off', {
					capturedAt: at(11),
					flags: { particles: 'off' },
					spinning: phase(300, 53),
					counts: counts(60),
				}),
				reading('aa', {
					capturedAt: at(11),
					flags: { aa: '0' },
					spinning: phase(300, 45.5),
					counts: counts(89),
				}),
			],
		});
		const fs = rule(ctx);
		assert.equal(fs.length, 1, 'antialiasing bought nothing measurable');
		const f = fs[0];
		assert.deepEqual(f.estimate, {
			value: 8,
			unit: 'fps',
			basis: 'fps spinning gains with particles=off',
		});
		assert.deepEqual(
			f.evidence.map((e) => e.id),
			['base', 'off'],
			'paired on the same GPU',
		);
		assert.equal(f.owner.id, 'invisible-fx');
		assert.equal(f.severity, 'medium');
		assert.ok(f.detail.some((d) => d.includes('90 → 60 draws')));
	};
	const anyGpu: Rule = (ctx) =>
		RULES.featureCost({ ...ctx, readings: ctx.readings.map((r) => ({ ...r, gpu: null })) });
	holds('featureCost', check, RULES.featureCost, anyGpu);
	const lab = RULES.featureCost(
		ctxOf({
			readings: [
				reading('lb', { source: 'lab', spinning: phase(300, 3), counts: counts(90) }),
				reading('lo', {
					source: 'lab',
					flags: { fx: '0' },
					spinning: phase(300, 9),
					counts: counts(70),
				}),
			],
		}),
	);
	assert.deepEqual(
		lab.map((f) => [f.estimate?.unit, f.estimate?.value, f.owner.id]),
		[['draws', 20, 'invisible-shader-graph']],
		'a lab pair says the draws, never the fps',
	);
});

test('15. spikes by cause: mid-round only, never a lab run', () => {
	const check = (rule: Rule) => {
		const causes = {
			idle: { 'first use': 6 },
			spinning: { 'first use': 2, particles: 1 },
			round: { 'first use': 2, rigs: 1 },
		};
		const ctx = ctxOf({
			readings: [reading('a'), reading('lab', { source: 'lab' })],
			readingFacts: new Map([
				['a', facts({ spikeCauses: causes })],
				[
					'lab',
					facts({ spikeCauses: { idle: {}, spinning: { 'outside the game': 90 }, round: {} } }),
				],
			]),
		});
		const fs = rule(ctx);
		assert.deepEqual(
			fs.map((f) => [f.title.split(' from ')[1].split(' on ')[0], f.estimate?.value, f.severity]),
			[['first use', 4, 'medium']],
			'boot compiles at idle are left out; one-offs too',
		);
		assert.equal(fs[0].owner.id, 'engine-pixi-svelte');
	};
	const idleCounted: Rule = (ctx) =>
		RULES.spikes({
			...ctx,
			readingFacts: new Map(
				[...ctx.readingFacts].map(([id, f]) => [
					id,
					f.spikeCauses
						? {
								...f,
								spikeCauses: {
									idle: {},
									spinning: f.spikeCauses.spinning,
									round: { ...f.spikeCauses.round, ...f.spikeCauses.idle },
								},
							}
						: f,
				]),
			),
		});
	holds('spikes', check, RULES.spikes, idleCounted);
});

test('15. textures: over the GPU budget, KTX2 fallbacks, oversize pages', () => {
	const list = [
		{
			src: 'pages/bg.webp',
			kind: 'image',
			width: 4096,
			height: 4096,
			format: 'rgba8unorm',
			mb: 67.1,
		},
		{
			src: 'pages/sym.webp',
			kind: 'image',
			width: 2048,
			height: 2048,
			format: 'rgba8unorm',
			mb: 16.8,
		},
		{ src: 'pages/ui.ktx2', kind: 'compressed', width: 2048, height: 2048, format: 'bc7', mb: 4.2 },
		...Array.from({ length: 4 }, (_, i) => ({
			src: `pages/x${i}.webp`,
			kind: 'image',
			width: 1024,
			height: 1024,
			format: 'rgba8unorm',
			mb: 4,
		})),
	];
	const check = (rule: Rule) => {
		const ctx = ctxOf({
			readings: [reading('big', { textureMb: 170 })],
			readingFacts: new Map([
				[
					'big',
					facts({
						textures: list,
						ktx2Fallbacks: [{ key: 'https://cdn/x/pages/bg.ktx2', reason: 'no BC7' }],
					}),
				],
			]),
			builds: [build('b12')],
			buildFacts: new Map([
				[
					'b12',
					{
						...buildFacts(null),
						oversized: [{ rel: 'assets/huge.webp', bytes: 3 * MB, w: 8192, h: 4096 }],
					},
				],
			]),
		});
		const fs = rule(ctx);
		const gpu = fs.find((f) => f.id.startsWith('textures:gpu'));
		assert.equal(gpu?.severity, 'high', '170 MB > 150');
		assert.deepEqual(gpu?.estimate, {
			value: 96.1,
			unit: 'GPU MB',
			basis: 'held by the 5 largest textures',
		});
		const ktx = fs.find((f) => f.id.startsWith('textures:ktx2'));
		assert.equal(ktx?.estimate, null, 'a fallback names an asset key, not a page: unmeasured');
		const big = fs.find((f) => f.id.startsWith('textures:oversize'));
		assert.deepEqual(
			[big?.estimate, big?.evidence[0].id],
			[null, 'b12'],
			'a split page ships the same',
		);
		assert.ok(fs.every((f) => f.owner.id === 'atlas-python-tools'));
	};
	const wholeMb: Rule = (ctx) =>
		RULES.textures(ctx).map((f) =>
			f.id.startsWith('textures:gpu') && f.estimate
				? { ...f, estimate: { ...f.estimate, value: ctx.readings[0].textureMb ?? 0 } }
				: f,
		);
	holds('textures', check, RULES.textures, wholeMb);
	const trimmed = RULES.textures(
		ctxOf({
			readings: [reading('t', { textureMb: 170 })],
			readingFacts: new Map([['t', facts()]]),
		}),
	);
	assert.equal(trimmed[0].estimate, null, 'no texture list: unmeasured, not a guess');
});

test('15. unused bytes: the newest build’s never-loaded and duplicate bytes', () => {
	const check = (rule: Rule) => {
		const ctx = ctxOf({
			builds: [
				build('old', { registeredAt: at(1), unreferencedBytes: 9 * MB }),
				build('new', { registeredAt: at(9), unreferencedBytes: 2 * MB, duplicateBytes: 300_000 }),
			],
		});
		const fs = rule(ctx);
		assert.deepEqual(fs.map((f) => [f.id.split(':')[1], f.estimate?.value, f.severity]).sort(), [
			['duplicates', 0.3, 'low'],
			['unloaded', 2, 'medium'],
		]);
		assert.ok(fs.every((f) => f.owner.kind === 'person' && f.evidence[0].id === 'new'));
	};
	const everyBuild: Rule = (ctx) =>
		ctx.builds.flatMap((b) => RULES.unusedBytes({ ...ctx, builds: [b] }));
	holds('unusedBytes', check, RULES.unusedBytes, everyBuild);
});

test('15. Optimize off: only what Optimize measurably drops, else unmeasured', () => {
	const check = (rule: Rule) => {
		const ctx = ctxOf({
			builds: [
				build('a', { gameKey: 'slots' }),
				build('b', { gameKey: 'other' }),
				build('c', { gameKey: 'third', optimize: true }),
			],
			buildFacts: new Map<string, BuildFacts>([
				[
					'a',
					{
						...buildFacts(null),
						optimizeTwins: [{ rel: 'x.png', bytes: 2 * MB, twin: 'x.webp' }],
						optimizeTwinBytes: 2 * MB,
					},
				],
				['b', buildFacts(null)],
			]),
		});
		const fs = rule(ctx);
		assert.deepEqual(
			fs.map((f) => [f.gameKey, f.estimate?.value ?? null]).sort(),
			[
				['other', null],
				['slots', 2],
			],
			'an Optimize build has no finding; no twins = unmeasured',
		);
		assert.ok(fs.every((f) => f.owner.id === 'publisher'));
	};
	const guessed: Rule = (ctx) =>
		RULES.optimizeOff(ctx).map((f) =>
			f.estimate
				? f
				: { ...f, estimate: { value: 5, unit: 'MB' as const, basis: 'about 30% of the art' } },
		);
	holds('optimizeOff', check, RULES.optimizeOff, guessed);
});

test('15. regression: size against the previous build, fps and lab counts against the stamp before', () => {
	const check = (rule: Rule) => {
		const ctx = ctxOf({
			builds: [
				build('b11', { build: '11', registeredAt: at(1), shippedBytes: 18 * MB }),
				build('b12', {
					registeredAt: at(9),
					shippedBytes: 21 * MB,
					categories: [{ id: 'art', label: 'Art', files: 6, bytes: 17 * MB }],
				}),
			],
			readings: [
				reading('n1', { capturedAt: at(10), spinning: phase(300, 50) }),
				reading('o1', { buildVersion: '11', capturedAt: at(2), spinning: phase(300, 57) }),
				reading('ln', {
					source: 'lab',
					gpu: 'SwiftShader',
					capturedAt: at(10),
					spinning: phase(300, 2),
					counts: counts(60),
				}),
				reading('lo', {
					source: 'lab',
					gpu: 'SwiftShader',
					buildVersion: '11',
					capturedAt: at(3),
					spinning: phase(300, 9),
					counts: counts(40),
				}),
			],
		});
		const fs = rule(ctx);
		const ids = fs.map((f) => f.id.split(':').slice(0, 2).join(':')).sort();
		assert.deepEqual(ids, ['regression:counts', 'regression:fps', 'regression:shipped']);
		const size = fs.find((f) => f.id.startsWith('regression:shipped'));
		assert.equal(size?.estimate?.value, 3);
		assert.ok(size?.detail[0].includes('Art +3 MB'));
		const fps = fs.find((f) => f.id.startsWith('regression:fps'));
		assert.equal(fps?.estimate?.value, 7);
		assert.ok(
			fps?.detail.some((d) => d.includes('Art +3 MB')),
			'the categories the builds grew',
		);
		const lab = fs.find((f) => f.id.startsWith('regression:counts'));
		assert.equal(lab?.estimate?.value, 20, 'spinning draws 40 → 60');
	};
	const late = RULES.regression(
		ctxOf({
			builds: [
				build('b11', { build: '11', registeredAt: at(1) }),
				build('b12', { registeredAt: at(5) }),
			],
			readings: [
				reading('fixed', { capturedAt: at(6), spinning: phase(300, 56) }),
				reading('recheck', { buildVersion: '11', capturedAt: at(9), spinning: phase(300, 40) }),
			],
		}),
	);
	assert.deepEqual(late, [], 're-measuring the old build later is not a regression of it');
	assert.deepEqual(
		RULES.fpsBelowBudget(
			ctxOf({
				builds: [
					build('b11', { build: '11', registeredAt: at(1) }),
					build('b12', { registeredAt: at(5) }),
				],
				readings: [
					reading('fixed', { capturedAt: at(6), spinning: phase(300, 56) }),
					reading('recheck', { buildVersion: '11', capturedAt: at(9), spinning: phase(300, 40) }),
				],
			}),
		),
		[],
		'the current build is the newest build, not the newest capture',
	);
	assert.deepEqual(
		RULES.regression(
			ctxOf({
				builds: [
					build('b11', { build: '11', registeredAt: at(1), gpuBytes: 0 }),
					build('b12', { registeredAt: at(5), gpuBytes: 90 * MB }),
				],
			}),
		),
		[],
		'no GPU estimate before is no data, not +90 MB',
	);
	const labFps: Rule = (ctx) =>
		RULES.regression({
			...ctx,
			readings: ctx.readings.map((r) => ({ ...r, source: 'capture' as const })),
		});
	holds('regression', check, RULES.regression, labFps);
});

// ── perf: 8: arcade readings ──

const arcadeItem = (id: string, over: Partial<PerfReportListItem> = {}): PerfReportListItem =>
	reading(id, {
		kind: 'arcade',
		phaseSet: 'arcade',
		idle: null,
		spinning: null,
		round: null,
		menu: phase(400, 59.9),
		play: phase(1800, 58),
		counts: null,
		...over,
	});

const mm = (mean: number, max = mean): MeanMax => ({ mean, max });
const lateness = (count: number, p95: number, max: number): LateStats => ({
	count,
	p50: p95 / 2,
	p95,
	max,
});

const arcadeWork = (over: Partial<Record<ArcadeWorkKey, MeanMax>> = {}) =>
	({
		...Object.fromEntries(ARCADE_WORK_KEYS.map((k) => [k, null])),
		...over,
	}) as Record<ArcadeWorkKey, MeanMax | null>;

interface ArcadeFixture {
	play?: Partial<Record<ArcadeWorkKey, MeanMax>>;
	menu?: Partial<Record<ArcadeWorkKey, MeanMax>>;
	playLate?: LateStats;
	menuLate?: LateStats;
	online?: boolean;
	patchHz?: number;
}

const arcadeFacts = (a: ArcadeFixture, over: Partial<ReportFacts> = {}): ReportFacts =>
	facts({
		timing: {},
		arcade: {
			online: a.online ?? false,
			fixedHz: 60,
			patchHz: a.patchHz ?? null,
			menu: { work: arcadeWork(a.menu), lateMs: a.menuLate ?? null },
			play: { work: arcadeWork(a.play), lateMs: a.playLate ?? null },
		},
		...over,
	});

const mapArcade = (m: ReadonlyMap<string, ReportFacts>, fn: (a: ArcadeFacts) => ArcadeFacts) =>
	new Map([...m].map(([id, f]) => [id, f.arcade ? { ...f, arcade: fn(f.arcade) } : f]));
/** The planted "read the menu as play" bug. */
const swapMenuPlay = (m: ReadonlyMap<string, ReportFacts>) =>
	mapArcade(m, (a) => ({ ...a, menu: a.play, play: a.menu }));

test('14. an arcade report: menu / play timing and spikes, the sim and room work, lateness', () => {
	const f = reportFacts({
		perf: 8,
		kind: 'arcade',
		refreshHz: 60,
		menu: { frames: 400 },
		play: { frames: 1800 },
		idle: { frames: 900 },
		work: {
			menu: { frames: 400, perFrame: { jsMs: mm(2), simSteps: mm(0) } },
			play: {
				frames: 1800,
				perFrame: {
					jsMs: mm(8, 20),
					renderMs: mm(3, 6),
					tickMs: mm(6, 15),
					simSteps: mm(1.3, 4),
					simCatchUp: mm(0.2, 1),
					simMs: mm(2.5, 9),
					bodies: mm(20, 36),
					patches: mm(0.33, 2),
					patchBytes: mm(120, 900),
				},
			},
			idle: { frames: 900, perFrame: { jsMs: mm(1) } },
		},
		arcade: {
			online: true,
			fixedHz: 30,
			patchHz: 20,
			lateMs: { menu: lateness(10, 9, 12), play: lateness(600, 41, 90) },
		},
		spikeCauses: {
			menu: { 'tilemap/upload': 2 },
			play: { 'sim catch-up': 3 },
			idle: { 'first use': 5 },
		},
		spikes: [
			{ at: 1, ms: 80, cause: 'tilemap/upload', why: 'built the field' },
			{ at: 9, ms: 60, play: true, cause: 'sim catch-up', why: '3 steps' },
		],
	});
	assert.deepEqual(Object.keys(f.timing), ['menu', 'play'], 'the reading’s own set');
	assert.deepEqual(f.timing.play, {
		frames: 1800,
		renderMs: 3,
		tickMs: 6,
		jsMs: 8,
		gpuWaitMs: null,
	});
	assert.deepEqual(f.spikeCauses, { menu: { 'tilemap/upload': 2 }, play: { 'sim catch-up': 3 } });
	assert.deepEqual(
		f.spikes.map((s) => [s.ms, s.phase]),
		[
			[80, 'menu'],
			[60, 'play'],
		],
	);
	assert.deepEqual([f.arcade?.online, f.arcade?.fixedHz, f.arcade?.patchHz], [true, 30, 20]);
	assert.deepEqual(f.arcade?.play?.work.simCatchUp, { mean: 0.2, max: 1 });
	assert.equal(f.arcade?.play?.work.netMs, null, 'a key the probe did not report');
	assert.deepEqual(f.arcade?.play?.lateMs, lateness(600, 41, 90));
	assert.equal(reportFacts({ perf: 7, kind: 'arcade' }).arcade, undefined, 'perf: 7 is a slot');
	const slot = reportFacts({ perf: 8, kind: 'slot' });
	assert.equal(slot.arcade, undefined);
	assert.deepEqual(Object.keys(slot.timing), ['idle', 'spinning', 'round']);
});

test('15. GPU- or CPU-bound: the Salmons reading is CPU-bound against a 60 Hz frame', () => {
	// The owner's reading (26 Nov, BS Live · Galaxy S24 Ultra): 29.8 fps, JS 19.4, render 14.9,
	// tick 18.5 at refreshHz 30 — "between CPU and GPU" against the 33.6 ms it achieved.
	const ctx = ctxOf({
		readings: [
			reading('salmons', {
				gpu: 'Adreno (TM) 750',
				idle: phase(5153, 29.8, 33.4),
				spinning: null,
				round: null,
			}),
			arcadeItem('arc', { gpu: 'Adreno 610', play: phase(1800, 40) }),
			reading('cap', { gpu: 'Apple GPU', capped30: true, idle: phase(3000, 30, 33.4) }),
		],
		readingFacts: new Map([
			[
				'salmons',
				facts({
					refreshHz: 30,
					timing: { idle: timing(5153, 19.4, 14.9, 18.5), spinning: null, round: null },
				}),
			],
			['arc', facts({ timing: { menu: timing(400, 2, 1, 1.5), play: timing(1800, 14, 4, 12) } })],
			['cap', facts({ refreshHz: 30, timing: { idle: timing(3000, 5, 3, 4) } })],
		]),
	});
	const check = (rule: Rule) => {
		const fs = rule(ctx);
		const s = fs.find((f) => f.id.includes('Adreno (TM) 750'));
		assert.match(s?.title ?? '', /^idle is CPU-bound/, 'JS 19.4 ms of a 16.7 ms frame');
		assert.ok(s?.detail.some((d) => d.includes('second vsync')));
		assert.ok(s?.detail.some((d) => d.includes('the render submit (14.9 ms)')));
		const a = fs.find((f) => f.id.includes('Adreno 610'));
		assert.match(a?.title ?? '', /^play is CPU-bound/, 'an arcade reading is judged on play');
		assert.ok(
			fs.every((f) => !f.id.endsWith(':menu')),
			'its menu at 59.9 fps passes',
		);
		assert.ok(!fs.some((f) => f.id.includes('Apple GPU')), 'a capped reading is never an fps miss');
	};
	holds(
		'gpuCpuBound (achieved interval)',
		check,
		RULES.gpuCpuBound,
		gpuCpuBoundAgainst(({ fps }) => 1000 / fps),
	);
});

test('15. fps below budget: an arcade game’s play line, owned by its kind’s agent', () => {
	const fs = RULES.fpsBelowBudget(
		ctxOf({ gameKind: 'arcade', readings: [arcadeItem('s', { play: phase(1800, 40) })] }),
	);
	assert.deepEqual(
		fs.map((f) => [f.id.split(':').at(-1), f.severity, f.owner.id]),
		[['play', 'high', 'arcade-games']],
	);
});

test('15. spikes by cause: an arcade game counts play, never its menus', () => {
	const check = (rule: Rule) => {
		const ctx = ctxOf({
			gameKind: 'arcade',
			readings: [arcadeItem('a')],
			readingFacts: new Map([
				[
					'a',
					facts({
						timing: {},
						spikeCauses: {
							menu: { 'tilemap/upload': 6 },
							play: { 'sim catch-up': 3, sim: 1, 'state patch': 2 },
						},
					}),
				],
			]),
		});
		const fs = rule(ctx);
		assert.deepEqual(
			fs.map((f) => [f.title.split(' from ')[1].split(' on ')[0], f.estimate?.value]).sort(),
			[
				['sim catch-up', 3],
				['state patch', 2],
			],
			'the lobby’s tilemap build is left out; one-offs too',
		);
		assert.ok(fs.every((f) => f.owner.id === 'arcade-games' && f.title.includes('mid-play')));
		assert.ok(
			fs.find((f) => f.title.includes('state patch'))?.detail[0].startsWith('room messages'),
			'each arcade cause has its FIX line',
		);
	};
	const menuCounted: Rule = (ctx) =>
		RULES.spikes({
			...ctx,
			readingFacts: new Map(
				[...ctx.readingFacts].map(([id, f]) => [
					id,
					f.spikeCauses
						? { ...f, spikeCauses: { play: { ...f.spikeCauses.play, ...f.spikeCauses.menu } } }
						: f,
				]),
			),
		});
	holds('spikes (arcade)', check, RULES.spikes, menuCounted);
});

test('15. sim catch-up: the share of play frames that ran extra sim steps', () => {
	const check = (rule: Rule) => {
		const ctx = ctxOf({
			gameKind: 'arcade',
			readings: [
				arcadeItem('slow', { play: phase(1800, 41) }),
				arcadeItem('fine', { gpu: 'Adreno 740', play: phase(1800, 60) }),
				arcadeItem('lab', { source: 'lab', gpu: 'SwiftShader' }),
				arcadeItem('short', { gpu: 'Mali-G57', play: phase(60, 30) }),
			],
			readingFacts: new Map([
				[
					'slow',
					arcadeFacts({
						play: { simCatchUp: mm(0.3, 1), simSteps: mm(1.4, 3), simMs: mm(2.2, 7) },
						menu: { simCatchUp: mm(0) },
					}),
				],
				[
					'fine',
					arcadeFacts({
						play: { simCatchUp: mm(0.02, 1), simSteps: mm(1, 2) },
						menu: { simCatchUp: mm(0.9, 1) },
					}),
				],
				['lab', arcadeFacts({ play: { simCatchUp: mm(0.9, 1) } })],
				['short', arcadeFacts({ play: { simCatchUp: mm(0.9, 1) } })],
			]),
		});
		const fs = rule(ctx);
		assert.equal(fs.length, 1, 'the slow phone only: never a lab run, never too few frames');
		const f = fs[0];
		assert.match(f.title, /^30% of play frames catch up the sim on phone · Mali-G52 MC2$/);
		assert.equal(f.severity, 'medium', '30% ≥ 25%');
		assert.ok(f.detail.some((d) => d.includes('1.4 a frame on average, up to 3')));
		assert.ok(f.detail.some((d) => d.includes('A 60 Hz fixed step at 41 fps')));
		assert.deepEqual([f.estimate, f.owner.id], [null, 'arcade-games']);
		assert.ok(f.id.startsWith('simCatchUp:slots|phone · Mali-G52 MC2:12'), 'carries the build');
		const dropped = rule(
			ctxOf({
				readings: [arcadeItem('d')],
				readingFacts: new Map([
					['d', arcadeFacts({ play: { simCatchUp: mm(0.12, 1), simDroppedMs: mm(0.4, 30) } })],
				]),
			}),
		);
		assert.equal(dropped[0]?.severity, 'medium', '12% of frames, but the sim dropped time');
	};
	const menuAsPlay: Rule = (ctx) =>
		RULES.simCatchUp({ ...ctx, readingFacts: swapMenuPlay(ctx.readingFacts) });
	holds('simCatchUp', check, RULES.simCatchUp, menuAsPlay);
});

test('15. spawn churn: bodies spawned and despawned a play frame, counted together', () => {
	const check = (rule: Rule) => {
		const ctx = ctxOf({
			readings: [
				arcadeItem('churn'),
				arcadeItem('calm', { gpu: 'Adreno 740' }),
				arcadeItem('burst', { gpu: 'Mali-G57' }),
			],
			readingFacts: new Map([
				[
					'churn',
					arcadeFacts(
						{ play: { spawns: mm(0.3, 4), despawns: mm(0.3, 5) } },
						{ spikeCauses: { menu: {}, play: { 'spawn burst': 2 } } },
					),
				],
				['calm', arcadeFacts({ play: { spawns: mm(0.1, 2), despawns: mm(0.1, 2) } })],
				['burst', arcadeFacts({ play: { spawns: mm(0.05, 14), despawns: mm(0.05, 3) } })],
			]),
		});
		const fs = rule(ctx);
		const churn = fs.find((f) => f.id.includes('Mali-G52'));
		assert.match(churn?.title ?? '', /^0\.6 spawns a play frame \(up to 5\)/, '0.3 + 0.3');
		assert.equal(churn?.severity, 'medium', 'its spawn bursts already cost spikes');
		assert.ok(churn?.detail.some((d) => d.startsWith('Pool bodies')));
		assert.ok(
			churn?.detail.some((d) => d.includes('(34.8 a second)')),
			'0.6 × 58 fps',
		);
		const burst = fs.find((f) => f.id.includes('Mali-G57'));
		assert.deepEqual([burst?.severity, burst?.title.includes('up to 14')], ['low', true]);
		assert.ok(!fs.some((f) => f.id.includes('Adreno 740')), '0.2 a frame, 2 at most: calm');
		assert.ok(fs.every((f) => f.estimate === null && f.owner.id === 'arcade-games'));
	};
	const spawnsOnly: Rule = (ctx) =>
		RULES.spawnChurn({
			...ctx,
			readingFacts: mapArcade(ctx.readingFacts, (a) => ({
				...a,
				play: a.play && { ...a.play, work: { ...a.play.work, despawns: null } },
			})),
		});
	holds('spawnChurn', check, RULES.spawnChurn, spawnsOnly);
});

test('15. cost per body: the sim a body a step, at the most bodies seen, against 60 Hz', () => {
	const check = (rule: Rule) => {
		const ctx = ctxOf({
			readings: [
				arcadeItem('heavy'),
				arcadeItem('light', { gpu: 'Adreno 740' }),
				arcadeItem('few', { gpu: 'Mali-G57' }),
			],
			readingFacts: new Map([
				[
					'heavy',
					arcadeFacts({
						play: { simMs: mm(4, 11), simSteps: mm(1, 2), bodies: mm(20, 50), pairs: mm(180, 900) },
					}),
				],
				[
					'light',
					arcadeFacts({ play: { simMs: mm(1.2, 3), simSteps: mm(1, 2), bodies: mm(30, 34) } }),
				],
				['few', arcadeFacts({ play: { simMs: mm(6, 9), simSteps: mm(1), bodies: mm(3) } })],
			]),
		});
		const fs = rule(ctx);
		const heavy = fs.find((f) => f.id.includes('Mali-G52'));
		assert.equal(heavy?.severity, 'medium', '0.2 ms a body × 50 bodies = 10 ms: 60% of 16.7');
		assert.ok(heavy?.detail.some((d) => d.includes('about 0.2 ms a body a step')));
		assert.ok(
			heavy?.detail.some(
				(d) => d.includes('At the 50 bodies seen') && d.includes('about 10 ms — 60%'),
			),
		);
		assert.ok(heavy?.detail.includes("The longest frame's sim took 11 ms."));
		const light = fs.find((f) => f.id.includes('Adreno 740'));
		assert.equal(light?.severity, 'low', '0.04 ms × 34 bodies = 1.4 ms: 8%');
		assert.ok(!fs.some((f) => f.id.includes('Mali-G57')), 'under 4 bodies: not judged');
		assert.ok(fs.every((f) => f.estimate === null && f.owner.id === 'arcade-games'));
	};
	const atTheMean: Rule = (ctx) =>
		RULES.bodyCost({
			...ctx,
			readingFacts: mapArcade(ctx.readingFacts, (a) => {
				const bodies = a.play?.work.bodies;
				return {
					...a,
					play: a.play && {
						...a.play,
						work: { ...a.play.work, bodies: bodies ? { ...bodies, max: bodies.mean } : null },
					},
				};
			}),
		});
	holds('bodyCost', check, RULES.bodyCost, atTheMean);
});

test('15. patch stutter: room states arriving late in play, online only', () => {
	const check = (rule: Rule) => {
		const ctx = ctxOf({
			readings: [
				arcadeItem('jitter'),
				arcadeItem('steady', { gpu: 'Adreno 740' }),
				arcadeItem('local', { gpu: 'Mali-G57' }),
			],
			readingFacts: new Map([
				[
					'jitter',
					arcadeFacts({
						online: true,
						patchHz: 20,
						playLate: lateness(600, 45, 120),
						menuLate: lateness(20, 5, 9),
						play: { patchBytes: mm(150, 900), netMs: mm(2.5, 9) },
					}),
				],
				[
					'steady',
					arcadeFacts({
						online: true,
						patchHz: 20,
						playLate: lateness(600, 8, 15),
						menuLate: lateness(40, 80, 200),
					}),
				],
				['local', arcadeFacts({ playLate: lateness(0, 0, 0) })],
			]),
		});
		const fs = rule(ctx);
		assert.equal(fs.length, 1, 'a late lobby is not play; an offline game has no room');
		const f = fs[0];
		assert.match(f.title, /^Room patches up to 45 ms late on phone · Mali-G52 MC2$/);
		assert.equal(f.severity, 'low', '45 ms: past half the 50 ms period, under a whole one');
		assert.ok(f.detail[0].includes('motion stutters while fps holds'));
		assert.ok(
			f.detail.some((d) => d.startsWith('8.5 KB a second')),
			'150 bytes × 58 fps',
		);
		assert.ok(f.detail.some((d) => d.includes('takes 2.5 ms a frame')));
		assert.deepEqual([f.estimate, f.owner.id], [null, 'arcade-games']);
		const whole = rule(
			ctxOf({
				readings: [arcadeItem('w')],
				readingFacts: new Map([
					['w', arcadeFacts({ online: true, patchHz: 20, playLate: lateness(600, 60, 140) })],
				]),
			}),
		);
		assert.equal(whole[0]?.severity, 'medium', 'a whole patch period late');
	};
	const menuLateness: Rule = (ctx) =>
		RULES.patchStutter({ ...ctx, readingFacts: swapMenuPlay(ctx.readingFacts) });
	holds('patchStutter', check, RULES.patchStutter, menuLateness);
});

test('16. Compare puts arcade readings side by side, menu and play with their sim counts', () => {
	const c = (simMs: number, bodies: number): PerfCounts => ({
		idle: null,
		spinning: null,
		menu: null,
		play: {
			frames: 1800,
			draws: 40,
			passes: 1,
			textureUploads: 0,
			calls: 120,
			jsMs: 7,
			simSteps: 1.1,
			simMs,
			bodies,
			netMs: 0,
			patches: 0,
			patchBytes: 0,
		},
		textureMb: 12,
	});
	const rows = compareReadings(
		arcadeItem('a', { counts: c(2.4, 22) }),
		arcadeItem('b', { play: phase(1800, 50), counts: c(3.1, 30) }),
	);
	const get = (group: string, label: string) =>
		rows.find((r) => r.group === group && r.label === label);
	assert.deepEqual(
		[...new Set(rows.map((r) => r.group))],
		['menu', 'play', 'play per frame', 'memory'],
		'no slot phase on an arcade pair',
	);
	assert.equal(get('play', 'fps')?.delta, -8);
	assert.equal(get('play per frame', 'sim ms')?.delta, 0.7);
	assert.equal(get('play per frame', 'draws')?.delta, 0);
	assert.equal(get('play per frame', 'bodies')?.better, 'none', 'a level, not better or worse');
});

// ── 16. The list ──

test('16. ranked by severity, then saving on one scale, unmeasured last', () => {
	const f = (
		id: string,
		severity: Finding['severity'],
		estimate: Finding['estimate'],
	): Finding => ({
		id,
		rule: 'textures',
		severity,
		title: id,
		detail: [],
		evidence: [],
		estimate,
		owner: { kind: 'agent', id: 'x', label: 'x' },
		deviceClass: null,
		gameKey: null,
	});
	const ranked = rankFindings([
		f('low', 'low', { value: 50, unit: 'fps', basis: '' }),
		f('unmeasured', 'medium', null),
		f('3MB', 'medium', { value: 3, unit: 'MB', basis: '' }),
		f('6fps', 'medium', { value: 6, unit: 'fps', basis: '' }),
		f('high', 'high', null),
	]);
	assert.deepEqual(
		ranked.map((x) => x.id),
		['high', '3MB', '6fps', 'unmeasured', 'low'],
		'3 MB of a 25 MB budget outranks 6 of 60 fps',
	);
});

test('16. every rule runs on an empty project; each owner is an agent owners.json knows', () => {
	assert.deepEqual(findings(ctxOf()), []);
	const agents = new Set([...Object.values(OWNERS.tools), ...Object.values(OWNERS.kinds)].flat());
	agents.add('engine-pixi-svelte');
	const all = findings(
		ctxOf({
			readings: [reading('s', { spinning: phase(300, 30), textureMb: 200 })],
			builds: [build('b', { unreferencedBytes: MB })],
		}),
	);
	assert.ok(all.length >= 3);
	for (const x of all) if (x.owner.kind === 'agent') assert.ok(agents.has(x.owner.id), x.owner.id);
});

test('16. Compare puts two readings side by side with B − A', () => {
	const rows = compareReadings(
		reading('a', { spinning: phase(300, 45, 30), counts: counts(90) }),
		reading('b', { spinning: phase(300, 53, 21), counts: counts(60), round: null }),
	);
	const get = (group: string, label: string) =>
		rows.find((r) => r.group === group && r.label === label);
	assert.deepEqual([get('spinning', 'fps')?.delta, get('spinning', 'p95 ms')?.delta], [8, -9]);
	assert.equal(get('spinning per frame', 'draws')?.delta, -30);
	assert.deepEqual(
		[get('round', 'fps')?.a, get('round', 'fps')?.b, get('round', 'fps')?.delta],
		[58, null, null],
	);
	assert.equal(get('memory', 'texture MB')?.delta, 0);
});
