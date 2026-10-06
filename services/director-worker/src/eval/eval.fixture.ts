/**
 * The agent evaluation (PLAN 5.4; ADR-0007 "Agents tab"):
 *
 *   pnpm --filter director-worker check:agent-eval
 *
 * The REAL `scoreBreakdown`, `evalItems`, `runAgentEval`, `referenceAdapters`, `parseEvalReport`
 * and `evalLine` run over the reference set in `docs/director/eval/mockups/`; the model is a fake
 * `VisionTransport` that answers each image from `reference.json`'s canned analyst output (through
 * the real answer parser, as `analyze.fixture.ts`'s does), with a controllable `usage` per call and
 * an optional failure per call. No SDK, no key, no network.
 *
 * Pinned, the scorer (pure):
 *  - the expected breakdown scores 1 / 1 / 1 against itself, nothing extra, every item found;
 *  - one status flipped: the status agreement drops by 1/13, and that item alone is `changed`;
 *    one element's regions halved: its region score is the Jaccard, the mean moves with it; a
 *    region set is a set (order and repeats do not matter, an extra region costs);
 *  - a box moved far (IoU < 0.3) is not found and its actual counts as extra; moved slightly it
 *    still pairs, and the 0.3 line is exact (IoU 0.3008 pairs, 0.2987 does not);
 *  - two actual elements over one expected pair the best one only, wherever it sits in the list; an
 *    actual serves one expected element only; names, numbers and order never matter;
 *  - an image missing from the actual breakdown fails every element of it; a style reference
 *    contributes no items and no extras; an empty expected set scores 1; `viewKey`; `evalItems`
 *    with a side that did not run gives null views and no `changed`; nothing is mutated and two
 *    calls give identical JSON.
 *
 * Pinned, `runAgentEval`:
 *  - scored: before = after = the real `mockup-analyst.md` is 4 calls, 1 → 1, the cost the sum of
 *    `costOfUsage` at the model that answered (cache tokens included, a refusal fallback's declined
 *    attempt too: the spend ledger's arithmetic), the set and the line; each side is priced at its
 *    own model; the report round-trips through `parseEvalReport` byte-equal;
 *  - a degraded "after" marks exactly the changed item and scores lower; a new agent has no
 *    "before" and the line says so; a "main" the loader refuses is a note, not a failure;
 *  - an invalid edit (the loader's errors, a priced model with no request profile, another agent's
 *    name) and an agent with no reference set never ask the factory for a model;
 *  - the cap, in code: the response that carries the total past it is the last and the run is
 *    `capped` naming where it stopped; a total equal to the cap refuses the next call before it is
 *    made; a cap of 0 makes no call; one huge response caps after call 1; a failed call is billed
 *    when the API billed it; a total exactly at the cap on the last call is still `scored`;
 *  - an API failure is `error` naming the side, the side that finished stays reported; a key-shaped
 *    string never reaches a report; `evalLine` for every result, the 140-character cut exactly;
 *  - every report any case produced passes the launcher's reader, which refuses what is malformed.
 */
import {
	costOfResponse,
	costOfUsage,
	parsePricing,
	type ClaudeResponseUsage,
} from 'director-costs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseAgent, pricedModels, type AgentCatalog } from '../agents.ts';
import type { Breakdown } from '../mockups/analyze.ts';
import type { AnalystOutput } from '../mockups/schema.ts';
import {
	readAnswerText,
	summarizeUsage,
	VisionError,
	type BilledResponse,
	type VisionRequest,
	type VisionTransport,
} from '../mockups/vision.ts';
import { KNOWN_TOOLS } from '../tools.ts';
import { expectedBreakdown } from './mockupSet.ts';
import {
	EVAL_CAP_USD,
	EVAL_REPORT_VERSION,
	evalLine,
	evalPasses,
	parseEvalReport,
	type EvalItem,
	type EvalReport,
	type EvalResult,
} from './report.ts';
import { runAgentEval, type EvalInput } from './run.ts';
import { evalItems, MATCH_IOU, scoreBreakdown, viewKey } from './score.ts';

const root = (rel: string) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));
const EVAL = root('../../docs/director/eval/mockups/');

