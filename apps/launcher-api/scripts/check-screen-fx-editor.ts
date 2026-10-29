/**
 * Guard the Scene Editor's Game Settings → SCREEN FX block (Shader Graph 8e,
 * `docs/design/shader-graph-screens.md` §9.2, step 6), offline, over the real modules.
 *
 * Run: `pnpm --filter launcher-api run check:screen-fx-editor`
 *
 *  1. **The kind filter is the runtime's.** Every built-in kind is greyed in the post FX pickers
 *     exactly when the stage refuses it (`stageFxRefusal`), with the stage's own reason: exit,
 *     enter, motion-only and break kinds; emphasis and loop kinds with a pixel pass are offered.
 *  2. **The caps.** Two entries (Add is off at two) and four filters in all, against every other
 *     enabled entry; an entry replacing its own kind does not count itself; a graph drawing five
 *     filters is never offered.
 *  3. **What the editor says plays is what the game plays.** For every list, the entries the block
 *     marks as playing are exactly `readPostFx`'s with the game's judge, in the reader's order, and
 *     every other enabled entry says why in the reader's words.
 *  4. **The load line** is the compiled cost × the reference phone's pixels against the post FX
 *     budget, and a kind without a compiled cost says so.
 *  5. **The settings are sparse**: `transitionCue` only when set, `postFx` only with an entry,
 *     `stageFxAntialias` only when on.
 *  5b. **The transition cue row**: the built-in exit kinds then the project's compiled effects;
 *     its status is the game's rule (off / screen / unplayable) and warns when the project's flow
 *     never fires `transition` (a library function it calls counts), as Game Maker's chip does;
 *     its load is a custom kind's compiled cost or a built-in twin's against the transition budget.
 *  6. **The cue palette** harvests the post FX cues, and the publish gate's vocabulary resolves a
 *     Fire Cue on one only given the doc's settings.
 *  7. **No new capability** (§16.11): a save that changes Screen FX is anyone's.
 *  8. **The wiring**, by source: the page builds `settings` through the block's helper and renders
 *     the block in Game Settings; the block is held to the stage's triggers and caps; the cue row
 *     comes first and writes through the game's reader.
 */
import { readFileSync } from 'node:fs';
import {
	ELEMENT_FX,
	STAGE_FX_LIMITS,
	customElementFx,
	customElementFxList,
	setCustomElementFx,
	type CustomElementFx,
	type ElementFxEntry,
	type ElementFxKindId,
} from 'constants-shared/elementFx';
import { freshDrivenSeedDoc, type FlowDoc } from 'engine-flow-v2';
import { readPostFx } from 'engine-layout';
import { SCREEN_TRANSITION_KINDS } from 'constants-shared/screenTransition';
import {
	POST_COST_BUDGET,
	POST_SAMPLE_BUDGET,
	REFERENCE_GRAPHS,
	TRANSITION_COST_BUDGET,
	TRANSITION_SAMPLE_BUDGET,
	compileShaderEffect,
} from 'engine-shadergraph';
import { stageFxFilterCount, stageFxJudge, stageFxRefusal } from 'pixi-svelte/elementFx';

import { collectSceneCueNames } from '../src/lib/sceneCues';
import {
	POST_FX_LOAD_BUDGET,
	REFERENCE_PHONE_PX,
	postFxEntryRefusals,
	postFxFull,
	postFxKindRefusal,
	postFxLoad,
	postFxLoadText,
	screenFxSettings,
	screenTransitionKindGroups,
	TRANSITION_LOAD_BUDGET,
	transitionCueLine,
	transitionLoad,
	transitionLoadText,
} from '../src/lib/screenFx';
import { flowFiresTransition, flowFiresTransitionWith } from '../src/lib/transitionCueFlow';
import { buildGameProfile } from '../src/lib/server/gameProfile';
import { authoredOverlaySaveDecision } from '../src/lib/server/authoredOverlayGuard';
import { validateFlowV2Against } from '../src/lib/server/flowV2Validation';

