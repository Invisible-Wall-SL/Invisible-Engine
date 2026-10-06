/**
 * The mockup analysis (PLAN 3.6; ADR-0005), over the reference set in `docs/director/eval/mockups/`:
 *
 *   pnpm --filter director-worker check:mockups            # compare with expected-breakdown.json
 *   pnpm --filter director-worker check:mockups --update   # rewrite expected-breakdown.json
 *
 * The REAL `analyzeMockups`, `rules.ts`, `schema.ts` and `checkpoint.ts` run; the Anthropic transport
 * is a fake that answers each image from `reference.json`'s canned analyst output, and the adapters
 * are an in-memory launcher (the listing, the images as the real PNG/JPG bytes, the template and
 * region catalogue from the same file, and a `save_crops` that records what it was asked).
 *
 * Pinned:
 *  - the breakdown is STABLE: two runs give byte-identical JSON, and it equals the committed snapshot;
 *  - the buy button is forced `left_out` naming Bet modes, although the model called it matched;
 *    a buy control is met however it is spelled (`buy_button`, `BuyBonusButton`, "Bonus buy");
 *  - a control the model ties to a locked item that no rule is about ("Shop" → SpinButton naming
 *    bet modes) is capped at `needs_you`: the model's claim is never a verdict, either way;
 *  - a palette colour the images' k-means does not support (magenta) is dropped; the supported ones
 *    stay, and one supported only by the style reference stays too;
 *  - an unknown region is `needs_you`; a `left_out` the model claims but no rule about the element
 *    confirms is `needs_you`; a box outside the image is dropped; region names are canonicalised;
 *  - one vision call per non-style image, none for the style reference, and the image bytes the
 *    transport sees are the files; `uncoveredRegions` is computed across images;
 *  - crops: one per matched region, saved through `mockups.save_crops` in the WORKER's name with the
 *    pass's opId, while every read is made in the analyst's name;
 *  - a run whose mockups lack the ownership check is refused before any model call;
 *  - the model's own verdict never reaches the breakdown: a buy control the model calls `left_out`
 *    on a template that CAN buy comes out `matched`, while another control the model tied to the
 *    same locked item stays `needs_you` — a rule clears only an element it is about;
 *  - the owner's revision notes go into the image prompt, never the cached system block;
 *  - the checkpoint submission is `step_done`: waiting on `breakdown` with the checkpoint on, and the
 *    `checkpoint_open` event carries the breakdown; with it off the run moves on to style_pack; the
 *    coordinator's report names the figures and the open checkpoint;
 *  - the schema parser refuses a malformed answer with a reason.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AdapterClient } from '../adapters.ts';
import { loadAgents, pricedModels } from '../agents.ts';
import { checkpointSettings, type RunState } from '../runState.ts';
import { KNOWN_TOOLS } from '../tools.ts';
import {
	AnalysisRefused,
	analyzeMockups,
	imagePrompt,
	type AnalyzeDeps,
	type Breakdown,
	type MockupListing,
	type RegionListing,
	type TemplateSummary,
} from './analyze.ts';
import { breakdownEvents, breakdownReport } from './checkpoint.ts';
import { applyCodeRules, regionIndex, tokens, verifyPalette, type CodedElement } from './rules.ts';
import { ANALYST_OUTPUT_SCHEMA, parseAnalystOutput, type AnalystOutput } from './schema.ts';
import {
	readAnswerText,
	summarizeUsage,
	type VisionRequest,
	type VisionTransport,
} from './vision.ts';

const root = (rel: string) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));
const EVAL = root('../../docs/director/eval/mockups/');
const update = process.argv.includes('--update');

let failures = 0;
let checks = 0;
const check = (ok: boolean, msg: string, extra = '') => {
	checks++;
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${ok ? '' : ` — ${extra}`}`);
	if (!ok) failures++;
};

interface Reference {
	template: TemplateSummary;
	regions: RegionListing;
	fidelity: MockupListing['fidelity'];
	ownershipConfirmed: MockupListing['ownershipConfirmed'];
	images: (MockupListing['images'][number] & {
		dominantColors: { hex: string; share: number }[];
	})[];
	answers: Record<string, AnalystOutput>;
}
const reference = JSON.parse(readFileSync(`${EVAL}reference.json`, 'utf8')) as Reference;
const fileBytes = new Map(
	reference.images.map((img) => [img.id, readFileSync(`${EVAL}${img.file}`)]),
);

const agents = loadAgents(root('agents'), {
	models: pricedModels(root('pricing.json')),
	tools: KNOWN_TOOLS,
});
const analyst = agents.get('mockup-analyst')!;

// ── Fakes ─────────────────────────────────────────────────────────────────────

interface Call {
	/** Whose name the call was made in. */
	as: 'analyst' | 'worker';
	tool: string;
	op: string;
	input: unknown;
	opId?: string;
}