let failures = 0;
let checks = 0;
const check = (ok: boolean, msg: string, extra = '') => {
	checks++;
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${ok ? '' : ` — ${extra}`}`);
	if (!ok) failures++;
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const throws = (fn: () => unknown): string => {
	try {
		fn();
		return '';
	} catch (error) {
		return (error as Error).message;
	}
};
const json = (value: unknown) => JSON.stringify(value);

// ── The scorer ────────────────────────────────────────────────────────────────

const expected = expectedBreakdown();
const scoredImages = expected.images.filter((image) => !image.styleOnly);
const imageOf = (b: Breakdown, file: string) => b.images.find((i) => i.file === file)!;
const elementOf = (b: Breakdown, file: string, n: number) =>
	imageOf(b, file).elements.find((e) => e.n === n)!;
/** A copy of the expected breakdown with `change` applied: the "actual" a case scores. */
const edit = (change: (b: Breakdown) => void): Breakdown => {
	const b = structuredClone(expected);
	change(b);
	return b;
};
const changedKeys = (items: EvalItem[]) =>
	items.filter((i) => i.changed).map((i) => viewKey(i.image, i.n));
const BASE = 'base-game.png';
const WIN = 'big-win.png';
const STYLE = 'style-reference.jpg';

console.log('scorer: the reference set');
{
	const elements = scoredImages.reduce((sum, image) => sum + image.elements.length, 0);
	check(
		scoredImages.length === 2 && elements === 13,
		'the expected set is 2 scored images with 13 elements (the figures below are 1/13s)',
		`${scoredImages.length} images, ${elements} elements`,
	);
	check(MATCH_IOU === 0.3, 'two boxes are one element at an overlap of 0.3', String(MATCH_IOU));
}

console.log('scorer: the expected breakdown against itself');
{
	const same = scoreBreakdown(expected, expected);
	check(
		same.score === 1 && same.statusAgreement === 1 && same.regionAgreement === 1,
		'scores 1 / 1 / 1',
		json({ ...same, views: undefined }),
	);
	check(same.extraElements === 0, '…with 0 extra elements', String(same.extraElements));
	const views = [...same.views.values()];
	check(
		views.length === 13 &&
			views.every((v) => v.found && v.statusMatch && v.regionScore === 1 && v.name !== null),
		'…and every one of the 13 elements found, status matching, region score 1',
		json(views.filter((v) => !(v.found && v.statusMatch && v.regionScore === 1))),
	);
	const items = evalItems(expected, expected, expected);
	check(
		items.length === 13 &&
			changedKeys(items).length === 0 &&
			items.every((i) => i.before?.found && i.after?.found),
		'evalItems of expected, expected, expected: 13 items, both sides found, none changed',
		String(items.length),
	);
	const logo = items.find((i) => i.image === BASE && i.n === 1)!;
	const base = elementOf(expected, BASE, 1);
	check(
		logo.name === base.name &&
			logo.expected.status === base.status &&
			json(logo.expected.regions) === json(base.regions),
		'…each item carrying the expected element’s name, status and regions',
		json(logo),
	);
}

console.log('scorer: a status flipped');
{
	const flipped = edit((b) => {
		elementOf(b, BASE, 1).status = 'needs_you';
	});
	const s = scoreBreakdown(expected, flipped);
	check(
		near(1 - s.statusAgreement, 1 / 13) && s.statusAgreement < 1,
		'the status agreement drops by 1/13',
		String(s.statusAgreement),
	);
	check(
		s.regionAgreement === 1 && s.extraElements === 0 && near(s.score, 1 - 0.5 / 13),
		'…the regions are untouched and the score drops by half of 1/13 (a status is half an element)',
		json({ ...s, views: undefined }),
	);
	const v = s.views.get(viewKey(BASE, 1))!;
	check(
		v.found && !v.statusMatch && v.status === 'needs_you' && v.regionScore === 1,
		'…the item is found, its status does not match, its regions do',
		json(v),
	);
	check(
		json(changedKeys(evalItems(expected, expected, flipped))) === json([viewKey(BASE, 1)]),
		'used as the "after", that item alone is changed',
		json(changedKeys(evalItems(expected, expected, flipped))),
	);
	check(
		changedKeys(evalItems(expected, flipped, flipped)).length === 0,
		'two sides that agree on it change nothing, however wrong they both are',
	);
}

console.log('scorer: regions halved, and regions as a set');
{
	const symbols = elementOf(expected, BASE, 4);
	const kept = symbols.regions.slice(0, Math.floor(symbols.regions.length / 2));
	const halved = edit((b) => {
		elementOf(b, BASE, 4).regions = [...kept];
	});
	const s = scoreBreakdown(expected, halved);
	const jaccard = kept.length / symbols.regions.length;
	const v = s.views.get(viewKey(BASE, 4))!;
	check(
		symbols.regions.length === 11 && kept.length === 5 && near(v.regionScore, 5 / 11),
		'the item’s region score is the Jaccard: 5 of the 11 symbol regions is 5/11',
		String(v.regionScore),
	);
	check(
		v.found && v.statusMatch && json(v.regions) === json(kept),
		'…still found, status still matching, and the view carries the regions it got',
		json(v),
	);
	check(
		s.statusAgreement === 1 && near(s.regionAgreement, (12 + jaccard) / 13),
		'the region agreement is the mean of the 13 region scores',
		String(s.regionAgreement),
	);
	check(
		near(s.score, 0.5 + 0.5 * s.regionAgreement) && s.score < 1,
		'…and the score moves by half the change (statuses all agree, so ½ + ½ × the region mean)',
		String(s.score),
	);
	check(
		json(changedKeys(evalItems(expected, expected, halved))) === json([viewKey(BASE, 4)]),
		'that item alone is changed',
	);

	const plaques = elementOf(expected, BASE, 2);
	const reordered = edit((b) => {
		const el = elementOf(b, BASE, 2);
		el.regions = [...plaques.regions].reverse().concat(plaques.regions[0]);
	});
	check(
		scoreBreakdown(expected, reordered).views.get(viewKey(BASE, 2))!.regionScore === 1 &&
			changedKeys(evalItems(expected, expected, reordered)).length === 0,
		'a region set is a set: another order and a repeat score 1 and change nothing',
	);
	const extra = edit((b) => {
		elementOf(b, BASE, 2).regions.push('NotInTheTemplate');
	});
	check(
		near(
			scoreBreakdown(expected, extra).views.get(viewKey(BASE, 2))!.regionScore,
			plaques.regions.length / (plaques.regions.length + 1),
		),
		'an extra region costs: 4 right of 5 listed is 4/5',
	);
	const fish = elementOf(expected, BASE, 6);
	const invented = edit((b) => {
		elementOf(b, BASE, 6).regions = ['Logo'];
	});
	check(
		fish.regions.length === 0 &&
			scoreBreakdown(expected, invented).views.get(viewKey(BASE, 6))!.regionScore === 0,
		'regions where none are expected score 0; none against none scored 1 above',
	);
}

console.log('scorer: where the boxes are');
{
	const logo = elementOf(expected, BASE, 1);
	const far = edit((b) => {
		elementOf(b, BASE, 1).box = { x: 0, y: 400, w: logo.box.w, h: logo.box.h };
	});
	const s = scoreBreakdown(expected, far);
	check(
		json(s.views.get(viewKey(BASE, 1))) ===
			json({
				found: false,
				name: null,
				status: null,
				regions: [],
				statusMatch: false,
				regionScore: 0,
			}),
		'a box moved far away (IoU 0) leaves its expected element not found',
		json(s.views.get(viewKey(BASE, 1))),
	);
	check(
		s.extraElements === 1 &&
			[...s.views.entries()].filter(([, v]) => !v.found).length === 1 &&
			near(s.statusAgreement, 12 / 13) &&
			near(s.regionAgreement, 12 / 13) &&
			near(s.score, 12 / 13),
		'…the moved one counts as 1 extra element, and the other 12 still pair: 12/13 on all three',
		json({ ...s, views: undefined }),
	);
	check(
		json(changedKeys(evalItems(expected, expected, far))) === json([viewKey(BASE, 1)]),
		'…and, as the "after", it is a changed item (found against not found)',
	);

	const near1 = edit((b) => {
		const el = elementOf(b, BASE, 1);
		el.box = { ...el.box, x: el.box.x + 40, y: el.box.y + 10 };
		el.name = 'Another name, another number';
		el.n = 77;
	});
	const n = scoreBreakdown(expected, near1);
	check(
		n.score === 1 && n.extraElements === 0 && n.views.get(viewKey(BASE, 1))!.found,
		'a box moved slightly (IoU 0.69) still pairs — whatever it is called or numbered',
		json({ ...n, views: undefined }),
	);
	check(
		changedKeys(evalItems(expected, expected, near1)).length === 0,
		'…and a box that moved is not a change: only status, regions and found are compared',
	);

	// Same-size boxes shifted by dx overlap by (w - dx) / (w + dx): 185/615 = 0.3008 and
	// 184/616 = 0.2987 for the logo's 400 px width, either side of the line.
	const shifted = (dx: number) =>
		scoreBreakdown(
			expected,
			edit((b) => {
				const el = elementOf(b, BASE, 1);
				el.box = { ...el.box, x: el.box.x + dx };
			}),
		);
	check(
		shifted(215).views.get(viewKey(BASE, 1))!.found && shifted(215).extraElements === 0,
		'an overlap of 0.3008 pairs',
	);
	check(
		!shifted(216).views.get(viewKey(BASE, 1))!.found && shifted(216).extraElements === 1,
		'an overlap of 0.2987 does not: that actual is extra',
	);
}

console.log('scorer: pairing');
{
	const banner = elementOf(expected, WIN, 1);
	const twin = (b: Breakdown) => ({
		...structuredClone(elementOf(b, WIN, 1)),
		n: 7,
		name: 'The banner, again',
		box: { ...banner.box, h: 150 },
		status: 'needs_you' as const,
		regions: [] as string[],
	});
	const first = edit((b) => imageOf(b, WIN).elements.unshift(twin(b)));
	const last = edit((b) => imageOf(b, WIN).elements.push(twin(b)));
	const a = scoreBreakdown(expected, first);
	const b = scoreBreakdown(expected, last);
	const v = a.views.get(viewKey(WIN, 1))!;
	check(
		a.score === 1 && a.extraElements === 1 && v.name === banner.name && v.status === 'matched',
		'two actual elements over one expected: the better overlap (IoU 1 over 0.75) pairs, the other is extra',
		json({ ...a, views: undefined, v }),
	);
	check(
		json([...a.views]) === json([...b.views]) && b.extraElements === 1,
		'…wherever the worse one sits in the list',
	);

	// The reel frame and the symbols grid overlap each other at 0.94; with only the frame listed,
	// the frame pairs with the frame and the grid has nothing left to pair with.
	const frameOnly = edit((b) => {
		const image = imageOf(b, BASE);
		image.elements = image.elements.filter((e) => e.n !== 4);
	});
	const f = scoreBreakdown(expected, frameOnly);
	check(
		f.views.get(viewKey(BASE, 3))!.found &&
			!f.views.get(viewKey(BASE, 4))!.found &&
			f.extraElements === 0,
		'an actual element serves one expected element: the frame is not also the grid it overlaps',
		json([f.views.get(viewKey(BASE, 3)), f.views.get(viewKey(BASE, 4))]),
	);

	const shuffled = edit((b) => {
		for (const image of b.images) {
			image.elements.reverse().forEach((el, i) => {
				el.n = i + 1;
				el.name = `Element ${i}`;
			});
		}
	});
	const sh = scoreBreakdown(expected, shuffled);
	check(
		sh.score === 1 &&
			sh.extraElements === 0 &&
			changedKeys(evalItems(expected, expected, shuffled)).length === 0,
		'order, names and numbers never matter: a reversed, renamed, renumbered breakdown scores 1',
		json({ ...sh, views: undefined }),
	);
}

console.log('scorer: images');
{
	const noWin = edit((b) => {
		b.images = b.images.filter((i) => i.file !== WIN);
	});
	const s = scoreBreakdown(expected, noWin);
	check(
		!s.views.get(viewKey(WIN, 1))!.found && !s.views.get(viewKey(WIN, 2))!.found,
		'an image missing from the actual breakdown: every expected element of it is not found',
	);
	check(
		s.extraElements === 0 && near(s.score, 11 / 13) && near(s.statusAgreement, 11 / 13),
		'…with nothing extra, the other 11 intact: 11/13',
		json({ ...s, views: undefined }),
	);
	check(
		json(changedKeys(evalItems(expected, expected, noWin))) ===
			json([viewKey(WIN, 1), viewKey(WIN, 2)]),
		'…and exactly those two items changed',
	);

	const styled = edit((b) => {
		imageOf(b, STYLE).elements.push({ ...structuredClone(elementOf(b, BASE, 1)), n: 1 });
	});
	const s2 = scoreBreakdown(expected, styled);
	check(
		s2.score === 1 && s2.extraElements === 0,
		'elements the actual lists on the style reference are ignored: it is left out of the score',
		json({ ...s2, views: undefined }),
	);
	const keys = [...s2.views.keys()];
	const items = evalItems(expected, expected, styled);
	check(
		keys.length === 13 &&
			!keys.some((k) => k.startsWith(STYLE)) &&
			items.length === 13 &&
			!items.some((i) => i.image === STYLE),
		'…the style reference has no view and no item',
		keys.join(),
	);
	check(
		json(keys) === json(items.map((i) => viewKey(i.image, i.n))),
		'the items are the views’ keys, in the expected order',
	);

	const none: Breakdown = { ...expected, images: [] };
	const noneS = scoreBreakdown(
		none,
		edit(() => {}),
	);
	check(
		noneS.score === 1 &&
			noneS.statusAgreement === 1 &&
			noneS.regionAgreement === 1 &&
			noneS.extraElements === 0 &&
			noneS.views.size === 0,
		'an empty expected set scores 1 (nothing expected, nothing missed), with no views',
		json({ ...noneS, views: undefined }),
	);
	const styleOnly: Breakdown = { ...expected, images: expected.images.filter((i) => i.styleOnly) };
	check(
		scoreBreakdown(styleOnly, expected).score === 1 &&
			evalItems(styleOnly, null, null).length === 0,
		'…and so does a set of only a style reference, which has no items',
	);
}

console.log('scorer: a side that did not run');
{
	const flipped = edit((b) => {
		elementOf(b, BASE, 1).status = 'needs_you';
	});
	const noBefore = evalItems(expected, null, flipped);
	check(
		noBefore.length === 13 &&
			noBefore.every((i) => i.before === null && i.after !== null && !i.changed),
		'a null "before": null views for it, the "after" viewed, nothing changed',
	);
	const noAfter = evalItems(expected, flipped, null);
	check(
		noAfter.length === 13 &&
			noAfter.every((i) => i.after === null && i.before !== null && !i.changed),
		'a null "after": null views for it, the "before" viewed, nothing changed',
	);
	const neither = evalItems(expected, null, null);
	check(
		neither.length === 13 &&
			neither.every((i) => i.before === null && i.after === null && !i.changed),
		'both null: 13 items with no views, none changed',
	);
	check(
		viewKey('base-game.png', 3) === 'base-game.png#3' && viewKey('x', 0) === 'x#0',
		'viewKey is the image’s file and the element’s number',
		viewKey('base-game.png', 3),
	);
}

console.log('scorer: pure and deterministic');
{
	const actual = edit((b) => {
		elementOf(b, BASE, 1).status = 'needs_you';
		elementOf(b, BASE, 4).regions = ['H1'];
		imageOf(b, WIN).elements.pop();
	});
	const before = json([expected, actual]);
	const one = scoreBreakdown(expected, actual);
	const two = scoreBreakdown(expected, actual);
	check(
		json({ ...one, views: [...one.views] }) === json({ ...two, views: [...two.views] }),
		'two calls give identical JSON',
	);
	check(
		json(evalItems(expected, expected, actual)) === json(evalItems(expected, expected, actual)),
		'…evalItems too',
	);
	check(json([expected, actual]) === before, 'neither breakdown is changed by scoring it');
	one.views.get(viewKey(BASE, 4))!.regions.push('Scribble');
	check(
		json(actual.images.find((i) => i.file === BASE)!.elements.find((e) => e.n === 4)!.regions) ===
			json(['H1']),
		'a view owns its regions: changing it does not reach the actual breakdown',
	);
}

// ── The fake model ────────────────────────────────────────────────────────────

interface Reference {
	images: { id: string; file: string }[];
	answers: Record<string, AnalystOutput>;
}
const reference = JSON.parse(readFileSync(`${EVAL}reference.json`, 'utf8')) as Reference;
const idOf = (file: string) => reference.images.find((i) => i.file === file)!.id;

type Side = 'before' | 'after';
type ApiUsage = ClaudeResponseUsage['usage'];
const usageOf = (input: number, output: number, extra: ApiUsage = {}): ApiUsage => ({
	input_tokens: input,
	output_tokens: output,
	cache_read_input_tokens: 0,
	cache_creation_input_tokens: 0,
	...extra,
});

/** The sentence an edited definition adds: how the fake tells the sides apart, by `request.system`. */
const EDIT_SENTENCE = 'When two plaques touch, count them as one element.';

interface FakeOptions {
	/** The API's usage for call `n` (1-based, across both sides). */
	usage?: (n: number) => ApiUsage;
	/** The model that answers call `n`, when it is not the one asked (a refusal fallback). */
	answeredBy?: (n: number) => string | undefined;
	/** Call `n` fails with this instead of answering; `billed` is the response it would carry. */
	fail?: (n: number, billed: BilledResponse) => Error | string | null | undefined;
	/** The canned answer to give for an image on a side, when it is not `reference.json`'s. */
	answer?: (side: Side, imageId: string) => AnalystOutput | undefined;
}

function fakeModel(options: FakeOptions = {}) {
	const requests: VisionRequest[] = [];
	const sides = () =>
		requests.map((r): Side => (r.system.includes(EDIT_SENTENCE) ? 'after' : 'before'));
	const transport: VisionTransport = {
		async analyze(request) {
			const n = requests.push(request);
			const side: Side = request.system.includes(EDIT_SENTENCE) ? 'after' : 'before';
			const usage = options.usage?.(n) ?? usageOf(1000, 400);
			const model = options.answeredBy?.(n) ?? request.model;
			const id = `vmsg_${n}`;
			const failure = options.fail?.(n, { id, model, usage });
			if (failure) throw failure;
			const canned =
				options.answer?.(side, request.image.id) ?? reference.answers[request.image.id];
			if (!canned) throw new Error('fixture: the transport got an image it does not know');
			// Through the real text parser, as the SDK transport does.
			const output = readAnswerText(JSON.stringify(canned));
			return { id, model, usage, usageSummary: summarizeUsage(usage), output };
		},
	};
	return { transport, requests, sides };
}

/** A model factory the evaluation must not call: it throws, and counts. */
function noModel() {
	const state = { calls: 0 };
	const factory = (): VisionTransport => {
		state.calls++;
		throw new Error('fixture: the model factory was called');
	};
	return { factory, state };
}

// ── The runner ────────────────────────────────────────────────────────────────

const MODEL = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';
const pricing = parsePricing(JSON.parse(readFileSync(root('pricing.json'), 'utf8')));
const catalog: AgentCatalog = { models: pricedModels(root('pricing.json')), tools: KNOWN_TOOLS };
/** A definition on another model: only the frontmatter's `model:` line is touched. */
const withModel = (text: string, model: string) => text.replace(/^model: .*$/m, `model: ${model}`);
const analystText = withModel(readFileSync(root('agents/mockup-analyst.md'), 'utf8'), MODEL);
const coordinatorText = readFileSync(root('agents/coordinator.md'), 'utf8');
const editedText = `${analystText.trimEnd()}\n\n${EDIT_SENTENCE}\n`;
const analyst = (() => {
	const parsed = parseAgent('mockup-analyst.md', analystText, catalog);
	if (!parsed.ok) throw new Error(`the shipped mockup-analyst does not load: ${parsed.errors}`);
	return parsed.agent;
})();
const loaderErrors = (text: string, file = 'mockup-analyst.md') => {
	const parsed = parseAgent(file, text, catalog);
	return parsed.ok ? [] : parsed.errors;
};
const callCost = costOfUsage(MODEL, usageOf(1000, 400), pricing);

const reports: EvalReport[] = [];
async function go(over: Partial<EvalInput> & Pick<EvalInput, 'model'>): Promise<EvalReport> {
	const report = await runAgentEval({
		agent: 'mockup-analyst',
		beforeText: analystText,
		afterText: analystText,
		headSha: 'h'.repeat(40),
		baseSha: 'b'.repeat(40),
		capUsd: EVAL_CAP_USD,
		pricing,
		catalog,
		...over,
	});
	reports.push(report);
	return report;
}
const allViewed = (r: EvalReport, side: Side) =>
	r.items.length === 13 && r.items.every((i) => i[side]?.found && i[side].statusMatch);

console.log('runner: scored');
{
	const fake = fakeModel();
	let factoryCalls = 0;
	const r = await go({
		model: () => {
			factoryCalls++;
			return fake.transport;
		},
	});
	check(
		r.result === 'scored' && !r.capped && r.errors.length === 0,
		'before = after = the real mockup-analyst text is scored, not capped, no errors',
		json({ result: r.result, errors: r.errors }),
	);
	check(
		callCost > 0 && fake.requests.length === 4 && r.before?.calls === 2 && r.after?.calls === 2,
		'two sides × two images = 4 calls (the style reference is never sent)',
		String(fake.requests.length),
	);
	check(
		fake.requests.every((q) => q.model === MODEL) &&
			json([...new Set(fake.requests.map((q) => q.image.id))].sort()) ===
				json([idOf(BASE), idOf(WIN)].sort()),
		'…each on the definition’s model, over the two non-style images',
	);
	check(factoryCalls === 1, 'the model factory is called once', String(factoryCalls));
	check(
		r.before?.score === 1 &&
			r.after?.score === 1 &&
			r.before.statusAgreement === 1 &&
			r.after.regionAgreement === 1 &&
			r.before.extraElements === 0 &&
			r.after.extraElements === 0,
		'both sides score 1 → 1 with nothing extra',
		json([r.before, r.after]),
	);
	check(
		near(r.costUsd, 4 * callCost) &&
			near(r.before!.costUsd, 2 * callCost) &&
			near(r.after!.costUsd, 2 * callCost),
		'costUsd is 4 × costOfUsage(1000 in / 400 out) at the analyst’s model, 2 × per side',
		`${r.costUsd} vs ${4 * callCost}`,
	);
	check(
		json(r.before!.usage) ===
			json({
				inputTokens: 2000,
				outputTokens: 800,
				cacheReadInputTokens: 0,
				cacheCreationInputTokens: 0,
			}),
		'each side’s usage is the sum of its calls',
		json(r.before!.usage),
	);
	check(
		json(r.before!.definition) === json({ model: analyst.model, effort: analyst.effort }) &&
			json(r.after!.definition) === json(r.before!.definition),
		'each side reports the definition it ran: model and effort',
		json(r.before!.definition),
	);
	check(
		json(r.set) === json({ name: 'mockups', images: 2, elements: 13 }),
		'the set is mockups: 2 images, 13 elements',
		json(r.set),
	);
	check(
		allViewed(r, 'before') && allViewed(r, 'after') && changedKeys(r.items).length === 0,
		'13 items, both sides found and matching on each, none changed',
	);
	check(
		/^mockup-analyst: 100% → 100% on 13 elements · \$0\.\d\d of \$20\.00$/.test(r.line),
		'the line reads 100% → 100% on 13 elements, the money spent of the cap',
		r.line,
	);
	check(evalPasses(r.result), 'a scored eval passes');
	check(
		r.version === EVAL_REPORT_VERSION &&
			r.agent === 'mockup-analyst' &&
			r.head.sha === 'h'.repeat(40) &&
			r.base.sha === 'b'.repeat(40) &&
			r.capUsd === EVAL_CAP_USD,
		'the report echoes the agent, the two commits and the cap',
	);
	check(
		json(parseEvalReport(JSON.parse(json(r)))) === json(r),
		'the report round-trips through parseEvalReport byte-equal',
	);
}

console.log('runner: what each call is billed at');
{
	const sonnet = costOfUsage(SONNET, usageOf(1000, 400), pricing);
	const fallback = await go({
		model: fakeModel({ answeredBy: () => SONNET }).transport,
	});
	check(
		near(fallback.costUsd, 4 * sonnet) && sonnet !== callCost,
		'a response is billed at the model that answered, not the one asked (a refusal fallback)',
		`${fallback.costUsd} vs ${4 * sonnet}`,
	);

	const fake = fakeModel();
	const mixed = await go({ model: fake.transport, afterText: withModel(editedText, SONNET) });
	check(
		json(fake.requests.map((q) => q.model)) === json([MODEL, MODEL, SONNET, SONNET]) &&
			mixed.after?.definition.model === SONNET &&
			mixed.before?.definition.model === MODEL,
		'each side runs its own definition’s model, the "before" first',
		json(fake.requests.map((q) => q.model)),
	);
	check(
		near(mixed.before!.costUsd, 2 * callCost) &&
			near(mixed.after!.costUsd, 2 * sonnet) &&
			near(mixed.costUsd, 2 * callCost + 2 * sonnet),
		'…and is priced at its own model’s rate',
		json([mixed.before?.costUsd, mixed.after?.costUsd, mixed.costUsd]),
	);

	const cached = usageOf(100, 50, {
		cache_read_input_tokens: 5000,
		cache_creation_input_tokens: 700,
	});
	const withCache = await go({ model: fakeModel({ usage: () => cached }).transport });
	check(
		near(withCache.costUsd, 4 * costOfUsage(MODEL, cached, pricing)) &&
			withCache.costUsd > 4 * costOfUsage(MODEL, usageOf(100, 50), pricing) &&
			withCache.before?.usage.cacheReadInputTokens === 10_000 &&
			withCache.before.usage.cacheCreationInputTokens === 1_400,
		'cache reads and writes are billed at their rates and counted in the side’s usage',
		String(withCache.costUsd),
	);

	// A refusal fallback's response: the top level is the answering attempt, `iterations` is every
	// attempt the API billed, the declined one at its own model's price (the spend ledger prices it
	// with costOfResponse). The cap must see the same money.
	const declined: ApiUsage = {
		...usageOf(1000, 400),
		iterations: [
			{ type: 'message', model: MODEL, ...usageOf(1000, 60) },
			{ type: 'message', model: null, ...usageOf(1000, 400) },
		],
	};
	const ledger = costOfResponse({ model: SONNET, usage: declined }, pricing).usd;
	const rerouted = await go({
		model: fakeModel({ usage: () => declined, answeredBy: () => SONNET }).transport,
	});
	check(
		ledger > sonnet && near(rerouted.costUsd, 4 * ledger),
		'a response with a declined attempt is billed as the spend ledger bills it, the declined one too',
		`${rerouted.costUsd} vs ${4 * ledger} (top level alone: ${4 * sonnet})`,
	);
}

console.log('runner: an edited "after"');
{
	const fake = fakeModel({
		answer: (side, imageId) => {
			if (side !== 'after' || imageId !== idOf(BASE)) return undefined;
			const answer = structuredClone(reference.answers[imageId]);
			answer.elements.find((e) => e.n === 1)!.status = 'needs_you';
			return answer;
		},
	});
	const r = await go({ model: fake.transport, afterText: editedText });
	check(
		json(fake.sides()) === json(['before', 'before', 'after', 'after']),
		'the "before" runs first on main’s prompt, then the "after" on the edited one',
		json(fake.sides()),
	);
	check(
		r.result === 'scored' && r.before?.score === 1 && near(r.after!.score, 12 / 13),
		'the "after" that calls the logo needs_you scores 12/13, the "before" 1',
		json([r.before?.score, r.after?.score]),
	);
	check(
		json(changedKeys(r.items)) === json([viewKey(BASE, 1)]),
		'exactly that item is changed',
		json(changedKeys(r.items)),
	);
	const item = r.items.find((i) => i.changed)!;
	check(
		item.before?.status === 'matched' &&
			item.before.statusMatch &&
			item.after?.status === 'needs_you' &&
			!item.after.statusMatch &&
			item.after.regionScore === 0 &&
			item.expected.status === 'matched',
		'…matched before, needs_you after (code gives a needs_you no regions), against matched expected',
		json(item),
	);
	check(
		r.after!.statusAgreement < 1 && r.after!.regionAgreement < 1 && r.after!.extraElements === 0,
		'…and the side’s agreements drop with it',
		json(r.after),
	);
	check(
		new RegExp(`^mockup-analyst: 100% → ${Math.round((12 / 13) * 100)}% on 13 elements`).test(
			r.line,
		),
		'the line shows the drop',
		r.line,
	);
}

console.log('runner: a new agent, and a main that does not load');
{
	const fake = fakeModel();
	const r = await go({ model: fake.transport, beforeText: null });
	check(
		r.result === 'scored' && r.before === null && r.after?.score === 1 && r.after.calls === 2,
		'no usable definition on main: no "before", the "after" scored with 2 calls',
		json({ result: r.result, before: r.before, calls: r.after?.calls }),
	);
	check(fake.requests.length === 2, 'only 2 calls are made', String(fake.requests.length));
	check(
		r.errors.length === 0 &&
			r.items.length === 13 &&
			r.items.every((i) => i.before === null && i.after?.found && !i.changed),
		'…no error, every item has a null "before" and is not changed',
	);
	check(
		/^mockup-analyst: no usable definition on main → 100% on 13 elements · \$0\.\d\d of \$20\.00$/.test(
			r.line,
		),
		'the line says "no usable definition on main"',
		r.line,
	);
	check(near(r.costUsd, 2 * callCost), 'the cost is the 2 calls', String(r.costUsd));

	const note = `main's definition fails the loader, so there is no "before" run: `;
	const mains: [string, string, string][] = [
		[
			'text that is not a definition',
			'not a definition',
			loaderErrors('not a definition').join('; '),
		],
		[
			'a priced model with no request profile',
			withModel(analystText, 'claude-opus-5'),
			'no request profile for model claude-opus-5 (src/model.ts)',
		],
	];
	for (const [what, text, reason] of mains) {
		const run = fakeModel();
		const m = await go({ model: run.transport, beforeText: text });
		check(
			m.result === 'scored' &&
				m.before === null &&
				m.after?.score === 1 &&
				run.requests.length === 2,
			`main's definition is ${what}: no "before" run, the "after" still scored`,
			json({ result: m.result, before: m.before }),
		);
		check(
			json(m.errors) === json([`${note}${reason}`]),
			'…and errors carries one note saying why, with the loader’s own words',
			json(m.errors),
		);
		check(
			evalPasses(m.result) && /^mockup-analyst: no usable definition on main → 100% /.test(m.line),
			'…it passes, and the line says there was nothing to compare with',
			m.line,
		);
	}
}

