/**
 * Guard that the Component Editor, the Scene Editor and the game cut a nested component at the
 * same level, offline.
 *
 * Run: `pnpm --filter launcher-api check:component-nesting-parity`
 *
 * WHY. The owner's Hold and Win TOTAL WIN widget (2026-10-23) holds the built-in Segmented
 * Counter. The Component Editor drew its 1 2 3 segments; the Scene Editor and the game drew none.
 * The counter spends two levels itself (counter → segment), so screen → widget → counter → segment
 * needs three, and the cap was 2. The Component Editor showed them only because it drew the open
 * def's nodes at level 0, a screen's level, where the game draws them one level down, inside the
 * placed instance.
 *
 * Load-bearing rules:
 *
 *  1. **Every built-in draws whole inside an author's component**: placed one level down, its
 *     deepest nested instance is still under `MAX_COMPONENT_DEPTH`.
 *  2. **The Component Editor draws the open def where the game does** (`componentEditorNest`): one
 *     level down, plus one per def it is edited inside, with those defs on the cycle stack.
 *  3. **It cuts at the same node as a screen placing the def** (`depthSegments`, the walk every
 *     layer shares): the nodes the Component Editor expands are the ones the screen expands under
 *     the instance, at every breadcrumb depth.
 *  4. **Every renderer starts at the canvas's nest** (source-scanned): the canvas hands
 *     `componentNest` to each rig / text / effect layer, no layer starts a walk at a literal level,
 *     and the Component Editor passes its breadcrumb's nest.
 *  5. **The breadcrumb opens what the game draws** (`canEnterNested`): a nested def opens in place
 *     exactly when its own instance, at its level, is under the cap.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
	BUILTIN_COMPONENTS,
	MAX_COMPONENT_DEPTH,
	collectComponentIds,
	type ComponentDef,
	type LayoutNode,
	type Scene,
} from 'engine-layout';

import { canEnterNested } from '../src/routes/(app)/editor/componentWorkspace';
import {
	SCREEN_NEST,
	componentEditorNest,
	depthSegments,
} from '../src/routes/(app)/editor/editorCanvas.helpers';

let fails = 0;
let passes = 0;
const check = (name: string, ok: boolean): void => {
	if (ok) passes++;
	else {
		fails++;
		console.error('FAIL:', name);
	}
};

// ── 1. built-ins inside an author's component ───────────────────────────────────────────────────

const builtins = new Map(BUILTIN_COMPONENTS.map((d) => [d.id, d]));
/** Levels of nested instances under `def` (0 = none), following the defs `collectComponentIds`
 * ships, as the renderers expand them. */
const nestedLevels = (def: ComponentDef, stack: string[]): number => {
	let max = 0;
	for (const id of collectComponentIds(def.root.children)) {
		const child = builtins.get(id);
		if (child && !stack.includes(id)) max = Math.max(max, 1 + nestedLevels(child, [...stack, id]));
	}
	return max;
};
for (const def of BUILTIN_COMPONENTS) {
	const levels = nestedLevels(def, [def.id]);
	if (levels === 0) continue;
	check(
		`built-in '${def.id}' placed inside a component draws all ${levels} of its own levels`,
		1 + levels < MAX_COMPONENT_DEPTH,
	);
}
check(
	'the Segmented Counter is one of them (its segments are a level of its own)',
	nestedLevels(builtins.get('segmentedCounter') as ComponentDef, ['segmentedCounter']) === 1,
);

// ── 2. the Component Editor's nest ──────────────────────────────────────────────────────────────

check(
	'a screen draws its nodes at level 0, inside nothing',
	SCREEN_NEST.depth === 0 && SCREEN_NEST.stack.length === 0,
);
const opened = componentEditorNest([], 'widget');
check(
	'a def opened from the list draws one level down, inside itself',
	opened.depth === 1 && opened.stack.join() === 'widget',
);
const inPlace = componentEditorNest(['outer', 'widget'], 'counter');
check(
	'a def edited in place draws one more level per def it is inside, all on the stack',
	inPlace.depth === 3 && inPlace.stack.join() === 'outer,widget,counter',
);

// ── 3. the same cut as a screen ─────────────────────────────────────────────────────────────────

/** A chain of defs L0 → L1 → … → L5, each holding a text and an instance of the next. */
const CHAIN = 6;
const defs = new Map<string, ComponentDef>();
for (let i = 0; i < CHAIN; i++) {
	const children: LayoutNode[] = [{ id: `t${i}`, kind: 'text', x: 0, y: 0, text: `L${i}` }];
	if (i + 1 < CHAIN)
		children.push({
			id: `i${i + 1}`,
			kind: 'componentInstance',
			componentId: `L${i + 1}`,
			x: 0,
			y: 0,
		});
	defs.set(`L${i}`, {
		id: `L${i}`,
		name: `L${i}`,
		version: 1,
		scope: 'project',
		category: 'ui',
		root: { id: `r${i}`, kind: 'container', x: 0, y: 0, children },
		params: [],
	});
}
/** The node paths a walk expands, keyed `a/b/c`. */
const expanded = (scene: Scene, nest = SCREEN_NEST): string[] =>
	[...depthSegments(scene, defs, nest)[0].segmentOf.keys()].map((k) => k.split('\n').join('/'));
