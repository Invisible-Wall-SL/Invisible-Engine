/**
 * Contract check for Invisible Director costs and the run budget (ADR-0006):
 *   pnpm --filter launcher-api check:director-costs
 *
 * Runs the REAL modules: the pure pricing arithmetic over the real `pricing.json`, the
 * override loader, the budget reader, the Anthropic (agents) collector and the monthly
 * rollup. Only the database is replaced, by a fake whose reads answer per table and can be
 * made to throw — so "degrades on a DB error" is exercised, not assumed.
 */
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { getTableName, type Table } from 'drizzle-orm';

let settings: Record<string, string> = {};
let spendRows: Record<string, unknown>[] = [];
let dbDown = false;

/** A chainable stand-in for Drizzle's select builder; awaiting it answers by table. */
function selectBuilder(): PromiseLike<unknown[]> & Record<string, unknown> {
	let table = '';
	const builder = {
		from(t: Table) {
			table = getTableName(t);
			return builder;
		},
		where: () => builder,
		groupBy: () => builder,
		orderBy: () => builder,
		limit: () => builder,
		then<T>(resolve: (rows: unknown[]) => T, reject: (err: unknown) => T) {
			if (dbDown) return Promise.reject(new Error('relation does not exist')).then(resolve, reject);
			if (table === 'app_settings') {
				// Each test stores at most the one key the reader under test asks for.
				const rows = Object.values(settings).map((value) => ({ value }));
				return Promise.resolve(rows).then(resolve, reject);
			}
			if (table === 'director_spend') return Promise.resolve(spendRows).then(resolve, reject);
			return Promise.reject(new Error(`unexpected table ${table}`)).then(resolve, reject);
		},
	};
	return builder;
}

const server = (path: string): string => new URL(`../src/lib/server/${path}`, import.meta.url).href;
mock.module(server('db/index.ts'), { namedExports: { getDb: () => ({ select: selectBuilder }) } });

const { costOfUsage, costOfRunpodJob, mergePricing, parsePricing, pricingRate } =
	await import('../src/lib/server/costs/directorPricing.ts');
const { FILE_PRICING, getDirectorPricing } =
	await import('../src/lib/server/costs/pricingConfig.ts');
const {
	clampDirectorBudget,
	DIRECTOR_PRICING_OVERRIDE_KEY,
	DIRECTOR_RUN_BUDGET_DEFAULT_USD,
	DIRECTOR_RUN_BUDGET_KEY,
	DIRECTOR_RUN_BUDGET_MAX_USD,
	DIRECTOR_RUN_BUDGET_MIN_USD,
	getDirectorRunBudget,
} = await import('../src/lib/server/appSettings.ts');
const { collectAnthropicAgents } = await import('../src/lib/server/costs/anthropicAgents.ts');
const { summarize } = await import('../src/lib/server/costs/months.ts');

function reset(): void {
	settings = {};
	spendRows = [];
	dbDown = false;
}

const close = (actual: number, expected: number): void =>
	assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test('pricing.json carries the ADR-0006 prices', () => {
	assert.deepEqual(FILE_PRICING.perMTok['claude-opus-5-5'], { input: 4, output: 20 });
	assert.deepEqual(FILE_PRICING.perMTok['claude-sonnet-5-5'], { input: 2, output: 10 });
	assert.deepEqual(FILE_PRICING.perMTok['claude-haiku-4-5-20251001'], { input: 1, output: 5 });
	assert.equal(FILE_PRICING.cacheReadMultiplier, 0.1);
	assert.equal(FILE_PRICING.cacheWriteMultiplier, 1.25);
	assert.equal(FILE_PRICING.runpod.placeholder, true, 'RunPod $/s stays marked until confirmed');
});