console.log('runner: an edit the loader refuses');
{
	const noModelCalls = noModel();
	const refused = async (
		what: string,
		over: Partial<EvalInput>,
		wanted: (e: string[]) => boolean,
	) => {
		const r = await go({ model: noModelCalls.factory, ...over });
		check(
			r.result === 'invalid' &&
				wanted(r.errors) &&
				!r.capped &&
				r.costUsd === 0 &&
				r.set === null &&
				r.before === null &&
				r.after === null &&
				r.items.length === 0,
			`${what}: invalid, the loader's errors, nothing ran or was spent`,
			json({ result: r.result, errors: r.errors, costUsd: r.costUsd }),
		);
		check(
			!evalPasses(r.result) &&
				r.line === `${r.agent}: the edited definition fails the loader — ${r.errors[0]}`,
			'…it fails, and the line carries the first error',
			r.line,
		);
		return r;
	};
	const garbage = 'not a definition\n';
	await refused(
		'text that is not a definition',
		{ afterText: garbage },
		(e) => json(e) === json(loaderErrors(garbage)),
	);
	const unpriced = withModel(analystText, 'nope');
	await refused(
		'a model pricing.json does not price',
		{ afterText: unpriced },
		(e) => json(e) === json(['model: nope is not in pricing.json']),
	);
	const twice = withModel(analystText, 'nope').replace('tools:\n', 'tools:\n  - nope.op\n');
	await refused(
		'two problems',
		{ afterText: twice },
		(e) => e.length === 2 && json(e) === json(loaderErrors(twice)),
	);
	const noProfile = await refused(
		'a priced model with no request profile (claude-opus-5)',
		{ afterText: withModel(analystText, 'claude-opus-5') },
		(e) =>
			e.length === 1 && /no request profile for model claude-opus-5 \(src\/model\.ts\)/.test(e[0]),
	);
	check(
		/no request profile for model claude-opus-5/.test(noProfile.line),
		'…and the line names the profile',
	);
	await refused('the wrong agent’s text under this name', { afterText: coordinatorText }, (e) =>
		e.some((x) => /does not match mockup-analyst\.md/.test(x)),
	);
	const bad = await go({
		model: noModelCalls.factory,
		agent: 'coordinator',
		beforeText: coordinatorText,
		afterText: coordinatorText.replace('tools:', 'tools2:'),
	});
	check(
		bad.result === 'invalid' && bad.errors.length > 0,
		'an agent with no reference set is loaded first: a broken edit of it is invalid, not "nothing to compare"',
		json(bad.errors),
	);
	check(
		noModelCalls.state.calls === 0,
		'the model factory was never called',
		String(noModelCalls.state.calls),
	);
}

