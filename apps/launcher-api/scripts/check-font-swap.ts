/**
 * The Font Maker swap's rewrite rules (`fontSwapRewrite.ts`), headless:
 *   pnpm --filter launcher-api check:font-swap
 *
 *  1. matching goes through `findFont`: a ref by id or by name is the swapped font, a second
 *     font sharing its `<info face>` and a built-in family are not;
 *  2. every layout field is reached — text style, per-ratio style overrides, an instance's font
 *     params (base and per-ratio), a bound component's `props.style`, nested containers — and a
 *     `fontFamily` fallback list keeps its tail;
 *  3. a component def's font-param defaults and its tree are rewritten, its other params are not;
 *  4. Flow messages in the event graph and in a mode's graph;
 *  5. Symbols stores names: the target's name, or its id when another font answers to that name;
 *  6. nothing to swap ⇒ the doc is left byte-identical.
 */
import type { ComponentDef, FontCatalog, FontEntry, LayoutDoc } from 'engine-layout';
import type { FlowDoc } from 'engine-flow-v2';
import {
	fontRewrite,
	swapComponentDefaultsFonts,
	swapComponentDefFonts,
	swapFlowDocFonts,
	swapLayoutDocFonts,
	swapSymbolsDocFonts,
} from '../src/lib/server/fontSwapRewrite.ts';
import type { SymbolsDoc } from '../src/lib/server/symbolsStorage.ts';

/** Read a nested value off a fixture doc. */
const at = (obj: unknown, ...path: (string | number)[]): unknown =>
	path.reduce<unknown>((v, k) => (v as Record<string | number, unknown> | undefined)?.[k], obj);

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

const bitmap = (id: string, name: string): FontEntry =>
	({ id, name, kind: 'bitmap', folder: id }) as FontEntry;
const oldGold = bitmap('old-gold', 'Gold');
const goldVariant = bitmap('gold-shine', 'Gold');
const newGold = bitmap('new-gold', 'NewGold');
const catalog: FontCatalog = { prefix: '', fonts: [oldGold, goldVariant, newGold] };
const rw = fontRewrite(catalog, oldGold, newGold);

console.log('1. matching');
eq('id matches', rw.matches('old-gold'), true);
eq('name matches (first font by name)', rw.matches('Gold'), true);
eq('a variant sharing the face does not', rw.matches('gold-shine'), false);
eq('a built-in family does not', rw.matches('proxima-nova'), false);

console.log('2. layout doc');
const fontKeysOf = (id: string) => new Set(id === 'hudReadout' ? ['fontFamily'] : []);
const layout = {
	scenes: [
		{
			id: 's1',
			name: 'Base',
			nodes: [
				{ id: 't1', kind: 'text', label: 'Title', style: { fontFamily: 'old-gold' } },
				{
					id: 't2',
					kind: 'text',
					style: { fontFamily: ['Gold', 'Arial'] },
					overrides: { portrait: { style: { fontFamily: 'old-gold' } } },
				},
				{ id: 't3', kind: 'text', style: { fontFamily: 'gold-shine' } },
				{
					id: 'c1',
					kind: 'container',
					children: [
						{
							id: 'i1',
							kind: 'componentInstance',
							componentId: 'hudReadout',
							params: { fontFamily: 'old-gold', label: 'old-gold' },
							overrides: { landscape: { params: { fontFamily: 'old-gold' } } },
						},
						{
							id: 'b1',
							kind: 'sprite',
							bind: { component: 'HudValue', props: { style: { fontFamily: 'old-gold' } } },
						},
					],
				},
			],
		},
	],
} as unknown as LayoutDoc;
const layoutRefs = swapLayoutDocFonts(layout, rw, fontKeysOf);
const nodes = layout.scenes[0].nodes;
eq('six refs', layoutRefs.length, 6);
eq('text style', at(nodes, 0, 'style', 'fontFamily'), 'new-gold');
eq('fallback list keeps its tail', at(nodes, 1, 'style', 'fontFamily'), ['new-gold', 'Arial']);
eq('per-ratio style', at(nodes, 1, 'overrides', 'portrait', 'style', 'fontFamily'), 'new-gold');
eq('variant untouched', at(nodes, 2, 'style', 'fontFamily'), 'gold-shine');
const inst = at(nodes, 3, 'children', 0);
eq('instance font param', at(inst, 'params', 'fontFamily'), 'new-gold');
eq('instance non-font param untouched', at(inst, 'params', 'label'), 'old-gold');
eq(
	'instance per-ratio param',
	at(inst, 'overrides', 'landscape', 'params', 'fontFamily'),
	'new-gold',
);
eq(
	'bound props style',
	at(nodes, 3, 'children', 1, 'bind', 'props', 'style', 'fontFamily'),
	'new-gold',
);
eq('ref names the node', layoutRefs[0], 'Base › Title');