function fakeLauncher(over: Partial<Pick<Reference, 'ownershipConfirmed' | 'template'>> = {}) {
	const calls: Call[] = [];
	const client = (as: Call['as']): AdapterClient => ({
		async call<T>(tool: string, op: string, input: unknown, opts?: { opId?: string }) {
			calls.push({ as, tool, op, input, opId: opts?.opId });
			const id = `${tool}.${op}`;
			switch (id) {
				case 'mockups.list':
					return {
						fidelity: reference.fidelity,
						ownershipConfirmed:
							'ownershipConfirmed' in over ? over.ownershipConfirmed : reference.ownershipConfirmed,
						modelLongEdge: 1568,
						images: reference.images.map(({ dominantColors: _d, ...img }) => img),
					} as T;
				case 'mockups.get_image': {
					const img = reference.images.find((i) => i.id === (input as { id: string }).id)!;
					return {
						id: img.id,
						mediaType: img.mediaType,
						base64: fileBytes.get(img.id)!.toString('base64'),
						w: img.w,
						h: img.h,
						scale: 1,
						dominantColors: img.dominantColors,
					} as T;
				}
				case 'gamemaker.get_template':
					return (over.template ?? reference.template) as T;
				case 'atlas.list_regions':
					return reference.regions as T;
				case 'fonts.list':
					throw Object.assign(new Error('fonts.list: 404 unknown_op'), {
						name: 'AdapterCallError',
						status: 404,
						code: 'unknown_op',
					});
				case 'mockups.save_crops': {
					const crops = (input as { crops: { region: string; imageId: string }[] }).crops;
					return {
						saved: crops.map((c) => ({
							region: c.region,
							imageId: c.imageId,
							key: `acme/sunken_temple/director/crops/run-1/${c.region}.png`,
						})),
						skipped: [],
					} as T;
				}
				default:
					throw new Error(`fixture: no fake for ${id}`);
			}
		},
	});
	const adapters: AnalyzeDeps['adapters'] = {
		analyst: client('analyst'),
		worker: client('worker'),
	};
	return { adapters, calls };
}

/** `answers` overrides the canned analyst output per image id. */
function fakeTransport(answers: Partial<Record<string, AnalystOutput>> = {}) {
	const requests: VisionRequest[] = [];
	let n = 0;
	const transport: VisionTransport = {
		async analyze(request) {
			requests.push(request);
			const img = reference.images.find(
				(i) => fileBytes.get(i.id)!.toString('base64') === request.image.base64,
			);
			if (!img) throw new Error('fixture: the transport got an image it does not know');
			// Through the real text parser, as the SDK transport does, so a canned answer that the
			// schema would not produce fails here too.
			const output = readAnswerText(JSON.stringify(answers[img.id] ?? reference.answers[img.id]));
			const usage = {
				input_tokens: 1000,
				output_tokens: 400,
				cache_read_input_tokens: 0,
				cache_creation_input_tokens: 0,
			};
			return {
				id: `vmsg_${++n}`,
				output,
				usage,
				usageSummary: summarizeUsage(usage),
				model: request.model,
			};
		},
	};
	return { transport, requests };
}