console.log('runner: an agent with no reference set');
{
	const noModelCalls = noModel();
	const r = await go({
		model: noModelCalls.factory,
		agent: 'coordinator',
		beforeText: coordinatorText,
		afterText: coordinatorText,
	});
	check(
		r.result === 'no-eval-set' &&
			r.costUsd === 0 &&
			!r.capped &&
			r.set === null &&
			r.before === null &&
			r.after === null &&
			r.items.length === 0 &&
			r.errors.length === 0,
		'coordinator: no-eval-set, nothing ran, nothing spent',
		json(r),
	);
	check(
		noModelCalls.state.calls === 0,
		'…and the factory is never called',
		String(noModelCalls.state.calls),
	);
	check(evalPasses(r.result), '…it passes');
	check(
		r.line === 'coordinator: no eval set yet, nothing to compare',
		'the line says there is nothing to compare',
		r.line,
	);
	const fresh = await go({
		model: noModelCalls.factory,
		agent: 'coordinator',
		beforeText: null,
		afterText: coordinatorText,
	});
	check(
		fresh.result === 'no-eval-set' && noModelCalls.state.calls === 0,
		'a new agent with no set is the same',
	);
}

console.log('runner: the cap');
{
	// Calls 1 and 2 are the "before", 3 and 4 the "after"; every call costs `callCost`.
	const over = fakeModel();
	const r = await go({ model: over.transport, capUsd: 2.5 * callCost });
	check(
		r.result === 'capped' && r.capped,
		'a cap the 3rd call carries the total past: capped',
		json({ result: r.result, capped: r.capped }),
	);
	check(
		json(r.errors) === json(['stopped after call 1 of side after']),
		'…and the error says where: stopped after call 1 of side after',
		json(r.errors),
	);
	check(
		over.requests.length === 3 && near(r.costUsd, 3 * callCost) && r.costUsd > r.capUsd,
		'…3 calls made, the response that passed the cap is the last, the total over the cap',
		`${over.requests.length} calls, ${r.costUsd} of ${r.capUsd}`,
	);
	check(
		r.before?.score === 1 &&
			r.before.calls === 2 &&
			near(r.before.costUsd, 2 * callCost) &&
			r.after === null,
		'…the "before", which finished, is reported; the "after" is null',
		json([r.before, r.after]),
	);
	check(
		r.items.length === 13 &&
			allViewed(r, 'before') &&
			r.items.every((i) => i.after === null && !i.changed),
		'…the items carry the "before" views and null "after" views',
	);
	check(
		!evalPasses(r.result) &&
			/^mockup-analyst: capped at \$\d+\.\d\d \(spent \$\d+\.\d\d\) — stopped after call 1 of side after$/.test(
				r.line,
			),
		'…it fails, and the line starts "capped at $…"',
		r.line,
	);
	check(r.set?.elements === 13, '…the set is still reported');

	const exact = fakeModel();
	const e = await go({ model: exact.transport, capUsd: 2 * callCost });
	check(
		e.result === 'capped' && json(e.errors) === json(['stopped before call 1 of side after']),
		'a cap equal to the total after 2 calls: the 3rd is refused before it is made',
		json([e.result, e.errors]),
	);
	check(
		exact.requests.length === 2 &&
			near(e.costUsd, 2 * callCost) &&
			e.before?.score === 1 &&
			e.after === null,
		'…the transport saw exactly 2 requests, the "before" is reported',
		`${exact.requests.length} requests`,
	);

	const zero = fakeModel();
	const z = await go({ model: zero.transport, capUsd: 0 });
	check(
		z.result === 'capped' &&
			z.capped &&
			zero.requests.length === 0 &&
			z.costUsd === 0 &&
			json(z.errors) === json(['stopped before call 1 of side before']),
		'a cap of 0 makes no call at all',
		json([z.result, z.errors, zero.requests.length]),
	);
	check(
		z.before === null && z.after === null && z.items.length === 0 && z.set?.elements === 13,
		'…nothing is reported but the set',
	);

	const huge = fakeModel({ usage: () => usageOf(1000, 1_000_000) });
	const h = await go({ model: huge.transport });
	check(
		h.result === 'capped' &&
			json(h.errors) === json(['stopped after call 1 of side before']) &&
			huge.requests.length === 1 &&
			h.costUsd > EVAL_CAP_USD,
		'a single response of 1,000,000 output tokens passes the real $20 cap on call 1',
		json([h.result, h.errors, h.costUsd]),
	);
	check(
		h.before === null && h.after === null && h.items.length === 0,
		'…the unfinished "before" is not reported',
	);

	const lastFits = fakeModel();
	const f = await go({ model: lastFits.transport, capUsd: 4 * callCost });
	check(
		f.result === 'scored' && lastFits.requests.length === 4 && near(f.costUsd, f.capUsd),
		'a total exactly at the cap on the last call is not over it: scored',
		json([f.result, f.costUsd, f.capUsd]),
	);
	const lastPasses = fakeModel();
	const p = await go({ model: lastPasses.transport, capUsd: 3.5 * callCost });
	check(
		p.result === 'capped' &&
			json(p.errors) === json(['stopped after call 2 of side after']) &&
			lastPasses.requests.length === 4 &&
			p.before?.score === 1 &&
			p.after === null,
		'a cap the very last call passes: capped after call 2 of side after, the "after" not reported',
		json([p.result, p.errors]),
	);

	const lone = fakeModel();
	const l = await go({ model: lone.transport, beforeText: null, capUsd: 1.5 * callCost });
	check(
		l.result === 'capped' &&
			json(l.errors) === json(['stopped after call 2 of side after']) &&
			lone.requests.length === 2 &&
			l.before === null &&
			l.after === null,
		'with no "before", the cap counts the "after" alone',
		json([l.result, l.errors]),
	);

	const noted = await go({ model: fakeModel().transport, beforeText: 'junk', capUsd: 0 });
	check(
		noted.result === 'capped' &&
			noted.errors.length === 2 &&
			noted.errors[0] === 'stopped before call 1 of side after' &&
			noted.errors[1].startsWith(`main's definition fails the loader`),
		'the cap comes first in errors, ahead of a note about main, so the line shows it',
		json(noted.errors),
	);
}