let fails = 0;
let passes = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
	if (ok) passes++;
	else {
		fails++;
		console.error(`FAIL: ${name}${detail ? `\n      ${detail}` : ''}`);
	}
};
const eq = (name: string, actual: unknown, expected: unknown): void =>
	check(
		name,
		JSON.stringify(actual) === JSON.stringify(expected),
		`got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`,
	);
const src = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

const compiled = REFERENCE_GRAPHS.map((doc) => compileShaderEffect(doc));
const base = compiled.flatMap((r) => (r.ok ? [r.effect] : []));
const tint = base.find((e) => e.spec.kind === 'custom:pulseTint') as CustomElementFx;
const custom = (id: string, passes: readonly string[], extra: Partial<CustomElementFx> = {}) =>
	({
		...tint,
		spec: { ...tint.spec, kind: `custom:${id}`, label: id },
		passes: passes.map((kind) => ({ kind, params: {} })),
		...extra,
	}) as CustomElementFx;
setCustomElementFx([
	...base,
	custom('fourFilters', ['glow', 'shine', 'flash']),
	custom('fiveFilters', ['glow', 'shine', 'flash', 'blur']),
	custom('costed', [], { cost: 24, samples: 2 }),
	custom('heavy', [], { cost: POST_COST_BUDGET + 1, samples: 1 }),
	custom('manyReads', [], { cost: 10, samples: POST_SAMPLE_BUDGET + 1 }),
]);
check(
	'set up: the custom effects are registered',
	['fourFilters', 'fiveFilters', 'costed', 'heavy'].every(
		(id) => !!customElementFx(`custom:${id}`),
	),
);

const entry = (id: string, kind: string, more: Partial<ElementFxEntry> = {}): ElementFxEntry =>
	({ id, kind, trigger: 'always', ...more }) as ElementFxEntry;

// ---- 1. the kind filter is the runtime's --------------------------------------------------------
{
	const wrong: string[] = [];
	const refused = { exit: 0, enter: 0, motion: 0, break: 0 };
	let offered = 0;
	for (const spec of ELEMENT_FX) {
		const kind = spec.kind as ElementFxKindId;
		const runtime = stageFxRefusal(kind);
		const editor = postFxKindRefusal([], kind, undefined);
		if (editor !== runtime) wrong.push(`${kind}: editor "${editor}", runtime "${runtime}"`);
		if (!runtime) offered++;
		else if (runtime.startsWith('a break')) refused.break++;
		else if (runtime.startsWith('an exit')) refused.exit++;
		else if (runtime.startsWith('an enter')) refused.enter++;
		else if (runtime.startsWith('a motion-only')) refused.motion++;
		else wrong.push(`${kind}: an unknown reason "${runtime}"`);
	}
	check(
		`every built-in kind is greyed exactly when the stage refuses it, with its reason (${offered} offered; ${refused.exit} exit, ${refused.enter} enter, ${refused.motion} motion-only, ${refused.break} break refused)`,
		!wrong.length &&
			offered > 0 &&
			refused.exit > 0 &&
			refused.enter > 0 &&
			refused.motion > 0 &&
			refused.break > 0,
		wrong.join('; '),
	);
	eq(
		'the classes named in the design: Glow and Shine offered; Fade out, Fade in, Shake, Shatter refused',
		['glow', 'shine', 'fadeOut', 'fadeIn', 'shake', 'shatter'].map(
			(k) =>
				postFxKindRefusal([], k as ElementFxKindId, undefined)
					?.split(' ')
					.slice(0, 2)
					.join(' ') ?? 'offered',
		),
		['offered', 'offered', 'an exit', 'an enter', 'a motion-only', 'a break'],
	);
	check(
		'a compiled custom kind with a pixel pass is offered',
		postFxKindRefusal([], 'custom:pulseTint', undefined) === undefined,
	);
}

