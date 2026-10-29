/**
 * Guard the Scene Editor's Game Settings → SCREEN FX block (Shader Graph 8e,
 * `docs/design/shader-graph-screens.md` §9.2, step 6 phase A), offline, over the real modules.
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
 *     marks as playing are exactly `readPostFx`'s, in the reader's order.
 *  4. **The load line** is the compiled cost × the reference phone's pixels against the post FX
 *     budget, and a kind without a compiled cost says so.
 *  5. **The settings are sparse**: `postFx` only with an entry, `stageFxAntialias` only when on.
 *  6. **The cue palette** harvests the post FX cues, and the publish gate's vocabulary resolves a
 *     Fire Cue on one only given the doc's settings.
 *  7. **No new capability** (§16.11): a save that changes Screen FX is anyone's.
 *  8. **The wiring**, by source: the page builds `settings` through the block's helper and renders
 *     the block in Game Settings; the block is held to the stage's triggers and caps.
 */
import { readFileSync } from 'node:fs';
import {
	ELEMENT_FX,
	STAGE_FX_LIMITS,
	customElementFx,
	setCustomElementFx,
	type CustomElementFx,
	type ElementFxEntry,
	type ElementFxKindId,
} from 'constants-shared/elementFx';
import { freshDrivenSeedDoc, type FlowDoc } from 'engine-flow-v2';
import { readPostFx } from 'engine-layout';
import {
	POST_COST_BUDGET,
	POST_SAMPLE_BUDGET,
	REFERENCE_GRAPHS,
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
} from '../src/lib/screenFx';
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
	eq('nothing set: nothing written', screenFxSettings(undefined, false), {});
	eq('an empty list: nothing written', screenFxSettings([], false), {});
	const list = [entry('a', 'glow')];
	eq('a list and the switch', screenFxSettings(list, true), {
		postFx: list,
		stageFxAntialias: true,
	});
	check('the list is a copy', screenFxSettings(list, false).postFx !== list);
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
	'a non-publisher’s save that sets post FX and the switch is written',
	authoredOverlaySaveDecision({
		before: { settings: {} },
		after: { settings: { postFx: [entry('a', 'glow')], stageFxAntialias: true } },
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
			/const screenFx = screenFxSettings\(postFx, stageFxAntialias\);/.test(page),
			/!authoredOverlays && !screenFxSet\)/.test(page),
			/Object\.assign\(settings, screenFx\);\s*return settings;/.test(page),
			page.includes('data.doc.settings?.postFx') &&
				page.includes('data.doc.settings?.stageFxAntialias === true'),
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
		'the block holds the list to the stage: its triggers, no keying, the caps, the kind filter, no ▶ yet',
		[
			block.includes('triggers={STAGE_FX_TRIGGERS}'),
			block.includes('keyable={false}'),
			block.includes('maxEntries={STAGE_FX_LIMITS.entries}'),
			block.includes('{kindRefusal}'),
			/<EditorElementFx[^>]*\bpreview=/.test(block),
		],
		[true, true, true, true, false],
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
