/**
 * Guard that a placed component's Scene Editor selection box frames the art it draws, however deep
 * that art sits, offline.
 *
 * Run: `pnpm --filter launcher-api check:component-content-box`
 *
 * WHY. The owner's pots (Hold and Win "Pots" screen): each is a Pot Meter whose coded `Pot` part
 * holds the author's own component — a rig and its effects. The canvas drew the whole pot, but the
 * selection box stayed a small chip in its middle: the box walked an instance's def one level only,
 * and gave a container its stand-in chip (a bound part) or a fixed 160×100 (a group), never what
 * the container draws. The runtime's `componentDesignSize` already measured a container by its
 * children.
 *
 * Load-bearing rules:
 *
 *  1. **A component nested in a skinned part frames its art**: the reported pot selects at the
 *     rig's drawn rect, through the part, the nested instance's transform and the placement's.
 *  2. **A group frames its children**, inside a component and on a screen.
 *  3. **A skinned part frames its picked art** (`partSkinArtSize`: the largest layer, centred,
 *     at the instance's width / height when set), together with any nodes inside it.
 *  4. **Parity:** a bare coded part keeps its chip, an empty group its fixed box, and the built-in
 *     panels whose art sits inside a part (Jackpot Tile, Respin Counter, Total Win Bar) select at
 *     exactly the box they did.
 *  5. **A component that contains itself stops**: the box comes back finite, the nested copy at the
 *     placeholder the canvas draws for it.
 *  6. **The canvas measures a skinned part with the same helper** (source-scanned).
 */
import { readFileSync } from 'node:fs';
import {
	BUILTIN_COMPONENTS,
	boundComponentSkin,
	resolveTransform,
	type ComponentDef,
	type LayoutNode,
	type ResolvedTransform,
} from 'engine-layout';

import { rigOriginAnchor, type RigBox } from 'constants-shared/rig';