console.log('runner: a call that fails');
{
	const refusal = (billed: BilledResponse) =>
		new VisionError('refusal', 'The model declined to analyse this image.', billed);
	const first = fakeModel({ fail: (n, billed) => (n === 2 ? refusal(billed) : null) });
	const r = await go({ model: first.transport });
	check(
		r.result === 'error' && !r.capped && !evalPasses(r.result),
		'a refusal on call 2 is an error, not a throw, and fails',
		json([r.result, r.capped]),
	);
	check(
		json(r.errors) === json(['side before: The model declined to analyse this image.']),
		'…errors names the side and says what the API said',
		json(r.errors),
	);
	check(
		first.requests.length === 2 && near(r.costUsd, 2 * callCost),
		'…the refused response was billed, so the cost counts both calls',
		`${first.requests.length} calls, ${r.costUsd}`,
	);
	check(
		r.before === null && r.after === null && r.items.length === 0 && r.set?.elements === 13,
		'…the unfinished side is not reported, but the set is',
	);
	check(
		r.line ===
			'mockup-analyst: the eval failed — side before: The model declined to analyse this image.',
		'…and the line says so',
		r.line,
	);

	const overCap = fakeModel({ fail: (n, billed) => (n === 2 ? refusal(billed) : null) });
	const o = await go({ model: overCap.transport, capUsd: 1.5 * callCost });
	check(
		o.result === 'capped' &&
			json(o.errors) === json(['stopped after call 2 of side before']) &&
			near(o.costUsd, 2 * callCost),
		'a refusal whose billed cost passes the cap is capped, not an error',
		json([o.result, o.errors, o.costUsd]),
	);

	const unbilled = fakeModel({
		fail: () => new VisionError('bad_json', 'The answer is not JSON.'),
	});
	const u = await go({ model: unbilled.transport });
	check(
		u.result === 'error' &&
			u.costUsd === 0 &&
			json(u.errors) === json(['side before: The answer is not JSON.']),
		'a VisionError with no response billed nothing',
		json([u.result, u.errors, u.costUsd]),
	);

	const afterFails = fakeModel({
		fail: (n) => (n === 3 ? new Error('503 upstream overloaded') : null),
	});
	const a = await go({ model: afterFails.transport });
	check(
		a.result === 'error' &&
			json(a.errors) === json(['side after: 503 upstream overloaded']) &&
			near(a.costUsd, 2 * callCost),
		'an API error on the "after" names that side; a plain error bills nothing',
		json([a.result, a.errors, a.costUsd]),
	);
	check(
		a.before?.score === 1 &&
			a.after === null &&
			allViewed(a, 'before') &&
			a.items.every((i) => i.after === null && !i.changed),
		'…the "before", which finished, stays reported, with its views',
	);

	const broken = await go({
		model: () => {
			throw new Error('ANTHROPIC_API_KEY is not set');
		},
	});
	check(
		broken.result === 'error' &&
			json(broken.errors) === json(['ANTHROPIC_API_KEY is not set']) &&
			broken.costUsd === 0 &&
			broken.before === null,
		'a factory that throws (no key) is an error with no side named, nothing spent',
		json([broken.result, broken.errors]),
	);
	check(
		broken.set?.elements === 13 &&
			broken.line === 'mockup-analyst: the eval failed — ANTHROPIC_API_KEY is not set',
		'…the set is known, and the line names the missing key',
		broken.line,
	);
}