test('costOfUsage: a sample usage, cache reads at 0.1× and writes at 1.25× of input', () => {
	const usage = {
		input_tokens: 2_000,
		output_tokens: 1_000,
		cache_read_input_tokens: 100_000,
		cache_creation_input_tokens: 10_000,
	};
	// Sonnet: 2000×2 + 100000×2×0.1 + 10000×2×1.25 + 1000×10 = 4000 + 20000 + 25000 + 10000
	close(costOfUsage('claude-sonnet-5-5', usage, FILE_PRICING), 59_000 / 1_000_000);
	// The cache-read share alone is exactly a tenth of the same tokens uncached.
	const readOnly = costOfUsage(
		'claude-opus-5-5',
		{ cache_read_input_tokens: 1_000_000 },
		FILE_PRICING,
	);
	const uncached = costOfUsage('claude-opus-5-5', { input_tokens: 1_000_000 }, FILE_PRICING);
	close(readOnly, 0.4);
	close(readOnly, uncached * 0.1);
	close(costOfUsage('claude-haiku-4-5-20251001', { output_tokens: 1_000_000 }, FILE_PRICING), 5);
	close(costOfUsage('claude-opus-5-5', {}, FILE_PRICING), 0);
	close(costOfUsage('claude-opus-5-5', { input_tokens: null }, FILE_PRICING), 0);
});

test('costOfUsage: an unknown model throws instead of guessing', () => {
	assert.throws(() => costOfUsage('claude-opus-9', { input_tokens: 1 }, FILE_PRICING), /no price/);
	assert.throws(() => costOfUsage('toString', { input_tokens: 1 }, FILE_PRICING), /no price/);
	assert.throws(
		() => costOfUsage('claude-opus-5-5', { input_tokens: -1 }, FILE_PRICING),
		/must be ≥ 0/,
	);
});

test('costOfRunpodJob: execution seconds × the GPU rate; unknown GPU throws', () => {
	const [gpu, rate] = Object.entries(FILE_PRICING.runpod.perSecondByGpu)[0];
	close(costOfRunpodJob(gpu, 120, FILE_PRICING), 120 * rate);
	assert.throws(() => costOfRunpodJob('TPU v9', 1, FILE_PRICING), /no RunPod price/);
});

test("pricingRate: the named GPU's $/s, else null (no GPU, no price, never a prototype key)", () => {
	const [gpu, rate] = Object.entries(FILE_PRICING.runpod.perSecondByGpu)[0];
	assert.equal(pricingRate(FILE_PRICING, { gpu }), rate);
	assert.equal(pricingRate(FILE_PRICING, { gpu: 'TPU v9' }), null);
	assert.equal(pricingRate(FILE_PRICING, { gpu: '' }), null);
	assert.equal(pricingRate(FILE_PRICING, { gpu: 'toString' }), null);
});

test('parsePricing / mergePricing reject bad documents and merge partial overrides', () => {
	assert.throws(() => parsePricing({ ...FILE_PRICING, currency: 'EUR' }), /currency/);
	assert.throws(() => parsePricing({ ...FILE_PRICING, cacheReadMultiplier: -1 }), /cacheRead/);

	const merged = mergePricing(FILE_PRICING, {
		perMTok: { 'claude-opus-5-5': { output: 18 }, 'claude-new': { input: 3, output: 15 } },
		cacheReadMultiplier: 0.2,
	});
	assert.deepEqual(merged.perMTok['claude-opus-5-5'], { input: 4, output: 18 });
	assert.deepEqual(merged.perMTok['claude-new'], { input: 3, output: 15 });
	assert.equal(merged.cacheReadMultiplier, 0.2);
	assert.equal(merged.cacheWriteMultiplier, 1.25);
	assert.deepEqual(
		FILE_PRICING.perMTok['claude-opus-5-5'],
		{ input: 4, output: 20 },
		'file untouched',
	);

	assert.throws(
		() => mergePricing(FILE_PRICING, { perMTok: { 'claude-new': { input: 3 } } }),
		/output/,
	);
	assert.throws(() => mergePricing(FILE_PRICING, []), /JSON object/);
	const proto = mergePricing(
		FILE_PRICING,
		JSON.parse('{"perMTok":{"__proto__":{"input":1,"output":1}}}'),
	);
	assert.equal(Object.getPrototypeOf(proto.perMTok), Object.prototype, 'prototype untouched');
	assert.ok(Object.hasOwn(proto.perMTok, '__proto__'), 'stored as a plain key');
	assert.throws(() => mergePricing(FILE_PRICING, { cacheWriteMultiplier: 'x' }), /cacheWrite/);
});