// ---- 2. the caps --------------------------------------------------------------------------------
{
	const two = [entry('a', 'glow'), entry('b', 'shine')];
	check(
		'two enabled entries: a third kind is greyed, with the stage’s reason',
		postFxKindRefusal(two, 'flash', undefined)?.includes(
			`at most ${STAGE_FX_LIMITS.entries} post FX at once`,
		) === true,
	);
	check(
		'…but an entry changing its own kind does not count itself',
		postFxKindRefusal(two, 'flash', 1) === undefined,
	);
	check(
		'a disabled entry counts for nothing',
		postFxKindRefusal(
			[entry('a', 'glow'), entry('b', 'shine', { disabled: true })],
			'flash',
			undefined,
		) === undefined,
	);
	check(
		`Add is off at ${STAGE_FX_LIMITS.entries} entries, on below`,
		postFxFull(two) && !postFxFull([two[0]]) && !postFxFull(undefined),
	);
	const four = [entry('a', 'custom:fourFilters')];
	check(
		'set up: Four filters draws four, Glow one',
		stageFxFilterCount('custom:fourFilters') === 4 && stageFxFilterCount('glow') === 1,
	);
	check(
		'four filters drawing: one more filter is greyed, with the stage’s reason',
		postFxKindRefusal(four, 'glow', undefined)?.includes(
			`at most ${STAGE_FX_LIMITS.filters} post FX filters (4 drawing, this one 1)`,
		) === true,
	);
	check(
		'…and the entry drawing them may change to a lighter kind',
		postFxKindRefusal(four, 'glow', 0) === undefined,
	);
	check(
		'a graph drawing five filters is never offered',
		!!postFxKindRefusal([], 'custom:fiveFilters', undefined),
	);
	check(
		'a refused kind gives the stage’s reason before the caps',
		postFxKindRefusal(two, 'shake', undefined) === stageFxRefusal('shake'),
	);
}

// ---- 3. what the editor says plays is what the game plays --------------------------------------
{
	const judge = stageFxJudge;
	const lists: unknown[][] = [
		[],
		[entry('a', 'glow'), entry('b', 'shine'), entry('c', 'flash')],
		[entry('a', 'shake'), entry('b', 'fadeOut'), entry('c', 'glow'), entry('d', 'shine')],
		[entry('off', 'glow', { disabled: true }), entry('a', 'glow'), entry('b', 'flash')],
		[entry('a', 'glow', { trigger: 'enter' }), entry('b', 'glow', { trigger: 'keyed' })],
		[entry('a', 'custom:fourFilters'), entry('b', 'glow'), entry('c', 'custom:fourFilters')],
		[entry('a', 'glow'), entry('b', 'custom:fourFilters'), entry('c', 'shine')],
		[entry('z', 'custom:fiveFilters'), entry('a', 'custom:costed', { trigger: 'cue', cue: 'x' })],
		[{ id: 'bad', kind: 'notAKind', trigger: 'always' }, entry('a', 'glow')],
		[entry('a', 'custom:gone'), entry('b', 'glow')],
		[entry('a', 'glow'), entry('a', 'shine'), entry('b', 'flash')],
	];
	const warn = console.warn;
	console.warn = () => {};
	try {
		for (const [i, list] of lists.entries()) {
			const refusals = postFxEntryRefusals(list);
			const editor = list.flatMap((raw, j) => {
				const e = raw as ElementFxEntry;
				return refusals[j] === undefined && !e.disabled && e.kind !== 'notAKind' ? [e.id] : [];
			});
			const said = list.flatMap((raw, j) => {
				const e = raw as ElementFxEntry;
				return refusals[j] === undefined || e.kind === 'notAKind' ? [] : [e.id];
			});
			const game = readPostFx({ postFx: list }, judge).map((e) => e.id);
			eq(`list ${i}: the entries the block shows as playing are readPostFx’s`, editor, game);
			const enabled = list.filter((raw) => !(raw as ElementFxEntry).disabled).length;
			check(
				`list ${i}: every other enabled, readable entry says why it does not play`,
				editor.length + said.length ===
					enabled - list.filter((r) => (r as ElementFxEntry).kind === 'notAKind').length,
				JSON.stringify({ editor, said }),
			);
		}
	} finally {
		console.warn = warn;
	}
	eq(
		'a refused row says why, in the stage’s words',
		postFxEntryRefusals([
			entry('a', 'glow'),
			entry('b', 'fadeOut'),
			entry('c', 'glow', { trigger: 'enter' }),
		]),
		[undefined, stageFxRefusal('fadeOut'), 'a post FX plays always or on a cue, not "enter"'],
	);
	eq(
		'…a kind the project no longer compiles, and an entry after one with its id, say so too',
		postFxEntryRefusals([entry('a', 'custom:gone'), entry('b', 'glow'), entry('b', 'shine')]),
		['its effect is not registered', undefined, 'an entry before it has the same id'],
	);
	check(
		'the game reads its post FX through the same judge',
		readFileSync(
			new URL('../../lines/src/components/Game.svelte', import.meta.url),
			'utf8',
		).includes('readPostFx(editorDoc.settings, stageFxJudge)') &&
			readFileSync(new URL('../src/lib/screenFx.ts', import.meta.url), 'utf8').includes(
				'readPostFx({ postFx: list }, stageFxJudge,',
			),
	);
}