console.log('runner: secrets stay out of the report');
{
	const leak = new Error(
		'401 {"error":{"message":"invalid x-api-key sk-ant-abc123"}} Authorization: Bearer xyz\n   retry later',
	);
	const r = await go({ model: fakeModel({ fail: () => leak }).transport });
	const text = json(r);
	check(
		r.result === 'error' &&
			!text.includes('sk-ant-abc123') &&
			!text.includes('xyz') &&
			r.errors[0].includes('[redacted]'),
		'a key and a bearer token in an error message are redacted',
		r.errors[0],
	);
	check(
		!r.errors[0].includes('\n') &&
			r.errors[0].startsWith('side before: 401 ') &&
			r.errors[0].endsWith('retry later'),
		'…the message is one line, the rest of it kept',
		r.errors[0],
	);
	const lower = await go({
		model: fakeModel({ fail: () => 'bearer abc.def sk-ant-api03-ABC_def-123 gone' }).transport,
	});
	check(
		lower.result === 'error' &&
			!json(lower).includes('abc.def') &&
			!json(lower).includes('sk-ant-api03') &&
			lower.errors[0].includes('[redacted]'),
		'a string thrown instead of an Error, a lower-case bearer and a key with dashes: all redacted',
		lower.errors[0],
	);
	const viaFactory = await go({
		model: () => {
			throw new Error('cannot use sk-ant-zzz999');
		},
	});
	check(
		!json(viaFactory).includes('sk-ant-zzz999'),
		'a factory’s error is redacted too',
		viaFactory.errors[0],
	);
	const long = await go({
		model: fakeModel({ fail: () => new Error('x'.repeat(2000)) }).transport,
	});
	check(
		long.errors[0].length <= 'side before: '.length + 300,
		'a long message is cut to 300 characters before the side is named',
		String(long.errors[0].length),
	);
}