test('getDirectorPricing: file, override, and degrade on a bad override or a DB error', async () => {
	reset();
	assert.equal((await getDirectorPricing()).source, 'file');

	settings = { [DIRECTOR_PRICING_OVERRIDE_KEY]: '{"perMTok":{"claude-opus-5-5":{"input":3}}}' };
	const over = await getDirectorPricing();
	assert.equal(over.source, 'override');
	assert.equal(over.pricing.perMTok['claude-opus-5-5'].input, 3);

	settings = { [DIRECTOR_PRICING_OVERRIDE_KEY]: '{not json' };
	const bad = await getDirectorPricing();
	assert.equal(bad.source, 'file');
	assert.ok(bad.overrideError);
	assert.equal(bad.pricing, FILE_PRICING);

	dbDown = true;
	const down = await getDirectorPricing();
	assert.equal(down.source, 'file');
	assert.equal(down.pricing, FILE_PRICING);
});

test('getDirectorRunBudget: default 25, validated, clamped, degrades on a DB error', async () => {
	reset();
	assert.equal(DIRECTOR_RUN_BUDGET_DEFAULT_USD, 25);
	assert.equal(await getDirectorRunBudget(), 25, 'unset → default');

	const cases: [string, number][] = [
		['40', 40],
		['12.345', 12.35],
		['0.2', DIRECTOR_RUN_BUDGET_MIN_USD],
		['99999', DIRECTOR_RUN_BUDGET_MAX_USD],
		['abc', 25],
		['-5', 25],
		['0', 25],
		['  ', 25],
		['Infinity', 25],
	];
	for (const [raw, expected] of cases) {
		settings = { [DIRECTOR_RUN_BUDGET_KEY]: raw };
		assert.equal(await getDirectorRunBudget(), expected, `stored ${JSON.stringify(raw)}`);
	}

	dbDown = true;
	assert.equal(await getDirectorRunBudget(), 25, 'DB error → default, never "no cap"');

	assert.equal(clampDirectorBudget(Number.NaN), null);
	assert.equal(clampDirectorBudget(30), 30);
});

test('Anthropic (agents) collector: a real $0 card on an empty ledger', async () => {
	reset();
	const card = await collectAnthropicAgents(new Date('2026-10-01T00:00:00+02:00'));
	assert.equal(card.id, 'anthropicAgents');
	assert.equal(card.configured, true);
	assert.equal(card.ok, true);
	assert.equal(card.spendUsd, 0);
	assert.equal(card.includedIn, 'anthropic');
	assert.deepEqual(card.sections, []);
});

test('Anthropic (agents) collector: by-agent total and top runs', async () => {
	reset();
	spendRows = [
		{ agent: 'atlas-artist', runId: 'run_a', usd: 1.5, calls: 3 },
		{ agent: 'qa', runId: 'run_b', usd: 0.25, calls: 1 },
	];
	const card = await collectAnthropicAgents(new Date('2026-10-01T00:00:00+02:00'));
	close(card.spendUsd ?? NaN, 1.75);
	assert.deepEqual(
		card.sections?.map((s) => s.title),
		['By agent', 'Top runs'],
	);
	assert.equal(card.sections?.[0].lines[0].detail, '3 calls');
	assert.equal(card.sections?.[1].lines[1].detail, '1 call');
});

test('monthly rollup: agent spend is not counted twice when Anthropic reports', () => {
	const row = (provider: string, month: number, amountUsd: number) => ({
		provider: provider as 'anthropic',
		year: 2026,
		month,
		amountUsd,
		manual: false,
		eur: null,
		locked: false,
		note: null,
	});
	const [year] = summarize([
		row('anthropic', 10, 30),
		row('anthropicAgents', 10, 12),
		row('runpod', 10, 5),
		row('anthropicAgents', 9, 7),
		row('runpod', 9, 2),
	]);
	const oct = year.months.find((m) => m.month === 10)!;
	const sep = year.months.find((m) => m.month === 9)!;
	assert.equal(oct.byProvider.anthropicAgents, 12, 'the column still shows it');
	assert.equal(oct.totalUsd, 35, 'inside Anthropic → not added again');
	assert.equal(sep.totalUsd, 9, 'no Anthropic figure → counted');
	assert.equal(year.totalUsd, 44);
});