// ---- 4. the load line ---------------------------------------------------------------------------
{
	const px = REFERENCE_PHONE_PX.width * REFERENCE_PHONE_PX.height;
	eq('the reference phone is 780 × 1688 device px (390 × 844 at DPR 2)', px, 1_316_640);
	eq('the post FX budget is its cost budget × the phone’s pixels', POST_FX_LOAD_BUDGET, 60 * px);
	const costed = postFxLoad('custom:costed');
	check(
		'a compiled cost: cost × the phone’s pixels, under budget',
		costed.kind === 'compiled' && costed.load === 24 * px && !costed.over,
		JSON.stringify(costed),
	);
	eq(
		'its words',
		postFxLoadText('custom:costed'),
		`Load 1.32 M px × cost 24 = 31.60 M of 79.00 M (the post FX budget, cost ${POST_COST_BUDGET}; 2 reads a pixel of ${POST_SAMPLE_BUDGET}).`,
	);
	check(
		'over the cost budget: over',
		(postFxLoad('custom:heavy') as { over?: boolean }).over === true,
	);
	check(
		'over the reads budget: over',
		(postFxLoad('custom:manyReads') as { over?: boolean }).over === true,
	);
	check(
		'a built-in and a graph compiled without a cost: no load, said so, nothing guessed',
		postFxLoad('glow').kind === 'none' &&
			postFxLoad('custom:pulseTint').kind === 'none' &&
			postFxLoadText('glow').startsWith('No compiled cost for this kind') &&
			!/cost \d/.test(postFxLoadText('glow')),
	);
}

// ---- 5. the settings are sparse -----------------------------------------------------------------
{
	const none = { transitionCue: undefined, postFx: undefined, stageFxAntialias: false };
	eq('nothing set: nothing written', screenFxSettings(none), {});
	eq('an empty list: nothing written', screenFxSettings({ ...none, postFx: [] }), {});
	const list = [entry('a', 'glow')];
	const cue = { kind: 'dissolveOut' as const, durationMs: 900 };
	eq(
		'the cue row, a list and the switch',
		screenFxSettings({ transitionCue: cue, postFx: list, stageFxAntialias: true }),
		{ transitionCue: cue, postFx: list, stageFxAntialias: true },
	);
	check('the list is a copy', screenFxSettings({ ...none, postFx: list }).postFx !== list);
}