// The `fonts.list` fake throws a plain object; make it the class `analyze.ts` checks for.
const { AdapterCallError } = await import('../adapters.ts');
const asAdapterError = (adapters: AdapterClient): AdapterClient => ({
	async call(tool, op, input, opts) {
		try {
			return await adapters.call(tool, op, input, opts);
		} catch (e) {
			const err = e as { status?: number; code?: string; message: string };
			if (err.status === 404) {
				throw new AdapterCallError(tool, op, 404, err.code ?? 'unknown_op', err.message, null);
			}
			throw e;
		}
	},
});
const withErrors = (adapters: AnalyzeDeps['adapters']): AnalyzeDeps['adapters'] => ({
	analyst: asAdapterError(adapters.analyst),
	worker: asAdapterError(adapters.worker),
});

const run = { id: 'run-1', templateProjectKey: reference.template.key };

async function analyze(pass = 1) {
	const launcher = fakeLauncher();
	const model = fakeTransport();
	const breakdown = await analyzeMockups({
		adapters: withErrors(launcher.adapters),
		model: model.transport,
		agent: analyst,
		run,
		pass,
	});
	return { breakdown, calls: launcher.calls, requests: model.requests };
}

const elementsOf = (b: Breakdown, file: string) => b.images.find((i) => i.file === file)!.elements;

// ── Stable breakdown, equal to the committed snapshot ─────────────────────────
console.log('breakdown');
const first = await analyze();
const second = await analyze();
const json = JSON.stringify(first.breakdown, null, '\t');
check(json === JSON.stringify(second.breakdown, null, '\t'), 'two runs give the same breakdown');
const snapshotPath = `${EVAL}expected-breakdown.json`;
if (update) {
	writeFileSync(snapshotPath, `${json}\n`);
	console.log(`  wrote ${snapshotPath}`);
} else {
	let expected = '';
	try {
		expected = readFileSync(snapshotPath, 'utf8').trimEnd();
	} catch {
		expected = '(missing — run with --update)';
	}
	check(
		json === expected,
		'the breakdown equals expected-breakdown.json',
		'run with --update to accept',
	);
}

const { breakdown, calls, requests } = first;
const base = elementsOf(breakdown, 'base-game.png');
const bigWin = elementsOf(breakdown, 'big-win.png');

// ── Code has the final word ───────────────────────────────────────────────────
console.log('code rules');
{
	const buy = base.find((e) => e.name === 'Buy bonus button')!;
	check(buy.status === 'left_out', 'the buy button is forced left_out', JSON.stringify(buy));
	check(
		buy.lockedItem?.id === 'bet_modes' && buy.lockedItem.label === 'Bet modes',
		'…naming Bet modes as the locked item',
	);
	check(buy.regions.length === 0, '…with no region, so it gets no crop');
	check(/Game Config/.test(buy.reason), '…and says the math changes in Game Config');

	const fish = base.find((e) => e.name === 'Fish swarm')!;
	check(fish.status === 'needs_you', 'an unknown region becomes needs_you');
	check(/no region "FishSwarm"/.test(fish.reason), '…naming the region the template lacks');

	const gamble = base.find((e) => e.name === 'Gamble button')!;
	check(
		gamble.status === 'needs_you' && gamble.lockedItem === null,
		'a left_out the model claims but no rule confirms is needs_you, not left_out',
		JSON.stringify(gamble),
	);
	check(/feature_rules/.test(gamble.reason), '…and the reason says what the analyst saw');

	const shop = base.find((e) => e.name === 'Shop')!;
	check(
		shop.status === 'needs_you' && shop.lockedItem === null && /your call/.test(shop.reason),
		'a control the model ties to bet modes that no rule is about is the owner’s call, not left out on the model’s word',
		JSON.stringify(shop),
	);
	const info = base.find((e) => e.name === 'Paytable button')!;
	check(
		info.status === 'needs_you' && info.regions.length === 0,
		'a model needs_you is never promoted to matched by a listed region',
		JSON.stringify(info),
	);

	check(!base.some((e) => /Stray/.test(e.name)), 'a box outside the image is dropped');
	check(
		base.map((e) => e.n).join() === base.map((_, i) => i + 1).join(),
		'elements are renumbered 1…n after the drop',
	);
	const symbols = base.find((e) => e.name.startsWith('Symbols'))!;
	check(
		symbols.regions.includes('BonusCoin'),
		'region names are canonicalised (bonuscoin → BonusCoin)',
	);
	check(symbols.regions.length === 11, 'every valid region of a multi-region element is kept');
	const bg = base.find((e) => e.name.startsWith('Background'))!;
	check(bg.box.w === 1280 && bg.box.h === 800, 'a full-image box is kept whole');
}

