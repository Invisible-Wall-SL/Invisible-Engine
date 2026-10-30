import {
	findFont,
	fontParamKeysOf,
	instanceParamMaps,
	type ComponentDef,
	type FontCatalog,
	type FontEntry,
	type LayoutDoc,
	type LayoutNode,
} from 'engine-layout';
import type { FlowDoc as FlowDocV2 } from 'engine-flow-v2';
import type { SymbolsDoc } from './symbolsStorage';

/**
 * The pure half of the Font Maker swap (`fontSwap.ts`): rewrite every reference to one font in a
 * doc, in place, and name where each was. No R2, so `check:font-swap` drives it directly.
 *
 * A doc stores a font by its catalog `id` (the editor, Component Editor and Flow pickers) or, in
 * older docs and the Symbols tool, by its `name`; the game resolves both through `findFont`. So a
 * stored ref is THE font being swapped exactly when `findFont` resolves it to that entry against
 * the catalog the game renders with — never by a string compare, which would also catch a second
 * font sharing the same `<info face>`, or a built-in family that happens to share the name.
 */

/** What a ref is rewritten to: the target's id, or its name in a doc that stores names. */
export interface FontRewrite {
	matches: (ref: string) => boolean;
	idRef: string;
	nameRef: string;
}

/** Build the rewrite for `from → to` against the catalog the game resolves refs through. */
export function fontRewrite(catalog: FontCatalog, from: FontEntry, to: FontEntry): FontRewrite {
	return {
		matches: (ref) => findFont(catalog, ref) === from,
		idRef: to.id,
		// A name-keyed doc keeps a name — unless another font answers to it first, when only the id
		// still picks the target.
		nameRef: findFont(catalog, to.name) === to ? to.name : to.id,
	};
}

/**
 * The rewritten value of a stored font field, or `undefined` when it is not the swapped font. A
 * `fontFamily` may be a fallback list, of which only the first entry names the font drawn.
 */
function swapRef(value: unknown, rw: FontRewrite, ref: string): unknown {
	if (typeof value === 'string') return rw.matches(value) ? ref : undefined;
	if (Array.isArray(value) && typeof value[0] === 'string' && rw.matches(value[0]))
		return [ref, ...value.slice(1)];
	return undefined;
}

/** Rewrite `obj[key]` when it names the swapped font; `true` when it did. */
function swapField(
	obj: Record<string, unknown> | undefined | null,
	key: string,
	rw: FontRewrite,
	ref = rw.idRef,
): boolean {
	if (!obj || typeof obj !== 'object') return false;
	const next = swapRef(obj[key], rw, ref);
	if (next === undefined) return false;
	obj[key] = next;
	return true;
}

export const isRecord = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);

/** The font param keys of a component, by id — what an instance's params are read against. */
export type FontKeysOf = (componentId: string) => Set<string>;

/**
 * Rewrite every font ref in a node tree, in place: a text node's style and its per-ratio style
 * overrides, a component instance's font params (base and per-ratio), and a bound component's
 * `props.style`. `where` names the tree in each reported ref.
 */
export function swapNodeFonts(
	nodes: LayoutNode[],
	rw: FontRewrite,
	fontKeysOf: FontKeysOf,
	where: string,
	refs: string[],
): void {
	for (const node of nodes) {
		const at = `${where} › ${node.label || node.id}`;
		if (node.kind === 'text' && swapField(node.style as Record<string, unknown>, 'fontFamily', rw))
			refs.push(at);
		for (const [ratio, o] of Object.entries(node.overrides ?? {})) {
			if (swapField(o?.style as Record<string, unknown>, 'fontFamily', rw))
				refs.push(`${at} (${ratio})`);
		}
		if (node.kind === 'componentInstance') {
			const keys = fontKeysOf(node.componentId);
			for (const params of instanceParamMaps(node)) {
				for (const key of keys) if (swapField(params, key, rw)) refs.push(`${at} · ${key}`);
			}
		}
		const props = node.bind?.props;
		if (isRecord(props) && isRecord(props.style) && swapField(props.style, 'fontFamily', rw))
			refs.push(at);
		if (node.kind === 'container') swapNodeFonts(node.children, rw, fontKeysOf, where, refs);
	}
}

/** Rewrite a layout doc's font refs in place; returns the refs found. */
export function swapLayoutDocFonts(
	doc: LayoutDoc,
	rw: FontRewrite,
	fontKeysOf: FontKeysOf,
): string[] {
	const refs: string[] = [];
	for (const scene of doc.scenes) swapNodeFonts(scene.nodes, rw, fontKeysOf, scene.name, refs);
	return refs;
}

/** Rewrite a component def's font refs in place: its font params' defaults and its node tree. */
export function swapComponentDefFonts(
	def: ComponentDef,
	rw: FontRewrite,
	fontKeysOf: FontKeysOf,
): string[] {
	const refs: string[] = [];
	const where = def.name || def.id;
	const keys = fontParamKeysOf(def);
	for (const p of def.params ?? []) {
		if (keys.has(p.key) && swapField(p as unknown as Record<string, unknown>, 'default', rw))
			refs.push(`${where} · default ${p.key}`);
	}
	swapNodeFonts([def.root], rw, fontKeysOf, where, refs);
	return refs;
}

/** Rewrite a component's per-project param defaults in place. */
export function swapComponentDefaultsFonts(
	params: Record<string, unknown>,
	keys: Set<string>,
	rw: FontRewrite,
	where: string,
): string[] {
	const refs: string[] = [];
	for (const key of keys) if (swapField(params, key, rw)) refs.push(`${where} · ${key}`);
	return refs;
}

/** Rewrite a Flow doc's message fonts in place — the event graph and every mode's graph. */
export function swapFlowDocFonts(doc: FlowDocV2, rw: FontRewrite): string[] {
	const refs: string[] = [];
	const graphs: [string, FlowDocV2['graph']][] = [
		['event graph', doc.graph],
		...Object.entries(doc.modes ?? {}).map(([mode, s]): [string, FlowDocV2['graph']] => [
			`${mode} graph`,
			s.graph,
		]),
	];
	for (const [where, graph] of graphs) {
		for (const node of graph?.nodes ?? []) {
			if (node.kind !== 'textMessage') continue;
			if (swapField(node.style as Record<string, unknown>, 'font', rw))
				refs.push(`${where} › message "${node.text}"`);
		}
	}
	return refs;
}

/** Rewrite the Symbols doc's fonts in place. The Symbols picker stores the font's NAME. */
export function swapSymbolsDocFonts(doc: SymbolsDoc, rw: FontRewrite): string[] {
	const refs: string[] = [];
	const text = doc.winLine?.text as Record<string, unknown> | undefined;
	if (swapField(text, 'font', rw, rw.nameRef)) refs.push('win line amount');
	const coin = doc.coinLabel;
	if (swapField(coin?.style as Record<string, unknown>, 'font', rw, rw.nameRef))
		refs.push('coin label');
	for (const [tier, j] of Object.entries(coin?.jackpots ?? {})) {
		if (swapField(j?.style as Record<string, unknown>, 'font', rw, rw.nameRef))
			refs.push(`coin label · ${tier} jackpot`);
	}
	return refs;
}