console.log('3. component def + defaults');
const def = {
	id: 'banner',
	name: 'Banner',
	params: [
		{ key: 'titleFont', kind: 'string', label: 'font', default: 'Gold' },
		{ key: 'caption', kind: 'string', default: 'Gold' },
	],
	root: {
		id: 'root',
		kind: 'container',
		children: [{ id: 'txt', kind: 'text', style: { fontFamily: 'old-gold' } }],
	},
} as unknown as ComponentDef;
eq('two refs', swapComponentDefFonts(def, rw, fontKeysOf).length, 2);
eq('font param default', def.params![0].default, 'new-gold');
eq('other param untouched', def.params![1].default, 'Gold');
const defaults: Record<string, unknown> = { fontFamily: 'old-gold', label: 'x' };
swapComponentDefaultsFonts(defaults, new Set(['fontFamily']), rw, 'hudReadout');
eq('defaults font key', defaults, { fontFamily: 'new-gold', label: 'x' });

console.log('4. flow');
const msg = (font: string) => ({ id: font, kind: 'textMessage', text: 'Hi', style: { font } });
const flow = {
	graph: { nodes: [msg('old-gold'), msg('proxima-nova')], exec: [], data: [] },
	modes: { freeSpins: { graph: { nodes: [msg('Gold')], exec: [], data: [] } } },
} as unknown as FlowDoc;
eq('two refs', swapFlowDocFonts(flow, rw).length, 2);
eq('event graph', at(flow.graph.nodes, 0, 'style', 'font'), 'new-gold');
eq('built-in untouched', at(flow.graph.nodes, 1, 'style', 'font'), 'proxima-nova');
eq('mode graph', at(flow.modes, 'freeSpins', 'graph', 'nodes', 0, 'style', 'font'), 'new-gold');

console.log('5. symbols');
const symbols = {
	winLine: { text: { font: 'Gold' } },
	coinLabel: { style: { font: 'old-gold' }, jackpots: { grand: { style: { font: 'Gold' } } } },
} as unknown as SymbolsDoc;
eq('three refs', swapSymbolsDocFonts(symbols, rw).length, 3);
eq('stores the name', at(symbols, 'winLine', 'text', 'font'), 'NewGold');
eq('jackpot tier', at(symbols, 'coinLabel', 'jackpots', 'grand', 'style', 'font'), 'NewGold');
const shadowed = fontRewrite(
	{ prefix: '', fonts: [oldGold, bitmap('other', 'Gold'), goldVariant] },
	oldGold,
	goldVariant,
);
eq('name taken by another font ⇒ id', shadowed.nameRef, 'gold-shine');

console.log('6. nothing to swap');
const untouched = { winLine: { text: { font: 'proxima-nova' } } } as unknown as SymbolsDoc;
const before = JSON.stringify(untouched);
eq('no refs', swapSymbolsDocFonts(untouched, rw), []);
eq('byte-identical', JSON.stringify(untouched), before);

if (failures) {
	console.error(`\n${failures} failure(s)`);
	process.exit(1);
}
console.log('\nall font-swap checks passed');