// ── Palette ───────────────────────────────────────────────────────────────────
console.log('palette');
{
	const hexes = breakdown.palette.map((p) => p.hex);
	check(!hexes.includes('#FF00FF'), 'an unsupported colour (magenta) is dropped');
	check(
		breakdown.paletteDropped.some((d) => d.hex === '#FF00FF' && d.nearest !== null),
		'…and the drop records the nearest supported colour',
	);
	for (const hex of ['#0E2A30', '#3FB68B', '#FF6F61', '#F2C14E', '#5CE1E6']) {
		check(hexes.includes(hex), `supported colour ${hex} is kept`, hexes.join());
	}
	check(hexes.includes('#A99BFF'), 'a colour only the style reference supports is kept');
	check(hexes.filter((h) => h === '#F2C14E').length === 1, 'a colour proposed twice appears once');
	check(breakdown.palette.length <= 8, 'at most 8 swatches');
	const strict = verifyPalette([{ name: 'Magenta', hex: '#FF00FF' }], [[{ hex: '#FF00F0' }]]);
	check(strict.kept.length === 1, 'a colour within tolerance of a centre is supported');
}

// ── Calls and crops ───────────────────────────────────────────────────────────
console.log('calls');
{
	check(requests.length === 2, 'one vision call per non-style image', `${requests.length}`);
	check(
		requests.every((r) => r.model === 'claude-opus-5-5' && r.effort === 'high'),
		"each call uses the analyst's model and effort",
	);
	check(
		requests.every((r) => r.system.includes(analyst.systemPrompt.slice(0, 80))),
		"the system prompt starts with the agent's definition",
	);
	check(
		requests.every(
			(r) => r.system.includes('bet_modes — Bet modes: base') && r.system.includes('- GRAND'),
		),
		'…and carries the locked items and the region catalogue',
	);
	check(
		requests[0].prompt.includes('1280×800') && requests[0].prompt.includes('"Base game"'),
		'the prompt names the image size and tag',
	);
	check(
		requests.map((r) => r.image.id).join() === 'a1b2c3d4e5f60001,a1b2c3d4e5f60002',
		'each request carries its mockup id, for the record of the answer',
	);
	const style = breakdown.images.find((i) => i.styleOnly)!;
	check(style.elements.length === 0 && style.model === null, 'the style reference gets no call');
	check(
		calls.filter((c) => c.op === 'get_image').length === 3,
		'every image is fetched once (the style reference for its colours)',
	);

	const save = calls.find((c) => c.op === 'save_crops')!;
	const crops = (save.input as { crops: { region: string }[] }).crops;
	check(
		save.opId === 'run-1:breakdown_crops:1',
		'crops are saved under the pass’s opId',
		save.opId,
	);
	check(
		(await analyze(2)).calls.find((c) => c.op === 'save_crops')!.opId === 'run-1:breakdown_crops:2',
		'a second pass takes a new opId',
	);
	check(save.as === 'worker', 'the crops are written in the worker’s name');
	check(
		calls.filter((c) => c.op !== 'save_crops').every((c) => c.as === 'analyst'),
		'every read is made in the analyst’s name',
	);
	const regions = crops.map((c) => c.region).sort();
	check(regions.length === new Set(regions).size, 'one crop per region');
	check(regions.length === 21, '21 regions matched get a crop', regions.join());
	check(
		!regions.includes('BetPanel') || crops.filter((c) => c.region === 'BetPanel').length === 1,
		'BetPanel cropped once',
	);
	check(breakdown.crops?.saved.length === 21, 'the save result is on the breakdown');
	check(
		breakdown.uncoveredRegions.join() === 'MegaWinBanner,EpicWinBanner',
		'uncovered regions are the two no mockup covers',
		breakdown.uncoveredRegions.join(),
	);
	check(
		breakdown.regionsTotal === 23 && breakdown.regionsMatched === 21,
		'21 of 23 regions matched',
	);
	check(
		bigWin[0].status === 'matched' && bigWin[0].regions[0] === 'BigWinBanner',
		'the big win banner matched',
	);
	check(
		breakdown.fontGaps.length === 1 && breakdown.fontGaps[0].imageId === 'a1b2c3d4e5f60001',
		'the font gap is kept with its image',
	);
	check(breakdown.usage.inputTokens === 2000, 'usage is summed over the calls');
	check(
		!calls.some((c) => c.tool === 'atlas' && c.op !== 'list_regions'),
		'nothing is queued on Atlas Maker',
	);
}