import {
	nodeBox,
	nodeCornersWorld,
	partSkinArtSize,
	type NaturalSize,
	type Vec2,
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
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

const builtin = (id: string): ComponentDef => {
	const def = BUILTIN_COMPONENTS.find((d) => d.id === id);
	if (!def) throw new Error(`no built-in ${id}`);
	return def;
};
const POT_METER = builtin('potMeter');

/** The pot rig: 256 × 620, its origin 220 px below the top of its box (rig y-up). */
const POT_RIG: RigBox = { x: -128, y: -400, width: 256, height: 620 };
/** Frames a picked skin layer can name, with their natural sizes. */
const FRAMES: Record<string, { w: number; h: number }> = {
	'pots::pot': { w: 220, h: 300 },
	'pots::frame': { w: 240, h: 260 },
};

/** The canvas's natural sizes as far as these fixtures need them: the rig layer's report for the
 *  rig, and a skinned part's picked art through the canvas's own helper. */
const naturalSize = (
	node: LayoutNode,
	_rigBundle?: string,
	params?: Record<string, unknown>,
): NaturalSize | null => {
	if (node.kind === 'spine' && node.assetKey === 'pot-rig')
		return { w: POT_RIG.width, h: POT_RIG.height, ...rigOriginAnchor(POT_RIG) };
	const skin = node.bind ? boundComponentSkin(node.bind.component) : undefined;
	return skin && params ? partSkinArtSize(skin, params, (ref) => FRAMES[ref] ?? null) : null;
};

const def = (id: string, children: LayoutNode[]): ComponentDef => ({
	id,
	name: id,
	version: 1,
	scope: 'project',
	category: 'ui',
	root: { id: `${id}-root`, kind: 'container', x: 0, y: 0, children },
});
const instance = (
	id: string,
	componentId: string,
	extra: Partial<Extract<LayoutNode, { kind: 'componentInstance' }>> = {},
): LayoutNode => ({ id, kind: 'componentInstance', componentId, x: 0, y: 0, ...extra });
const sprite = (id: string, x: number, y: number, w: number, h: number): LayoutNode => ({
	id,
	kind: 'sprite',
	assetKey: 'pots',
	region: id,
	x,
	y,
	width: w,
	height: h,
	anchor: { x: 0, y: 0 },
});

/** The selected node's box in world space: its left, top, right and bottom. */
function frame(
	node: LayoutNode,
	map: Map<string, ComponentDef>,
	at: Partial<ResolvedTransform> = {},
): { l: number; t: number; r: number; b: number; w: number; h: number } {
	const t = { ...resolveTransform(node, 'desktop'), ...at };
	const box = nodeBox(node, t, naturalSize, map, 'desktop', undefined, undefined, {}, {});
	const c: Vec2[] = nodeCornersWorld(t, box);
	return {
		l: Math.min(...c.map((p) => p.x)),
		t: Math.min(...c.map((p) => p.y)),
		r: Math.max(...c.map((p) => p.x)),
		b: Math.max(...c.map((p) => p.y)),
		w: box.w,
		h: box.h,
	};
}
function frames(
	name: string,
	got: ReturnType<typeof frame>,
	want: { l: number; t: number; r: number; b: number },
): void {
	check(
		`${name}: box (${got.l.toFixed(1)}, ${got.t.toFixed(1)})–(${got.r.toFixed(1)}, ${got.b.toFixed(1)}) frames (${want.l}, ${want.t})–(${want.r}, ${want.b})`,
		near(got.l, want.l) && near(got.t, want.t) && near(got.r, want.r) && near(got.b, want.b),
	);
}

/** The Pot Meter with the author's nodes inside its coded `Pot` part. */
const potWith = (id: string, partChildren: LayoutNode[]): ComponentDef => ({
	...POT_METER,
	id,
	root: {
		...POT_METER.root,
		children: POT_METER.root.children.map((part) =>
			part.kind === 'container' ? { ...part, children: partChildren } : part,
		),
	},
});

// Rule 1 — the reported pot: Pot (red) → Pot part → the author's `potArt` → its rig.
{
	const map = new Map<string, ComponentDef>([
		['potArt', def('potArt', [{ id: 'rig', kind: 'spine', assetKey: 'pot-rig', x: 0, y: 0 }])],
		[
			'redPot',
			potWith('redPot', [instance('art', 'potArt', { y: 20, scale: { x: 1.5, y: 1.5 } })]),
		],
	]);
	const red = instance('pot-red', 'redPot', {
		x: 500,
		y: 300,
		scale: { x: 0.8, y: 0.8 },
		params: { meter: 'red' },
	});
	// The rig in `potArt` spans x −128..128, y −220..400; the nested instance scales it by 1.5
	// at (0, 20), and the placement by 0.8 at (500, 300).
	frames('the reported pot', frame(red, map), {
		l: 500 - 192 * 0.8,
		t: 300 - 310 * 0.8,
		r: 500 + 192 * 0.8,
		b: 300 + 620 * 0.8,
	});
	const f = frame(red, map);
	check(
		`the reported pot measures 384 × 930 before scale (got ${f.w} × ${f.h})`,
		near(f.w, 384) && near(f.h, 930),
	);
}

// Rule 2 — a group frames its children, in a component and on a screen.
{
	const group: LayoutNode = {
		id: 'g',
		kind: 'container',
		x: 100,
		y: 0,
		children: [sprite('a', -50, -20, 200, 80), sprite('b', 120, 40, 60, 60)],
	};
	const map = new Map([['banner', def('banner', [group])]]);
	// In the group: a (−50, −20)–(150, 60), b (120, 40)–(180, 100); the group sits at x 100.
	frames('a group inside a component', frame(instance('ban', 'banner'), map), {
		l: 50,
		t: -20,
		r: 280,
		b: 100,
	});
	frames('a group on a screen', frame(group, map), { l: 50, t: -20, r: 280, b: 100 });
	frames('a scaled group on a screen', frame({ ...group, scale: { x: 2, y: 2 } }, map), {
		l: 0,
		t: -40,
		r: 460,
		b: 200,
	});
}

// Rule 3 — a skinned part frames its picked art, with the nodes inside it.
{
	const map = new Map([['potMeter', POT_METER]]);
	frames(
		'a pot skinned by a picked image',
		frame(instance('p', 'potMeter', { params: { backgroundImage: 'pots::pot' } }), map),
		{ l: -110, t: -150, r: 110, b: 150 },
	);
	frames(
		'… the largest of its layers',
		frame(
			instance('p', 'potMeter', {
				params: { backgroundImage: 'pots::pot', frameImage: 'pots::frame' },
			}),
			map,
		),
		{ l: -120, t: -150, r: 120, b: 150 },
	);
	frames(
		'… at the width the instance sets',
		frame(
			instance('p', 'potMeter', { params: { backgroundImage: 'pots::pot', artWidth: 180 } }),
			map,
		),
		{ l: -90, t: -150, r: 90, b: 150 },
	);
	const both = new Map([['both', potWith('both', [sprite('spark', 60, -200, 100, 40)])]]);
	frames(
		'… and the nodes inside it',
		frame(instance('p', 'both', { params: { backgroundImage: 'pots::pot' } }), both),
		{ l: -110, t: -200, r: 160, b: 150 },
	);
}

// Rule 4 — parity: a bare part keeps its chip, an empty group its box, the built-in panels theirs.
{
	const map = new Map(BUILTIN_COMPONENTS.map((d) => [d.id, d]));
	frames('a bare Pot Meter keeps its 120 × 60 chip', frame(instance('p', 'potMeter'), map), {
		l: -60,
		t: -30,
		r: 60,
		b: 30,
	});
	const empty: LayoutNode = { id: 'e', kind: 'container', x: 10, y: 10, children: [] };
	frames('an empty group keeps its 160 × 100 box', frame(empty, map), {
		l: -70,
		t: -40,
		r: 90,
		b: 60,
	});
	for (const [id, w, h] of [
		['jackpotTile', 240, 96],
		['respinCounter', 240, 96],
		['totalWinBar', 360, 96],
	] as const) {
		frames(`the built-in ${id} keeps its ${w} × ${h} box`, frame(instance('i', id), map), {
			l: -w / 2,
			t: -h / 2,
			r: w / 2,
			b: h / 2,
		});
	}
}

// Rule 5 — a component that contains itself, directly or through a group, stops.
{
	const map = new Map<string, ComponentDef>([
		['self', def('self', [instance('again', 'self', { x: 40 })])],
		[
			'loop',
			def('loop', [
				{
					id: 'g',
					kind: 'container',
					x: 0,
					y: 0,
					children: [instance('again', 'loop', { x: 40 })],
				},
			]),
		],
	]);
	for (const id of ['self', 'loop']) {
		let f: ReturnType<typeof frame> | null = null;
		try {
			f = frame(instance('i', id), map);
		} catch {
			/* a stack overflow fails below */
		}
		check(
			`a component that contains itself (${id}) measures the placeholder it draws`,
			!!f && near(f.l, -40) && near(f.t, -50) && near(f.r, 120) && near(f.b, 50),
		);
	}
}

// Rule 6 — the canvas sizes a skinned part's art through the helper this gate runs.
{
	const canvas = readFileSync(
		new URL('../src/routes/(app)/editor/EditorCanvas.svelte', import.meta.url),
		'utf8',
	);
	check(
		'EditorCanvas measures a skinned part with partSkinArtSize',
		/partSkinArtSize\(skin, instanceParams, tileImageNaturalSize\)/.test(canvas),
	);
	check(
		'EditorCanvas draws a skinned part at partSkinSize',
		/const \{ width, height \} = partSkinSize\(skin, params\)/.test(canvas),
	);
}

if (fails > 0) {
	console.error(`component content box: ${fails} failed, ${passes} passed`);
	process.exit(1);
}
console.log(`component content box: all ${passes} checks passed`);
