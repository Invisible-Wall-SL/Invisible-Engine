/**
 * The Outline's hierarchy edits and its editor-only Hide / Isolate (Rive plan Phase 9a):
 *   pnpm --filter launcher-api check:editor-hierarchy
 *
 *  1. the tree walk `Esc` / `Enter` use, and Lock applying to children;
 *  2. drag to reorder (z-order) and re-parent, with the refusals: onto itself, into its own
 *     subtree, `inside` a leaf; a drop that lands where the node already was reports no change;
 *  3. Hide and Isolate: which ids the stage skips (children included; an isolated node keeps its
 *     containers; an unknown id isolates nothing), the tree is never changed, and the stage seam
 *     (`previewResolveTransform`) hides a node while the authored transform still says visible;
 *  4. a source scan: the view state stays in the two hosts and the draw seam, and the hosts'
 *     Hide / Isolate toggles never touch a node or mark the doc dirty — so nothing of it can reach
 *     the saved layout or component, and a game draws exactly what it drew before.
 *
 * What it cannot prove: the drag gesture and the menu in a browser — the owner's check.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTransform, type LayoutNode } from 'engine-layout';
import {
	ancestorIds,
	canDrop,
	dropZoneAt,
	effectiveHiddenIds,
	firstChildIdOf,
	lockedInTree,
	moveNode,
	parentIdOf,
} from '../src/lib/editor/hierarchy.ts';

// The draw seam is a `.svelte.ts` module: its one rune is a plain holder outside the compiler.
(globalThis as unknown as { $state: <T>(v: T) => T }).$state = (v) => v;
const V = await import('../src/routes/(app)/editor/valuePreview.client.svelte.ts');

let checks = 0;
let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures++;
	console.error(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`);
}

const leaf = (id: string, extra: Partial<LayoutNode> = {}): LayoutNode =>
	({ id, kind: 'sprite', x: 0, y: 0, assetKey: 'a', ...extra }) as LayoutNode;
const group = (id: string, children: LayoutNode[], extra: Partial<LayoutNode> = {}): LayoutNode =>
	({ id, kind: 'container', x: 0, y: 0, children, ...extra }) as LayoutNode;

/** bg · panel[title · row[a · b]] · fg */
function tree(): LayoutNode[] {
	return [
		leaf('bg'),
		group('panel', [leaf('title'), group('row', [leaf('a'), leaf('b')])]),
		leaf('fg'),
	];
}
function shape(nodes: LayoutNode[]): unknown[] {
	return nodes.map((n) => (n.kind === 'container' ? { [n.id]: shape(n.children) } : n.id));
}

// ── 1. walking the tree ────────────────────────────────────────────────────────
{
	const t = tree();
	check('ancestors of a nested leaf, outermost first', ancestorIds(t, 'a'), ['panel', 'row']);
	check('a top-level node has none', ancestorIds(t, 'bg'), []);
	check('an unknown id is not in the tree', ancestorIds(t, 'nope'), null);
	check('Esc: a nested node selects its container', parentIdOf(t, 'a'), 'row');
	check('Esc: a top-level node has no parent (deselects)', parentIdOf(t, 'panel'), null);
	check('Enter: a container selects its first child', firstChildIdOf(t, 'panel'), 'title');
	check('Enter: a leaf has no child', firstChildIdOf(t, 'bg'), null);
	check('Enter: an empty container has no child', firstChildIdOf([group('g', [])], 'g'), null);

	const locked = [group('panel', [leaf('title'), group('row', [leaf('a')])], { locked: true })];
	check('lock applies to children', lockedInTree(locked, 'a'), true);
	check('the locked node itself', lockedInTree(locked, 'panel'), true);
	check('an unlocked tree', lockedInTree(tree(), 'a'), false);
	check(
		'a sibling of a locked node is free',
		lockedInTree([leaf('x', { locked: true }), leaf('y')], 'y'),
		false,
	);
}

// ── 2. drag: reorder and re-parent ────────────────────────────────────────────
{
	check('a container row: middle half drops inside', dropZoneAt(10, 20, true), 'inside');
	check('a container row: top quarter drops before', dropZoneAt(4, 20, true), 'before');
	check('a container row: bottom quarter drops after', dropZoneAt(17, 20, true), 'after');
	check('a leaf row: top half before', dropZoneAt(9, 20, false), 'before');
	check('a leaf row: bottom half after', dropZoneAt(11, 20, false), 'after');

	let t = tree();
	check('reorder: fg before bg', moveNode(t, 'fg', 'bg', 'before'), true);
	check('  → fg paints first', shape(t), ['fg', 'bg', { panel: ['title', { row: ['a', 'b'] }] }]);

	t = tree();
	check('re-parent: bg inside row', moveNode(t, 'bg', 'row', 'inside'), true);
	check('  → last child (drawn on top)', shape(t), [
		{ panel: ['title', { row: ['a', 'b', 'bg'] }] },
		'fg',
	]);

	t = tree();
	check('out of a container: a after panel', moveNode(t, 'a', 'panel', 'after'), true);
	check('  → top level, after panel', shape(t), [
		'bg',
		{ panel: ['title', { row: ['b'] }] },
		'a',
		'fg',
	]);

	t = tree();
	check('within a container: b before a', moveNode(t, 'b', 'a', 'before'), true);
	check('  → row is b, a', shape(t), ['bg', { panel: ['title', { row: ['b', 'a'] }] }, 'fg']);

	t = tree();
	const before = JSON.stringify(t);
	check('refused: onto itself', moveNode(t, 'bg', 'bg', 'after'), false);
	check('refused: into its own subtree', moveNode(t, 'panel', 'row', 'inside'), false);
	check('refused: after its own descendant', moveNode(t, 'panel', 'a', 'after'), false);
	check('refused: inside a leaf', moveNode(t, 'fg', 'bg', 'inside'), false);
	check('refused: an unknown id', moveNode(t, 'nope', 'bg', 'after'), false);
	check('canDrop agrees', canDrop(t, 'panel', 'row', 'inside'), false);
	check('a refused drop changes nothing', JSON.stringify(t), before);
	check(
		'no-op: bg after… bg’s own slot (before panel)',
		moveNode(t, 'bg', 'panel', 'before'),
		false,
	);
	check('  → unchanged', JSON.stringify(t), before);

	t = tree();
	const moved = t[2];
	moveNode(t, 'fg', 'row', 'inside');
	check(
		'the moved node is the same object (no clone, no new id)',
		(t[1] as { children: LayoutNode[] }).children[1].kind === 'container' &&
			(t[1] as { children: { children: LayoutNode[] }[] }).children[1].children[2] === moved,
		true,
	);
}