// ── Ownership refusal ─────────────────────────────────────────────────────────
console.log('a template that can buy');
{
	const withBuy = structuredClone(reference.template);
	const betModes = withBuy.lockedItems.find((l) => l.id === 'bet_modes')!;
	// scatter.json's shape: the buy mode is called `bonus`; only the flag says it buys.
	betModes.detail = 'base, bonus (buy)';
	betModes.facts = {
		betModes: [
			{ id: 'base', buyBonus: false },
			{ id: 'bonus', buyBonus: true },
		],
	};
	const launcher = fakeLauncher({ template: withBuy });
	const result = await analyzeMockups({
		adapters: withErrors(launcher.adapters),
		model: fakeTransport().transport,
		agent: analyst,
		run,
		pass: 1,
	});
	const els = elementsOf(result, 'base-game.png');
	const buy = els.find((e) => e.name === 'Buy bonus button')!;
	check(
		buy.status === 'matched' && buy.regions.join() === 'BetPanel',
		'the buy button is matched on a template with a buyBonus mode',
		JSON.stringify(buy),
	);
	const shop = els.find((e) => e.name === 'Shop')!;
	check(
		shop.status === 'needs_you' && shop.lockedItem === null,
		'…while the control the model tied to bet modes that no rule is about stays the owner’s call',
		JSON.stringify(shop),
	);
	check(!els.some((e) => e.status === 'left_out'), 'nothing is left out on that template');

	// The model gets it wrong the other way: it leaves the buy button out although the template
	// buys — and ties the gamble button to the same bet modes.
	const base = reference.images[0].id;
	const wrong = structuredClone(reference.answers[base]);
	const claim = wrong.elements.find((e) => e.name === 'Buy bonus button')!;
	claim.status = 'left_out';
	claim.lockedItem = 'bet_modes';
	claim.reason = 'The math has no buy feature.';
	wrong.elements.find((e) => e.name === 'Gamble button')!.lockedItem = 'bet_modes';
	const judged = elementsOf(
		await analyzeMockups({
			adapters: withErrors(fakeLauncher({ template: withBuy }).adapters),
			model: fakeTransport({ [base]: wrong }).transport,
			agent: analyst,
			run,
			pass: 1,
		}),
		'base-game.png',
	);
	const overruled = judged.find((e) => e.name === 'Buy bonus button')!;
	check(
		overruled.status === 'matched' && overruled.regions.join() === 'BetPanel',
		'a buy control the model calls left_out on a template that can buy is matched: the model’s verdict counts for nothing',
		JSON.stringify(overruled),
	);
	check(
		overruled.lockedItem === null && /no buy feature/.test(overruled.reason),
		'…with no locked item, and the model’s reason kept as a reason only',
	);
	const gamble = judged.find((e) => e.name === 'Gamble button')!;
	check(
		gamble.status === 'needs_you' && gamble.lockedItem === null && /your call/.test(gamble.reason),
		'…but a control the buy rule is not about stays needs_you although the model named bet modes: a rule clears only its own elements',
		JSON.stringify(gamble),
	);

	const noFacts = structuredClone(reference.template);
	delete noFacts.lockedItems.find((l) => l.id === 'bet_modes')!.facts;
	const bare = await analyzeMockups({
		adapters: withErrors(fakeLauncher({ template: noFacts }).adapters),
		model: fakeTransport().transport,
		agent: analyst,
		run,
		pass: 1,
	});
	check(
		!elementsOf(bare, 'base-game.png').some((e) => e.status === 'left_out'),
		'without the bet-mode facts no rule fires: code forces left_out only on evidence',
	);
}