// ---- 5b. the transition cue row -----------------------------------------------------------------
{
	eq(
		'the kinds: the built-in exits, then the project’s compiled effects (§9.1, §9.2)',
		screenTransitionKindGroups().map((g) => [g.label, g.kinds.length, g.kinds[0]]),
		[
			['Built-in (exit)', SCREEN_TRANSITION_KINDS.length, SCREEN_TRANSITION_KINDS[0]],
			['Custom (Shader Graph)', customElementFxList().length, customElementFxList()[0].spec.kind],
		],
	);
	eq(
		'the built-ins are exactly the transition kinds the game reads',
		screenTransitionKindGroups()[0].kinds,
		[...SCREEN_TRANSITION_KINDS],
	);
	const line = (cue: unknown, fires?: boolean) => transitionCueLine(cue, fires);
	eq(
		'its status is the game’s rule: off, screen, unplayable (a custom kind not compiled)',
		[
			line(undefined).status,
			line({ kind: 'burn' }).status,
			line({ kind: 'custom:costed' }).status,
			line({ kind: 'custom:gone' }).status,
			line({ kind: 'shake' }).status,
		],
		['off', 'screen', 'screen', 'unplayable', 'off'],
	);
	check(
		'off says the wipe plays; unplayable warns',
		line(undefined).text.includes('plays the wipe') &&
			!line(undefined).warn &&
			line({ kind: 'custom:gone' }).warn &&
			line({ kind: 'custom:gone' }).text.includes('the wipe'),
	);
	check(
		'on, it names the trade: the flow goes on about 1.6 s sooner, the pilot set aside',
		line({ kind: 'burn' }).text.includes('1.6 s sooner') &&
			line({ kind: 'burn' }).text.includes('pilot is set aside') &&
			!line({ kind: 'burn' }).warn,
	);
	check(
		'a stored flow that never fires transition warns; no stored flow (the coded one) does not',
		line({ kind: 'burn' }, false).warn &&
			line({ kind: 'burn' }, false).text.includes('never fires transition') &&
			!line({ kind: 'burn' }, undefined).warn &&
			!line({ kind: 'burn' }, true).warn &&
			!line(undefined, false).warn,
	);
	const load = (kind: ElementFxKindId) => transitionLoad(kind);
	eq(
		'built-in transitions are costed as their twins (§10: Dissolve out 80, Melt 71, Burn 222 over)',
		[load('dissolveOut'), load('melt'), load('burn')].map((l) =>
			l.kind === 'compiled' ? [l.cost, l.over] : null,
		),
		[
			[80, false],
			[71, false],
			[222, true],
		],
	);
	check(
		'a break (its pieces cost, not its graph) and a kind without a twin show no load',
		load('shatter').kind === 'none' && load('fadeOut').kind === 'none',
	);
	check(
		'a custom transition’s load is its compiled cost against the transition budget',
		(() => {
			const l = load('custom:costed');
			return (
				l.kind === 'compiled' &&
				l.load === 24 * REFERENCE_PHONE_PX.width * REFERENCE_PHONE_PX.height &&
				l.budget === TRANSITION_LOAD_BUDGET
			);
		})(),
	);
	eq(
		'its words',
		transitionLoadText('dissolveOut'),
		`Load 1.32 M px × cost 80 = 105.33 M of 263.33 M (the transition budget, cost ${TRANSITION_COST_BUDGET}; 1 reads a pixel of ${TRANSITION_SAMPLE_BUDGET}).`,
	);
	eq(
		'the transition budget is its cost × the phone’s pixels',
		TRANSITION_LOAD_BUDGET,
		200 * 1_316_640,
	);

	const seed = freshDrivenSeedDoc('lines');
	const withoutCue: FlowDoc = {
		...seed,
		graph: {
			...seed.graph,
			nodes: seed.graph.nodes.filter((n) => !(n.kind === 'fireCue' && n.ref === 'transition')),
		},
		modes: Object.fromEntries(
			Object.entries(seed.modes ?? {}).map(([id, mode]) => [
				id,
				{
					...mode,
					graph: {
						...mode.graph,
						nodes: mode.graph.nodes.filter(
							(n) => !(n.kind === 'fireCue' && n.ref === 'transition'),
						),
					},
				},
			]),
		),
	};
	const calls: FlowDoc = {
		...withoutCue,
		graph: {
			...withoutCue.graph,
			nodes: [
				...withoutCue.graph.nodes,
				{ id: 'call', kind: 'functionCall', pos: { x: 0, y: 0 }, ref: 'fn_wipe' },
			],
		},
	};
	const library = {
		version: 2 as const,
		functions: [
			{
				id: 'fn_wipe',
				name: 'Wipe',
				inputs: [],
				outputs: [],
				requires: {},
				body: {
					nodes: [{ id: 'c', kind: 'fireCue' as const, pos: { x: 0, y: 0 }, ref: 'transition' }],
					exec: [],
					data: [],
				},
			},
		],
	};
	eq(
		'whether the flow fires transition: the starter does; one without does not; no stored flow is unknown',
		[flowFiresTransition(seed), flowFiresTransition(withoutCue), flowFiresTransition(null)],
		[true, false, undefined],
	);
	eq(
		'…a library function it calls counts, read only when its own graphs do not fire it',
		[
			flowFiresTransition(calls),
			flowFiresTransition(calls, library),
			await flowFiresTransitionWith(calls, async () => library),
			await flowFiresTransitionWith(seed, async () => {
				throw new Error('the library is not read');
			}),
		],
		[false, true, true, true],
	);
	const chips = (layout: Parameters<typeof buildGameProfile>[0]['layout']) =>
		buildGameProfile({
			gameTypeId: 'lines',
			gameTypeName: 'Lines',
			config: null,
			configSource: 'template',
			symbols: {} as Parameters<typeof buildGameProfile>[0]['symbols'],
			runtimeId: null,
			protocol: null,
			layout,
		}).features.map((c) => c.id);
	const on = { authoredTransition: 'off', authoredWin: 'off', transitionCue: 'screen' } as const;
	eq(
		'Game Maker warns when the flow never fires transition (only with the row on)',
		[
			chips({ ...on, transitionCueUnfired: true }).filter((id) => id.startsWith('transitionCue')),
			chips({ ...on, transitionCueUnfired: false }).filter((id) => id.startsWith('transitionCue')),
			chips({ ...on, transitionCue: 'off', transitionCueUnfired: true }).filter((id) =>
				id.startsWith('transitionCue'),
			),
		],
		[['transitionCue', 'transitionCueUnfired'], ['transitionCue'], []],
	);
}