console.log('evalLine');
{
	const byResult = new Map<EvalResult, EvalReport>();
	for (const r of reports) if (!byResult.has(r.result)) byResult.set(r.result, r);
	check(
		json([...byResult.keys()].sort()) ===
			json(['capped', 'error', 'invalid', 'no-eval-set', 'scored']),
		'the cases above produced every result there is',
		[...byResult.keys()].join(),
	);
	check(
		reports.every((r) => r.line === evalLine(r) && r.line.length <= 140),
		'every report’s line is evalLine of it, within 140 characters',
		reports
			.filter((r) => r.line !== evalLine(r) || r.line.length > 140)
			.map((r) => r.line)
			.join(' | '),
	);
	check(
		json(
			(['scored', 'no-eval-set', 'invalid', 'capped', 'error'] as const).map((r) => evalPasses(r)),
		) === json([true, true, false, false, false]),
		'evalPasses: scored and no-eval-set pass; invalid, capped and error block',
	);

	const body = (over: Partial<Parameters<typeof evalLine>[0]>): Parameters<typeof evalLine>[0] => ({
		agent: 'mockup-analyst',
		result: 'error',
		capUsd: 20,
		costUsd: 0,
		capped: false,
		set: null,
		before: null,
		after: null,
		items: [],
		errors: [],
		...over,
	});
	const side = byResult.get('scored')!.before!;
	check(
		evalLine(
			body({
				result: 'scored',
				set: { name: 'mockups', images: 1, elements: 1 },
				before: side,
				after: side,
			}),
		) === 'mockup-analyst: 100% → 100% on 1 element · $0.00 of $20.00',
		'one element is singular',
	);
	check(
		evalLine(body({ result: 'scored', before: side, after: null, costUsd: 0.5 })) ===
			'mockup-analyst: 100% → — on 0 elements · $0.50 of $20.00',
		'a side that did not run shows as —, and with no set the items are counted',
	);
	check(
		evalLine(
			body({
				result: 'scored',
				before: { ...side, score: 11 / 13 },
				after: { ...side, score: 0.995 },
			}),
		).startsWith('mockup-analyst: 85% → 100% on '),
		'a score is rounded to a whole percent, not cut: 84.6% reads 85%, 99.5% reads 100%',
	);
	check(
		evalLine(body({ result: 'invalid' })) ===
			'mockup-analyst: the edited definition fails the loader — invalid' &&
			evalLine(body({ result: 'capped' })) ===
				'mockup-analyst: capped at $20.00 (spent $0.00) — stopped' &&
			evalLine(body({ result: 'error' })) === 'mockup-analyst: the eval failed — error',
		'a result with no error to quote still reads',
	);

	const prefix = 'mockup-analyst: the eval failed — ';
	const exactly = evalLine(body({ errors: ['x'.repeat(140 - prefix.length)] }));
	const one = evalLine(body({ errors: ['x'.repeat(141 - prefix.length)] }));
	check(
		exactly.length === 140 && !exactly.endsWith('…') && exactly.endsWith('x'),
		'a line of exactly 140 characters is kept whole',
		`${exactly.length}`,
	);
	check(
		one.length === 140 &&
			one.endsWith('x…') &&
			one === `${prefix}${'x'.repeat(140 - prefix.length - 1)}…`,
		'a line of 141 is cut to 139 characters and an ellipsis',
		`${one.length}: …${one.slice(-4)}`,
	);

	const long = await go({
		model: fakeModel({ fail: () => new Error('the upstream said '.repeat(40)) }).transport,
	});
	check(
		long.line.length === 140 &&
			long.line.endsWith('…') &&
			long.line.startsWith('mockup-analyst: the eval failed — side before: the upstream said '),
		'a long error from a real run is cut to 140 in the report’s own line',
		`${long.line.length}: ${long.line}`,
	);
}