console.log('ownership');
{
	const launcher = fakeLauncher({ ownershipConfirmed: null });
	const model = fakeTransport();
	let refused: unknown = null;
	try {
		await analyzeMockups({
			adapters: launcher.adapters,
			model: model.transport,
			agent: analyst,
			run,
			pass: 1,
		});
	} catch (e) {
		refused = e;
	}
	check(
		refused instanceof AnalysisRefused && refused.code === 'ownership',
		'a run without the ownership check is refused',
	);
	check(model.requests.length === 0, '…before any model call');
	check(
		launcher.calls.length === 1 && launcher.calls[0].op === 'list',
		'…after reading only the listing',
	);
}

// ── Rules are about elements, spelled any way ─────────────────────────────────
console.log('rules about the element');
{
	check(
		[
			tokens('BuyBonusButton'),
			tokens('buy_button'),
			tokens('bonus-buy'),
			tokens('FEATURE_Buy'),
		].join('|') === 'buy bonus button|buy button|bonus buy|feature buy',
		'names and regions are read as words',
	);
	const names = reference.regions.atlases.flatMap((a) => a.regions.map((r) => r.name));
	const box = { x: 0, y: 0, w: 10, h: 10 };
	const judge = (
		el: Partial<AnalystOutput['elements'][number]> & { name: string },
		locked = reference.template.lockedItems,
	): CodedElement =>
		applyCodeRules(
			[{ n: 1, box, regions: [], status: 'matched', reason: '', lockedItem: null, ...el }],
			{
				regions: regionIndex([...names, 'buy_button', 'BuyBonusButton']),
				locked,
				image: { w: 100, h: 100 },
			},
		)[0];
	const gamble = judge({
		name: 'Gamble button',
		regions: ['BetPanel'],
		status: 'left_out',
		lockedItem: 'bet_modes',
	});
	check(
		gamble.status === 'needs_you' && gamble.lockedItem === null,
		'a gamble button the model ties to bet modes on a template that cannot buy is needs_you, never left_out on the model’s word',
		JSON.stringify(gamble),
	);
	check(
		['buybonus', 'bonusbuy', 'featurebuy', 'Purchase'].every(
			(name) => judge({ name, regions: ['BetPanel'] }).status === 'left_out',
		),
		'a join with no boundary (buybonus, featurebuy) still meets the buy rule',
	);
	const shop = judge({ name: 'Bonus shop', regions: ['buy_button'] });
	check(
		shop.status === 'left_out' && shop.lockedItem?.id === 'bet_modes',
		'a control mapped to a buy region is a buy control: left out on a template that cannot buy, with no claim from the model',
		JSON.stringify(shop),
	);
	check(
		judge({ name: 'Shop', regions: ['BuyBonusButton'] }).status === 'left_out',
		'…and so through a camel-cased region',
	);
	check(
		judge({ name: 'Buy', regions: ['BetPanel'] }).status === 'left_out',
		'…or through the element’s own name',
	);
	const claimed = judge({ name: 'Shop', regions: ['SpinButton'], lockedItem: 'bet_modes' });
	check(
		claimed.status === 'needs_you' && claimed.lockedItem === null,
		'a matched element the model nevertheless ties to a locked item that no rule is about is the owner’s call',
		JSON.stringify(claimed),
	);
	const buying = structuredClone(reference.template.lockedItems);
	buying.find((l) => l.id === 'bet_modes')!.facts = {
		betModes: [
			{ id: 'base', buyBonus: false },
			{ id: 'bonus', buyBonus: true },
		],
	};
	const cleared = judge(
		{ name: 'Bonus shop', regions: ['buy_button'], status: 'left_out', lockedItem: 'bet_modes' },
		buying,
	);
	check(
		cleared.status === 'matched' && cleared.regions.join() === 'buy_button',
		'on a template that can buy, the same control the model leaves out is matched: the facts clear it',
		JSON.stringify(cleared),
	);
	check(
		judge({ name: 'Bonus shop', regions: ['buy_button'], status: 'needs_you' }, buying).status ===
			'needs_you',
		'…but a model needs_you is never promoted by a clearance',
	);
}