// ---- 6. the cue palette ---------------------------------------------------------------------------
{
	const settings = {
		postFx: [
			entry('a', 'glow', { trigger: 'cue', cue: ' gradeOn ', stopCue: 'gradeOff' }),
			entry('b', 'shine', { trigger: 'cue', cue: 'never', disabled: true }),
		],
	};
	eq(
		'the post FX cues are harvested (trimmed, a disabled entry’s not)',
		collectSceneCueNames([], [], undefined, undefined, settings),
		['gradeOff', 'gradeOn'],
	);
	eq('without the settings, none', collectSceneCueNames([]), []);
	const seed = freshDrivenSeedDoc('lines');
	const doc: FlowDoc = {
		...seed,
		graph: {
			...seed.graph,
			nodes: [
				...seed.graph.nodes,
				{ id: 'grade', kind: 'fireCue', pos: { x: 0, y: 0 }, ref: 'gradeOn' },
			],
		},
	};
	const unresolved = (s?: typeof settings) =>
		validateFlowV2Against(
			doc,
			[],
			null,
			{ version: 2, functions: [] },
			[],
			undefined,
			[],
			undefined,
			s,
		).some((i) => i.at?.on === 'node' && i.at.node === 'grade' && i.code === 'ref-unresolved');
	check(
		'the publish gate resolves a Fire Cue on a post FX cue given the settings',
		!unresolved(settings),
	);
	check('…and not without them (so the settings are what resolves it)', unresolved());
}

// ---- 7. no new capability -------------------------------------------------------------------------
eq(
	'a non-publisher’s save that sets the cue row, post FX and the switch is written',
	authoredOverlaySaveDecision({
		before: { settings: {} },
		after: {
			settings: {
				transitionCue: { kind: 'burn' },
				postFx: [entry('a', 'glow')],
				stageFxAntialias: true,
			},
		},
		canPublish: false,
		baseEtag: '"e"',
		storedEtag: '"e"',
	}),
	'write',
);

