/**
 * The editor's read-only Data tab and the Library's search and type filter (Rive plan Phase 9d):
 *   pnpm --filter launcher-api check:editor-data-library
 *
 *  1. Data: a component's inputs (with the signals not already inputs, as triggers), events with
 *     their payloads, params, and every bound value (a param binding and a value binding, nested
 *     nodes included), each bound row naming the node it selects;
 *  2. Library: a query matches every term across a row's names (case-insensitive), finds an atlas
 *     by a region inside it, an empty query shows everything, and the type filter shows one
 *     section; fonts and audio are read-only types.
 */
import type { ComponentDef } from 'engine-layout';
import { componentData } from '../src/lib/editor/componentData.ts';
import {
	LIBRARY_TYPES,
	filterRows,
	libraryMatches,
	queryTerms,
	showsType,
} from '../src/lib/editor/librarySearch.ts';

let failures = 0;
const eq = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.error(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}`);
	}
};

console.log('1. the Data tab');
const def = {
	id: 'badge',
	name: 'Badge',
	version: 1,
	scope: 'project',
	category: 'ui',
	inputs: [
		{ id: 'amount', kind: 'number', source: 'winAmount' },
		{ id: 'big', kind: 'bool', default: false },
		{ id: 'pop', kind: 'trigger' },
	],
	signals: [{ key: 'pop' }, { key: 'shine', note: 'from Flow' }],
	events: [{ id: 'tapped', payload: [{ name: 'x', type: { t: 'int' } }] }],
	params: [{ key: 'label', kind: 'string', default: 'WIN' }],
	root: {
		id: 'root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 't1',
				kind: 'text',
				label: 'Title',
				text: '',
				x: 0,
				y: 0,
				paramBindings: { text: 'label' },
			},
			{
				id: 'g',
				kind: 'container',
				x: 0,
				y: 0,
				children: [
					{
						id: 's1',
						kind: 'sprite',
						label: 'Glow',
						x: 0,
						y: 0,
						valueBindings: [
							{ target: 'alpha', source: 'winAmount' },
							{ target: 'x', param: 'offset' },
						],
					},
				],
			},
		],
	},
} as unknown as ComponentDef;
const data = componentData(def);
eq(
	'inputs, then the signals that are not inputs',
	data.inputs.map((r) => [r.name, r.kind]),
	[
		['amount', 'number'],
		['big', 'bool'],
		['pop', 'trigger'],
		['shine', 'trigger'],
	],
);
eq('an engine-fed input says where from', data.inputs[0].detail, 'from engine value "winAmount"');
eq('a default is shown', data.inputs[1].detail, 'default false');
eq('events with their payload', data.events, [
	{ name: 'tapped', kind: 'event', detail: 'payload: x:int' },
]);
eq('params', data.params, [{ name: 'label', kind: 'string', detail: 'default "WIN"' }]);
eq('bound values, nested nodes included, each naming its node', data.bound, [
	{ name: 'Title.text', kind: 'param', detail: '← param "label"', nodeId: 't1' },
	{ name: 'Glow.alpha', kind: 'value', detail: '← engine value "winAmount"', nodeId: 's1' },
	{ name: 'Glow.x', kind: 'value', detail: '← param "offset"', nodeId: 's1' },
]);
eq(
	'an empty def lists nothing',
	componentData({
		...def,
		inputs: undefined,
		signals: undefined,
		events: undefined,
		params: undefined,
		root: { id: 'r', kind: 'container', x: 0, y: 0, children: [] },
	} as unknown as ComponentDef),
	{ inputs: [], events: [], params: [], bound: [] },
);

console.log('2. the Library search and type filter');
const atlases = [
	{ name: 'Symbols', key: 'atlas/symbols' },
	{ name: 'UI', key: 'atlas/ui' },
];
const regions: Record<string, string[]> = { 'atlas/ui': ['btn_spin', 'btn_auto'] };
const by = (q: string) =>
	filterRows(
		atlases,
		queryTerms(q),
		(a) => [a.name, a.key],
		(a) => regions[a.key],
	).map((a) => a.name);
eq('an empty query shows everything', by(''), ['Symbols', 'UI']);
eq('case-insensitive on the name', by('symb'), ['Symbols']);
eq('every term must match', by('atlas ui'), ['UI']);
eq('an atlas is found by a region inside it', by('spin'), ['UI']);
eq('no match', by('zzz'), []);
eq('a region matches the query', libraryMatches(queryTerms('btn auto'), 'btn_auto'), true);
eq(
	'the type filter shows one section',
	showsType('font', 'font') && !showsType('font', 'rig'),
	true,
);
eq(
	'"all" shows every section',
	LIBRARY_TYPES.filter((t) => t.id !== 'all').every((t) => showsType('all', t.id as never)),
	true,
);
eq(
	'fonts and audio are listed read-only',
	LIBRARY_TYPES.filter((t) => t.label.includes('read-only')).map((t) => t.id),
	['font', 'audio'],
);

if (failures) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\ncheck:editor-data-library passed');