// ── 3. Hide / Isolate ─────────────────────────────────────────────────────────
{
	const t = tree();
	const snapshot = JSON.stringify(t);
	const sorted = (s: Set<string>): string[] => [...s].sort();

	check('nothing hidden', sorted(effectiveHiddenIds(t, new Set(), null)), []);
	check(
		'hiding a container hides its subtree',
		sorted(effectiveHiddenIds(t, new Set(['row']), null)),
		['a', 'b', 'row'],
	);
	check('hiding a leaf hides only it', sorted(effectiveHiddenIds(t, new Set(['fg']), null)), [
		'fg',
	]);
	check(
		'isolate a nested leaf: its containers stay, everything else goes',
		sorted(effectiveHiddenIds(t, new Set(), 'a')),
		['b', 'bg', 'fg', 'title'],
	);
	check(
		'isolate a container: its whole subtree stays',
		sorted(effectiveHiddenIds(t, new Set(), 'row')),
		['bg', 'fg', 'title'],
	);
	check(
		'isolate an id from another screen: nothing',
		sorted(effectiveHiddenIds(t, new Set(), 'other')),
		[],
	);
	check(
		'an explicit hide inside the isolated subtree still hides',
		sorted(effectiveHiddenIds(t, new Set(['b']), 'row')),
		['b', 'bg', 'fg', 'title'],
	);
	check('Hide / Isolate never change the tree', JSON.stringify(t), snapshot);

	const node = leaf('n');
	const authored = JSON.stringify(node);
	V.setViewHidden(new Set(['n']));
	check('the stage seam hides it', V.previewResolveTransform(node, 'desktop').visible, false);
	check('isViewHidden', V.isViewHidden('n'), true);
	check(
		'the authored transform still says visible',
		resolveTransform(node, 'desktop').visible,
		true,
	);
	check('the node is untouched', JSON.stringify(node), authored);
	V.setViewHidden(new Set());
	check('shown again', V.previewResolveTransform(node, 'desktop').visible, true);
	const hiddenByDoc = leaf('h', { visibleFor: ['mobile'] } as Partial<LayoutNode>);
	check(
		'a node the doc hides on this layout stays hidden with no view state',
		V.previewResolveTransform(hiddenByDoc, 'desktop').visible,
		false,
	);
}

// ── 4. source scan: the view state never reaches a doc ──────────────────────────
{
	const here = fileURLToPath(new URL('.', import.meta.url));
	const root = join(here, '..');
	/** Source with its comments removed, so a doc line naming a symbol is not a use of it. */
	const code = (text: string): string =>
		text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
	const read = (p: string): string => code(readFileSync(join(root, p), 'utf8'));
	const walk = (dir: string, out: string[] = []): string[] => {
		for (const name of readdirSync(dir)) {
			const p = join(dir, name);
			if (statSync(p).isDirectory()) walk(p, out);
			else if (/\.(ts|svelte|js|mjs)$/.test(name)) out.push(p);
		}
		return out;
	};
	const importers = walk(join(root, 'src'))
		.filter((p) => /\bsetViewHidden\b/.test(code(readFileSync(p, 'utf8'))))
		.map((p) => p.slice(root.length + 1).replaceAll('\\', '/'))
		.sort();
	check('only the draw seam and the two hosts name setViewHidden', importers, [
		'src/routes/(app)/editor/+page.svelte',
		'src/routes/(app)/editor/ComponentWorkspace.svelte',
		'src/routes/(app)/editor/valuePreview.client.svelte.ts',
	]);
	check(
		'hierarchy.ts never writes `visible`',
		/visible/.test(read('src/lib/editor/hierarchy.ts')),
		false,
	);

	const fnBody = (src: string, name: string): string => {
		const start = src.indexOf(`function ${name}(`);
		if (start === -1) return '';
		let depth = 0;
		for (let i = src.indexOf('{', start); i < src.length; i++) {
			if (src[i] === '{') depth++;
			else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
		}
		return '';
	};
	for (const host of [
		'src/routes/(app)/editor/+page.svelte',
		'src/routes/(app)/editor/ComponentWorkspace.svelte',
	]) {
		const src = read(host);
		for (const fn of ['toggleOutlineHidden', 'toggleIsolate']) {
			const body = fnBody(src, fn);
			check(`${host}: ${fn} exists`, body.length > 0, true);
			check(
				`${host}: ${fn} touches no node and marks nothing dirty`,
				/visible|markDirty|editNonce|scenes|findById|\.locked/.test(body),
				false,
			);
		}
	}
}

if (failures > 0) {
	console.error(`\ncheck:editor-hierarchy — ${failures} of ${checks} checks FAILED`);
	process.exit(1);
}
console.log(`check:editor-hierarchy — ${checks} checks passed`);