// ── Owner notes ───────────────────────────────────────────────────────────────
console.log('owner notes');
{
	const image = reference.images[0];
	const plain = imagePrompt(image, { w: 1280, h: 800 }, 'match');
	const noted = imagePrompt(image, { w: 1280, h: 800 }, 'match', ['Keep the fish; drop the logo.']);
	check(noted.startsWith(plain), 'the notes are appended to the image prompt');
	check(noted.includes('- Keep the fish; drop the logo.'), '…one per line');
	check(
		!first.requests[0].system.includes('Keep the fish'),
		'…and never in the system block, which is cached across the run',
	);
}

// ── Checkpoint ────────────────────────────────────────────────────────────────
console.log('checkpoint');
{
	const on: RunState = {
		status: 'waiting',
		step: 'breakdown',
		waitingOn: 'breakdown',
		checkpoints: checkpointSettings({}),
	};
	const events = breakdownEvents(on, breakdown, 1);
	check(
		events.length === 2 && events[1].kind === 'checkpoint_open',
		'the submission opens the breakdown checkpoint',
	);
	const payload = events[1].payload as {
		checkpoint: string;
		attempt: number;
		breakdown: Breakdown;
	};
	check(
		payload.checkpoint === 'breakdown' && payload.breakdown === breakdown && payload.attempt === 1,
		'…carrying the breakdown and the attempt',
	);
	const report = breakdownReport(on, breakdown, 1);
	check(
		report.includes('21 of 23 template regions matched') &&
			report.includes('5 element(s) need the owner') &&
			report.includes('1 left out'),
		'the coordinator’s report carries the figures',
		report,
	);
	check(
		report.includes('Buy bonus button → Bet modes') &&
			report.includes('MegaWinBanner, EpicWinBanner'),
		'…the locked clashes and the uncovered regions',
	);
	check(
		report.includes('reviewing it at the breakdown checkpoint'),
		'…and that the owner is reviewing it',
	);
	const activity = events[0].payload as {
		regionsMatched: number;
		leftOut: number;
		needsYou: number;
	};
	check(
		activity.regionsMatched === 21 && activity.leftOut === 1 && activity.needsYou === 5,
		'the activity row summarises it',
	);
	const off: RunState = {
		status: 'running',
		step: 'style_pack',
		waitingOn: null,
		checkpoints: checkpointSettings({ breakdown: false }),
	};
	const offEvents = breakdownEvents(off, breakdown, 1);
	check(offEvents.length === 1, 'with the checkpoint off only the activity row is written');
	check(
		(offEvents[0].payload as { breakdown?: Breakdown }).breakdown === breakdown &&
			(events[0].payload as { breakdown?: Breakdown }).breakdown === undefined,
		'…and it then carries the breakdown itself, which the checkpoint row carries otherwise',
	);
	check(
		breakdownReport(off, breakdown, 2).includes('now in the style_pack step') &&
			breakdownReport(off, breakdown, 2).includes('attempt 2'),
		'…and the report says the run moved on, naming the attempt',
	);
}

// ── Schema ────────────────────────────────────────────────────────────────────
console.log('schema');
{
	check(
		ANALYST_OUTPUT_SCHEMA.additionalProperties === false,
		'the output schema is a closed object',
	);
	const bad = parseAnalystOutput({
		elements: [{ n: 1, box: { x: 1 }, name: 'x' }],
		palette: [],
		fontGaps: 'no',
	});
	check(
		!bad.ok && bad.errors.some((e) => /box/.test(e)) && bad.errors.some((e) => /fontGaps/.test(e)),
		'a malformed answer is refused with reasons',
	);
	const loose = parseAnalystOutput({
		elements: [],
		palette: [{ name: 'x', hex: 'red' }],
		fontGaps: [],
	});
	check(loose.ok && loose.output.palette.length === 0, 'a malformed hex is dropped, not fatal');
	assert.throws(() => readAnswerText('not json'), /not JSON/);
	check(true, 'text that is not JSON is a VisionError');
}

console.log(`mockups: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