console.log('the report reader');
{
	const good = reports.find((r) => r.result === 'scored' && r.before !== null)!;
	const fresh = (): Record<string, unknown> => JSON.parse(json(good));
	const rejects = (msg: string, change: (r: Record<string, unknown>) => void, wanted: RegExp) => {
		const r = fresh();
		change(r);
		const message = throws(() => parseEvalReport(r));
		check(wanted.test(message), msg, `"${message}"`);
	};
	const items = (r: Record<string, unknown>) => r.items as Record<string, unknown>[];
	check(throws(() => parseEvalReport(fresh())) === '', 'a report the runner wrote is accepted');
	rejects('another version', (r) => (r.version = 2), /not version 1/);
	rejects('an agent name that is not an agent', (r) => (r.agent = '../x'), /names no agent/);
	rejects('a result that is not one', (r) => (r.result = 'passed'), /no result/);
	rejects(
		'a cost that is not a number (NaN is null in JSON)',
		(r) => (r.costUsd = null),
		/no cost/,
	);
	rejects('a capped that is not a boolean', (r) => (r.capped = 'no'), /if it was capped/);
	rejects('items that are not a list', (r) => (r.items = {}), /no items/);
	rejects(
		'an item that lacks its expectation',
		(r) => delete items(r)[0].expected,
		/an item is malformed/,
	);
	rejects(
		'an element view that is malformed',
		(r) => (items(r)[0].before = { found: 'yes' }),
		/element view is malformed/,
	);
	rejects(
		'a side with no score',
		(r) => ((r.before as Record<string, unknown>).score = null),
		/a side is malformed/,
	);
	rejects('errors that are not strings', (r) => (r.errors = [1]), /no errors list/);
	rejects(
		'a set with no figures',
		(r) => (r.set = { name: 'mockups' }),
		/reference set is malformed/,
	);
	check(
		throws(() => parseEvalReport([])) === 'the report is not an object',
		'an array is not a report',
	);
	check(
		throws(() => parseEvalReport(null)) === 'the report is not an object',
		'null is not a report',
	);
}

console.log('every report');
{
	const bad = reports.filter((r) => {
		const through = json(parseEvalReport(JSON.parse(json(r))));
		return through !== json(r);
	});
	check(
		bad.length === 0,
		'every report, of every result, passes parseEvalReport and comes back byte-equal',
		bad.map((r) => r.line).join(' | '),
	);
	check(
		reports.every((r) => !json(r).includes('sk-ant-') && r.errors.every((e) => !/[\r\n]/.test(e))),
		'no report carries a key-shaped string, and no error spans lines',
	);
	check(
		reports.every((r) => {
			const spent = (r.before?.costUsd ?? 0) + (r.after?.costUsd ?? 0);
			return r.result === 'scored' ? near(r.costUsd, spent) : r.costUsd >= spent - 1e-12;
		}),
		'a scored report’s cost is its sides’ costs; any other never reports less than they spent',
	);
}

console.log(`agent eval: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