const screen: Scene = {
	id: 's',
	name: 's',
	space: 'canvas',
	nodes: [{ id: 'i0', kind: 'componentInstance', componentId: 'L0', x: 0, y: 0 }],
};
const onScreen = expanded(screen);
for (let open = 0; open < CHAIN; open++) {
	const trail = Array.from({ length: open }, (_, i) => `L${i}`);
	if (
		!trail.every((_, i) => i === 0 || canEnterNested(i - 1)) ||
		(open > 0 && !canEnterNested(open - 1))
	)
		continue;
	const def = defs.get(`L${open}`) as ComponentDef;
	const editor: Scene = { id: 'c', name: def.name, space: 'canvas', nodes: def.root.children };
	const inEditor = expanded(editor, componentEditorNest(trail, def.id)).sort();
	// The same def's nodes on the screen: the paths under the instance of L<open>, made relative.
	const prefix = Array.from({ length: open + 1 }, (_, i) => `i${i}`).join('/') + '/';
	const under = onScreen
		.filter((k) => k.startsWith(prefix))
		.map((k) => k.slice(prefix.length))
		.sort();
	check(
		`L${open} opened ${open === 0 ? 'from the list' : `in place, ${open} deep`} expands what the screen expands under it (${under.length} nodes)`,
		under.length > 0 && inEditor.join() === under.join(),
	);
}
check(
	'the screen expands the chain to its cap, and no further',
	onScreen.some((k) => k.split('/').length === MAX_COMPONENT_DEPTH + 1) &&
		!onScreen.some((k) => k.split('/').length > MAX_COMPONENT_DEPTH + 1),
);
const atLevel0 = expanded(
	{ id: 'c', name: 'L0', space: 'canvas', nodes: (defs.get('L0') as ComponentDef).root.children },
	SCREEN_NEST,
);
check(
	'self-check: the open def drawn at a screen’s level expands one level more than the game',
	atLevel0.length > onScreen.filter((k) => k.startsWith('i0/')).length,
);

// ── 4. every renderer starts at the canvas's nest (source-scanned) ──────────────────────────────

const editorDir = new URL('../src/routes/(app)/editor/', import.meta.url);
const source = (file: string): string =>
	readFileSync(fileURLToPath(new URL(file, editorDir)), 'utf8');
const canvas = source('EditorCanvas.svelte');
const layerTags = canvas.match(/<Editor(?:Rig|Text|Effect)Layer\b[\s\S]*?\/>/g) ?? [];
check(
	`the canvas mounts its rig / text / effect layers (${layerTags.length})`,
	layerTags.length >= 3,
);
check(
	'each layer is handed the canvas’s nest',
	layerTags.every((tag) => /\{componentNest\}/.test(tag)),
);
for (const file of [
	'EditorCanvas.svelte',
	'EditorRigLayer.svelte',
	'EditorTextLayer.svelte',
	'EditorEffectLayer.svelte',
]) {
	const text = source(file);
	check(
		`${file} takes a componentNest, a screen's by default`,
		/componentNest = SCREEN_NEST/.test(text),
	);
	const literal = text.match(/,\s*[01],\s*\[(?:[a-z.]+\.id)?\],/g) ?? [];
	check(
		`${file} starts no walk at a literal level (${literal.join(' ') || 'none'})`,
		literal.length === 0,
	);
}
check(
	'the canvas draws and splits from its nest',
	/componentDepth = componentNest\.depth/.test(canvas) &&
		/componentStack: string\[\] = componentNest\.stack/.test(canvas) &&
		!/depthSegments\(s, componentMap\)/.test(canvas),
);
check(
	'the Component Editor hands the canvas its breadcrumb’s nest',
	/componentNest=\{componentEditorNest\(trail, componentDraft\.id\)\}/.test(
		source('ComponentWorkspace.svelte'),
	),
);

// ── 5. the breadcrumb opens what the game draws ─────────────────────────────────────────────────

for (let t = 0; t < 5; t++) {
	// A def nested in the open one, opened in place: its instance sits at the open def's nest level.
	const instanceLevel = componentEditorNest(
		Array.from({ length: t }, (_, i) => `d${i}`),
		'open',
	).depth;
	check(
		`with ${t} def(s) above the open one, a nested def opens in place iff the game draws it`,
		canEnterNested(t) === instanceLevel < MAX_COMPONENT_DEPTH,
	);
}

console.log(`component nesting parity: ${passes} passed, ${fails} failed`);
if (fails > 0) process.exit(1);
