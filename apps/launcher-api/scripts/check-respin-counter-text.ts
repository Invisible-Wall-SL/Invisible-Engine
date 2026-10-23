/**
 * Guard THE AUTHORABLE RESPIN COUNTER TEXT, offline.
 *
 * Run: `pnpm --filter launcher-api run check:respin-counter-text`
 *
 * WHY. The coded respin counter draws "RESPINS 3" / "3 RESPINS" / "RESPINS RESET" / "LAST RESPIN" in
 * hard-coded Arial, with the modifiers line under it. A project replaces it with an authored Respin
 * Counter bound to the `respinCounterText` source (or to `respinsLeft` plus its own reset look on the
 * `respinReset` signal). Three promises make that work, and each breaks silently — the authored
 * counter reads a different line than the coded one did, or the Arial text keeps drawing on top, or
 * a reset pop plays twice or never:
 *
 *  1. **Same strings.** The sources an authored counter binds are fed by the very functions the coded
 *     counter draws, and those functions say what the coded counter says on every beat.
 *  2. **Nothing coded on top.** An authored counter part with content of its own draws only that: no
 *     coded count line, no coded modifiers line; the coded default steps aside for any authored
 *     counter. Only an empty part draws the coded look (parity for projects that author none).
 *     The editor offers the new feeds on a counter saved before they existed, too.
 *  3. **The signals.** `respinReset` fires once per reset and `respinAward` once per award, from the
 *     beats that set the counter's note.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'svelte/compiler';
import {
	ENGINE_SIGNAL_CATALOG,
	HOLD_AND_WIN_PARAM_CATALOG,
	HOLD_AND_WIN_VALUE_SOURCE_KEYS,
	RESPIN_COUNTER_DEF,
	WIN_TEXT_DEFAULTS,
	formatWinText,
	type ResolvedWinText,
} from 'engine-layout';

import {
	createEventEmitter,
	type EmitterEventBase,
} from '../../../packages/utils-event-emitter/index.ts';
import { HOLD_AND_WIN_VOCAB } from 'engine-flow-v2';

import { featureComponentSignals } from '../../lines/src/game/featureSignals.ts';
import { LINES_EMITTER_VOCABULARY } from '../../lines/src/game/emitterVocabulary.ts';
import { compileSlice, stripSliceTypes } from '../../../scripts/lib/compile-slice.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

let fails = 0;
const check = (name: string, ok: boolean): void => {
	if (!ok) {
		fails++;
		console.error('FAIL:', name);
	}
};
const eq = (name: string, actual: unknown, expected: unknown): void =>
	check(
		`${name} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
		JSON.stringify(actual) === JSON.stringify(expected),
	);
const sliceBetween = (text: string, what: string, from: string, to: string): string => {
	const start = text.indexOf(from);
	if (start < 0) throw new Error(`${what}: could not find "${from}"`);
	const end = text.indexOf(to, start + from.length);
	if (end < 0) throw new Error(`${what}: could not find "${to}" after it`);
	return text.slice(start, end + to.length);
};
const unexport = (what: string, slice: string): string =>
	stripSliceTypes(what, slice).replaceAll('export const', 'const');

const GAME = 'apps/lines/src/components/Game.svelte';
const ART = 'apps/lines/src/components/RespinCounterArt.svelte';
const PART = 'apps/lines/src/components/RespinCounterPart.svelte';
const CODED = 'apps/lines/src/components/RespinCounter.svelte';
const LINE = 'apps/lines/src/game/respinCounterLine.ts';
const TEXT = 'apps/lines/src/game/holdAndWinText.ts';
const PRESENTATION = 'apps/lines/src/game/holdAndWinPresentation.ts';

// --- 1. same strings ---
const game = read(GAME);
check(
	'the game feeds `respinCounterText` from the coded counter’s own line',
	/\brespinCounterText: textSource\(respinCounterLine\),/.test(game),
);
check(
	'…`respinCounterNote` from the counter’s note',
	/\brespinCounterNote: textSource\(respinCounterNote\),/.test(game),
);
check(
	'…and `activeModifiers` from the coded modifiers line',
	/\bactiveModifiers: textSource\(activeModifiersText\),/.test(game),
);
const art = read(ART);
check('the coded counter draws that same line', /\btext=\{respinCounterLine\(\)\}/.test(art));
check(
	'…and that same modifiers line',
	/const modifiers = \$derived\(activeModifiersText\(\)\);/.test(art) &&
		/\btext=\{modifiers\}/.test(art),
);

const templates = read(TEXT);
const lineSource = read(LINE);
const counter = { left: 3, note: null as 'award' | 'reset' | null };
let winText: ResolvedWinText = WIN_TEXT_DEFAULTS;
const shown = compileSlice({
	what: 'check-respin-counter-text#the counter line',
	names: ['stateRespinBoard', 'modeWinText', 'formatWinText'],
	body: `${unexport(
		'holdAndWinText.ts#respinCounterText',
		sliceBetween(templates, 'respinCounterText', 'export const respinCounterText = (', '\n};\n'),
	)}
${unexport(
	'respinCounterLine.ts',
	sliceBetween(lineSource, 'respinCounterLine', 'export const respinCounterLine = ', ';\n') +
		sliceBetween(lineSource, 'respinCounterNote', 'export const respinCounterNote = ', ';\n'),
)}
return { respinCounterLine, respinCounterNote };`,
})({ counter }, () => winText, formatWinText) as {
	respinCounterLine: () => string;
	respinCounterNote: () => string;
};
const beat = (left: number, note: 'award' | 'reset' | null) => {
	counter.left = left;
	counter.note = note;
	return [shown.respinCounterLine(), shown.respinCounterNote()];
};
eq('the award as the feature opens', beat(3, 'award'), ['3 RESPINS', 'award']);
eq('a reset while its pulse plays', beat(3, 'reset'), ['RESPINS RESET', 'reset']);
eq('the count otherwise', beat(2, null), ['RESPINS 2', '']);
eq('the last respin', beat(1, null), ['LAST RESPIN', '']);
winText = {
	...WIN_TEXT_DEFAULTS,
	respins: { ...WIN_TEXT_DEFAULTS.respins, counter: 'SPINS {count}', reset: '' },
};
eq('an authored line is read, and an emptied note falls back to it', beat(3, 'reset'), [
	'SPINS 3',
	'reset',
]);

for (const key of ['respinCounterText', 'respinCounterNote', 'activeModifiers']) {
	check(
		`the editor offers \`${key}\` as a text source`,
		HOLD_AND_WIN_PARAM_CATALOG.some((p) => p.key === key && p.kind === 'string') &&
			HOLD_AND_WIN_VALUE_SOURCE_KEYS.includes(key),
	);
	check(
		`…and the Respin Counter's source picks it`,
		RESPIN_COUNTER_DEF.params.find((p) => p.key === 'source')?.options?.includes(key) === true,
	);
}

// --- 2. nothing coded on top ---
type AstNode = { type: string; name?: string; start: number; end: number; [key: string]: unknown };
const walk = (node: unknown, visit: (n: AstNode) => void): void => {
	if (!node || typeof node !== 'object') return;
	if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
	const n = node as AstNode;
	if (typeof n.type === 'string') visit(n);
	for (const [key, value] of Object.entries(n)) if (key !== 'metadata') walk(value, visit);
};
const components = (node: unknown): string[] => {
	const names: string[] = [];
	walk(node, (n) => {
		if (n.type === 'Component' && n.name) names.push(n.name);
	});
	return names;
};
const part = read(PART);
const partAst = parse(part, { modern: true });
const top = partAst.fragment.nodes.find((n) => n.type === 'IfBlock');
const src = (n: { start: number; end: number }) => part.slice(n.start, n.end);
check('the part branches on its template', top !== undefined);
if (top && top.type === 'IfBlock') {
	eq('…a stand-in first', src(top.test), 'standIn');
	eq('…which draws only the anchor', components(top.consequent), ['Anchor']);
	const inner = top.alternate?.nodes.find((n) => n.type === 'IfBlock');
	check('…then its own content', inner?.type === 'IfBlock' && src(inner.test) === 'skin');
	if (inner && inner.type === 'IfBlock') {
		eq(
			'an authored part with content draws only that content — no coded line, no modifiers line',
			components(inner.consequent),
			['Container', 'Anchor'],
		);
		check(
			'…its content being the authored nodes',
			/\{@render skin\(\)\}/.test(src(inner.consequent)),
		);
		eq('only an empty part draws the coded look', components(inner.alternate), [
			'RespinCounterArt',
		]);
	}
}
check(
	'the part counts in for every branch, so the coded default steps aside',
	/\$effect\(\(\) => untrack\(\(\) => trackComponentMount\(RESPIN_COUNTER_ANCHOR\)\)\);/.test(part),
);
check(
	'a part gets content exactly when its node has children',
	/node\.kind === 'container' && node\.children\.length > 0 \? \{ skin: authoredChildren \} : \{\}/.test(
		read('packages/engine-layout/src/lib/LayoutNodeView.svelte'),
	),
);
check(
	'the coded default draws only while no authored counter is mounted',
	/\{#if stateRespinBoard\.counter\.show && !isComponentMounted\(RESPIN_COUNTER_ANCHOR\)\}/.test(
		read(CODED),
	),
);
const art2 = parse(art, { modern: true });
eq(
	'the coded look is two texts and nothing else',
	components(art2.fragment).filter((n) => n === 'Text').length,
	2,
);

// The editor's `source` dropdown on a Hold and Win panel reads the live catalog, so a copy saved
// before these feeds existed (its options snapshotted) still offers them.
const properties = read('apps/launcher-api/src/routes/(app)/editor/EditorProperties.svelte');
const paramOptions = compileSlice({
	what: 'check-respin-counter-text#paramOptions',
	names: ['HOLD_AND_WIN_VALUE_SOURCE_KEYS'],
	body: `${stripSliceTypes(
		'EditorProperties.svelte#paramOptions',
		sliceBetween(properties, 'paramOptions', 'function paramOptions(', '\n\t}\n'),
	)}
return paramOptions;`,
})(HOLD_AND_WIN_VALUE_SOURCE_KEYS) as (
	p: { key: string; options?: string[] },
	current: unknown,
) => string[];
const oldCopy = { key: 'source', options: ['respinsLeft', 'activeModifiers', 'bet'] };
check(
	'a counter copy saved before the new feeds offers them',
	['respinCounterText', 'respinCounterNote'].every((k) => paramOptions(oldCopy, '').includes(k)) &&
		paramOptions(oldCopy, '').includes('bet'),
);
eq(
	'a non-Hold-and-Win dropdown keeps its own list',
	paramOptions({ key: 'source', options: ['bet', 'win'] }, ''),
	['bet', 'win'],
);
eq(
	'…plus a current value not in it',
	paramOptions({ key: 'source', options: ['bet', 'win'] }, 'activeModifiers'),
	['bet', 'win', 'activeModifiers'],
);
eq(
	'both of the panel’s dropdowns read it',
	properties.match(/\{#each paramOptions\(p, /g)?.length,
	2,
);

// --- 3. the signals ---
check(
	'the catalog offers the award and reset signals',
	['respinAward', 'respinReset'].every((key) =>
		ENGINE_SIGNAL_CATALOG.some((s) => s.key === key && s.capability === 'holdAndWin'),
	),
);
const presentation = read(PRESENTATION);
const update = sliceBetween(
	presentation,
	'presentRespinUpdate',
	'export const presentRespinUpdate = ',
	'\n};\n',
);
eq(
	'a counter update broadcasts its cue once',
	update.match(/type: 'respinCounterUpdate'/g)?.length,
	1,
);
check(
	'…carrying the reset that sets the note',
	/if \(event\.reset\) \{[^}]*counter\.note = 'reset';/.test(update) &&
		/reset: event\.reset,/.test(update),
);
const trigger = sliceBetween(
	presentation,
	'presentHoldAndWinTrigger',
	'export const presentHoldAndWinTrigger = ',
	'\n};\n',
);
check(
	'the award beat sets the note and broadcasts the award once',
	/counter\.note = 'award';/.test(trigger) &&
		trigger.match(/type: 'respinCounterAward'/g)?.length === 1,
);
eq('…and nothing else broadcasts it', presentation.match(/type: 'respinCounterAward'/g)?.length, 1);

check(
	'the award cue is in the game’s emitter vocabulary and Flow v2’s Hold and Win cues',
	LINES_EMITTER_VOCABULARY.events.some((e) => e.type === 'respinCounterAward') &&
		HOLD_AND_WIN_VOCAB.cues.some((c) => c.name === 'respinCounterAward'),
);

const { eventEmitter } = createEventEmitter<EmitterEventBase & Record<string, unknown>>();
const live = featureComponentSignals(
	eventEmitter as unknown as Parameters<typeof featureComponentSignals>[0],
	true,
);
const fired: string[] = [];
for (const [signal, source] of Object.entries(live)) source.subscribe(() => fired.push(signal));
const round: (EmitterEventBase & Record<string, unknown>)[] = [
	{ type: 'respinBoardShow' },
	{ type: 'respinCounterAward', left: 3 },
	{ type: 'respinCounterUpdate', left: 2, start: 3, reset: false },
	{ type: 'respinCounterUpdate', left: 3, start: 3, reset: true },
	{ type: 'respinAddRespins', cell: { reel: 0, row: 0 }, added: 2, left: 5, total: 5 },
	{ type: 'respinCounterUpdate', left: 4, start: 5, reset: false },
	{ type: 'respinCounterUpdate', left: 5, start: 5, reset: true },
	{ type: 'respinCounterUpdate', left: 1, start: 5, reset: false },
];
for (const event of round) eventEmitter.broadcast(event);
eq(
	'over a round with two resets: respinReset twice, respinAward once',
	[
		fired.filter((s) => s === 'respinReset').length,
		fired.filter((s) => s === 'respinAward').length,
	],
	[2, 1],
);

if (fails > 0) {
	console.error(`\nrespin counter text: ${fails} check(s) failed`);
	process.exit(1);
}
console.info('respin counter text: all checks passed');