// ---- 8. the wiring --------------------------------------------------------------------------------
{
	const page = src('../src/routes/(app)/editor/+page.svelte');
	const block = src('../src/routes/(app)/editor/EditorScreenFx.svelte');
	const list = src('../src/routes/(app)/editor/EditorElementFx.svelte');
	eq(
		'the page builds settings through the block’s helper, and a doc with only Screen FX keeps them',
		[
			page.includes(
				'const screenFx = screenFxSettings({ transitionCue, postFx, stageFxAntialias });',
			),
			/!authoredOverlays && !screenFxSet\)/.test(page),
			/Object\.assign\(settings, screenFx\);\s*return settings;/.test(page),
			page.includes('data.doc.settings?.postFx') &&
				page.includes('data.doc.settings?.stageFxAntialias === true') &&
				page.includes('data.doc.settings?.transitionCue'),
		],
		[true, true, true, true],
	);
	eq(
		'Game Settings renders the block, after Authored overlays and before Boot splash',
		(() => {
			const at = (s: string) => page.indexOf(s);
			return [
				at('<EditorScreenFx') > at('<span>Buttons</span>'),
				at('<EditorScreenFx') < at('<strong>Boot splash</strong>'),
			];
		})(),
		[true, true],
	);
	eq(
		'the block holds the list to the stage: its triggers, no keying, the caps, the kind filter, its ▶',
		[
			block.includes('triggers={STAGE_FX_TRIGGERS}'),
			block.includes('keyable={false}'),
			block.includes('maxEntries={STAGE_FX_LIMITS.entries}'),
			block.includes('{kindRefusal}'),
			block.includes('preview={previewPostFx}'),
		],
		[true, true, true, true, true],
	);
	eq(
		'the cue row: first in the block, the wipe by default, set through the game’s reader, told whether the flow fires transition',
		[
			block.indexOf('data-row="transition-cue"') < block.indexOf('data-row="post-fx"'),
			block.includes('<option value="">The wipe</option>'),
			block.includes('onTransitionCueChange(next ? readScreenTransition(next) : undefined)'),
			page.includes('flowFiresTransition={data.flowFiresTransition}'),
			src('../src/routes/(app)/editor/+page.server.ts').includes(
				'const firesTransition = await flowFiresTransitionWith(flowDoc,',
			),
			/transitionCueUnfired =\s*chips\?\.transitionCue === 'screen' &&/.test(
				src('../src/routes/(app)/game-maker/+page.server.ts'),
			),
		],
		[true, true, true, true, true, true],
	);
	const canvas = src('../src/routes/(app)/editor/EditorCanvas.svelte');
	const stage = src('../src/routes/(app)/editor/stagePreview.client.ts');
	eq(
		'▶ on the stage goes through the game’s runtime: post FX in stage mode on an app’s root, the cue row through playScreenTransition, the project’s anti-aliasing passed on',
		[
			page.includes("playElementFxPreview({ kind: 'stage', antialias: stageFxAntialias }, entry)"),
			page.includes('playScreenTransitionPreview({'),
			canvas.includes("if (target.kind === 'stage') {") &&
				canvas.includes('playPostFxOnStage({ ...overlay, entry })'),
			canvas.includes('addScreenTransitionPreviewHandler(previewScreenTransition)'),
			stage.includes('const unbind = bindStagePostFx(app);') &&
				/playElementFx\(\s*app\.stage,/.test(stage),
			/playScreenTransition\(\s*app,/.test(stage),
			stage.includes('setStageFxAntialias(app, options.antialias);'),
		],
		[true, true, true, true, true, true, true],
	);
	eq(
		'the cue row’s ▶ plays into a screen the stage does not show, shown for that play only',
		[
			/offStageScreens=\{scenes\s*\.filter\(\(s\) => screensOffStage\.has\(s\.id\)\)/.test(page),
			page.includes('reveal: into') &&
				page.includes('(on) => (transitionPreviewScene = on ? into : null)'),
			/const canvasHiddenScenes = \$derived\(\s*transitionPreviewScene && screensOffStage\.has\(transitionPreviewScene\)/.test(
				page,
			),
		],
		[true, true, true],
	);
	eq(
		'the list greys a refused kind with its reason, and refuses it on add and on change',
		[
			list.includes('disabled={!!refusal} title={refusal}'),
			list.includes("{refusal ? ` — ${refusal}` : ''}"),
			list.includes('if (full || kindRefusal?.(kind, undefined)) return;'),
			list.includes('if (!spec || kindRefusal?.(kind, index)) return;'),
		],
		[true, true, true, true],
	);
}

if (fails) {
	console.error(`\n${fails} of ${fails + passes} check(s) failed`);
	process.exit(1);
}
console.log(`screen fx editor: all ${passes} checks passed`);
