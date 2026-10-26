/**
 * The `path` layout node (`docs/design/game-families.md` §4.3, P10.11) — kept by the save, read by
 * the game, edited on the stage:
 *
 *   pnpm --filter launcher-api check:layout-path
 *
 *  1. THE SAVE (`normalizeDoc`): a path round-trips byte-identically with its unknown fields; one
 *     with fewer than two usable points is dropped; a bad point, a `closed` that is not `true` and a
 *     zero / bad `smoothing` are dropped, a smoothing above 1 is clamped; the normalized node is a
 *     fixed point. `LAYOUT_NODE_KINDS` and `LAYOUT_NODE_FIELDS` know it.
 *  2. THE GAME READ (`scenePaths`): every top-level path of a screen, by id, in the screen's space
 *     (x / y, scale, rotation, a layout override); nested and unusable paths skipped.
 *  3. PARITY: every reference scene set normalizes to the very same node objects (the HUD bar, which
 *     the legacy-HUD migration rebuilds, aside) and has no path;
 *     the scaffold keeps a path; the game draws nothing for one.
 *  4. THE EDITOR'S EDITS (`pathNodeEdit.ts`): box, stage ↔ node space, hit tests (the closing
 *     segment only on a loop), insert / move / append / delete (never below two), closed, smoothing.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
	engineOwnedOnly,
	getFullSceneSet,
	LAYOUT_NODE_KINDS,
	listFullSceneSets,
	scenePaths,
	type LayoutDoc,
	type PathNode,
	type ResolvedTransform,
	type Scene,
} from 'engine-layout';

import { LAYOUT_NODE_FIELDS } from '../src/lib/server/componentFields';
import { normalizeDoc } from '../src/lib/server/editorStorage';
import {
	appendPathPoint,
	insertPathPoint,
	nearestPathPoint,
	nearestPathSegment,
	newPathNode,
	pathBox,
	pathCurve,
	pathLocalToWorld,
	pathWorldToLocal,
	removePathPoint,
	setPathClosed,
	setPathPoint,
	setPathSmoothing,
} from '../src/lib/editor/pathNodeEdit';

let passed = 0;
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	console.log(`${ok ? '  ok ' : 'FAIL '} ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
	if (ok) passed += 1;
	else failures += 1;
};
const json = (v: unknown): string => JSON.stringify(v);
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

const save = (nodes: unknown[]): Scene['nodes'] =>
	normalizeDoc({ version: 1, scenes: [{ id: 's', name: 'S', nodes }] }).scenes[0].nodes;

console.log('1. the save');
{
	const authored = {
		id: 'route',
		kind: 'path',
		label: 'Guard route',
		x: 400,
		y: 300,
		points: [
			{ x: 0, y: 0 },
			{ x: 200, y: 0 },
			{ x: 200, y: 100 },
		],
		closed: true,
		smoothing: 0.5,
		futureField: { kept: 1 },
	};
	const [kept] = save([structuredClone(authored)]);
	check('a whole path round-trips byte-identically', json(kept) === json(authored), json(kept));
	check('an unknown field survives', json(kept).includes('"futureField":{"kept":1}'));
	check('normalizing again changes nothing', json(save([kept])) === json([kept]));

	const minimal = {
		id: 'm',
		kind: 'path',
		x: 0,
		y: 0,
		points: [
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
		],
	};
	check(
		'an open, unsmoothed path stores no closed / smoothing',
		json(save([minimal])) === json([minimal]),
	);

	check('one point ⇒ dropped', save([{ ...minimal, points: [{ x: 0, y: 0 }] }]).length === 0);
	check('no points ⇒ dropped', save([{ ...minimal, points: undefined }]).length === 0);
	check(
		'two points, one unusable ⇒ dropped',
		save([
			{
				...minimal,
				points: [
					{ x: 0, y: 0 },
					{ x: 'a', y: 1 },
				],
			},
		]).length === 0,
	);
	const messy = save([
		{
			...minimal,
			points: [{ x: 0, y: 0 }, null, { x: Number.NaN, y: 2 }, { x: 5, y: 5 }],
			closed: false,
			smoothing: 0,
		},
	])[0] as PathNode;
	check(
		'unusable points dropped, closed:false and smoothing:0 not stored',
		json(messy) ===
			json({
				id: 'm',
				kind: 'path',
				x: 0,
				y: 0,
				points: [
					{ x: 0, y: 0 },
					{ x: 5, y: 5 },
				],
			}),
		json(messy),
	);
	const clamped = save([{ ...minimal, smoothing: 7, closed: 'yes' }])[0] as PathNode;
	check('smoothing above 1 is clamped', clamped.smoothing === 1);
	check('a closed that is not true is dropped', !('closed' in clamped));
	check(
		'a negative smoothing is dropped',
		!('smoothing' in (save([{ ...minimal, smoothing: -1 }])[0] as object)),
	);
	check('a path without an id is dropped', save([{ ...minimal, id: '' }]).length === 0);
	check('LAYOUT_NODE_KINDS lists path', (LAYOUT_NODE_KINDS as readonly string[]).includes('path'));
	check(
		'LAYOUT_NODE_FIELDS knows points / closed / smoothing',
		['points', 'closed', 'smoothing'].every((f) => LAYOUT_NODE_FIELDS.has(f)),
	);
}

console.log('2. the game read');
{
	const scene: Scene = {
		id: 'field',
		name: 'Field',
		nodes: [
			{
				id: 'a',
				kind: 'path',
				x: 100,
				y: 50,
				points: [
					{ x: 0, y: 0 },
					{ x: 10, y: 0 },
				],
			},
			{
				id: 'b',
				kind: 'path',
				x: 0,
				y: 0,
				points: [
					{ x: 10, y: 0 },
					{ x: 0, y: 20 },
				],
				scale: { x: 2, y: 3 },
				rotation: Math.PI / 2,
				closed: true,
				smoothing: 0.25,
			},
			{
				id: 'c',
				kind: 'path',
				x: 1,
				y: 2,
				points: [
					{ x: 0, y: 0 },
					{ x: 1, y: 0 },
				],
				overrides: { portrait: { x: 50, y: 60 } },
			},
			{ id: 'broken', kind: 'path', x: 0, y: 0, points: [{ x: 0, y: 0 }] },
			{
				id: 'box',
				kind: 'container',
				x: 0,
				y: 0,
				children: [
					{
						id: 'nested',
						kind: 'path',
						x: 0,
						y: 0,
						points: [
							{ x: 0, y: 0 },
							{ x: 1, y: 1 },
						],
					},
				],
			},
			{ id: 'r', kind: 'rect', x: 0, y: 0, width: 10, height: 10 },
		],
	};
	const paths = scenePaths(scene);
	check(
		'top-level usable paths only, by id',
		json(Object.keys(paths)) === json(['a', 'b', 'c']),
		json(Object.keys(paths)),
	);
	check(
		'x / y added; an open, unsmoothed path reads closed:false, smoothing 0',
		json(paths.a) ===
			json({
				points: [
					{ x: 100, y: 50 },
					{ x: 110, y: 50 },
				],
				closed: false,
				smoothing: 0,
			}),
		json(paths.a),
	);
	const b = paths.b.points;
	check(
		'scale then rotation are applied',
		near(b[0].x, 0) && near(b[0].y, 20) && near(b[1].x, -60) && near(b[1].y, 0),
		json(b),
	);
	check('closed and smoothing read', paths.b.closed && paths.b.smoothing === 0.25);
	check('base layout by default', paths.c.points[0].x === 1 && paths.c.points[0].y === 2);
	const portrait = scenePaths(scene, 'portrait');
	check(
		'a layout override moves it',
		portrait.c.points[0].x === 50 && portrait.c.points[1].x === 51,
	);
	check(
		'a screen with no path reads {}',
		json(scenePaths({ id: 'e', name: 'E', nodes: [] })) === '{}',
	);
}

console.log('3. parity');
{
	let sets = 0;
	let sameNodes = true;
	let noPaths = true;
	for (const { gameType } of listFullSceneSets()) {
		const doc = getFullSceneSet(gameType);
		if (!doc) continue;
		sets += 1;
		const out = normalizeDoc(doc);
		for (const scene of doc.scenes) {
			if (Object.keys(scenePaths(scene)).length) noPaths = false;
			// The HUD bar is rebuilt on read by the legacy-HUD migration (`normalizeHudScenes`).
			if (scene.id === 'hudBar') continue;
			const after = out.scenes.find((s) => s.id === scene.id);
			if (!after || after.nodes.length !== scene.nodes.length) sameNodes = false;
			else if (after.nodes.some((n, i) => n !== scene.nodes[i])) sameNodes = false;
		}
	}
	check(
		`every reference scene set (${sets}) keeps the very same node objects (HUD bar aside)`,
		sets > 0 && sameNodes,
	);
	check('no reference scene set has a path', noPaths);

	const doc: LayoutDoc = {
		version: 1,
		projectKey: 'p',
		mainSizesMap: { desktop: { width: 1920, height: 1080 } },
		updatedAt: '',
		scenes: [{ id: 'field', name: 'Field', nodes: [newPathNode('route', 10, 20)] }],
	};
	check('the scaffold keeps a path', engineOwnedOnly(doc).scenes[0]?.nodes[0]?.id === 'route');

	const view = readFileSync(
		resolve(import.meta.dirname, '../../../packages/engine-layout/src/lib/LayoutNodeView.svelte'),
		'utf8',
	);
	const branch =
		/\{:else if node\.kind === 'path'\}([\s\S]*?)\{:else if/.exec(view)?.[1] ?? '<none>';
	check(
		'the game draws nothing for a path (its branch holds only a comment)',
		branch.replace(/<!--[\s\S]*?-->/g, '').trim() === '',
		branch,
	);
}

console.log('4. the editor edits');
{
	const node = newPathNode('n', 0, 0);
	check(
		'a new path: two points, open, unsmoothed',
		node.points.length === 2 && !('closed' in node) && !('smoothing' in node),
	);
	const box = pathBox(node);
	check(
		'the box frames the points, padded',
		box.w === 332 && box.h === 32 && near(box.ax, 0.5) && near(box.ay, 0.5),
		json(box),
	);
	const t: ResolvedTransform = {
		x: 500,
		y: 400,
		rotation: 0.7,
		scale: { x: 0.5, y: 0.5 },
		visible: true,
	};
	const w = pathLocalToWorld(t, { x: 30, y: -12 });
	const back = pathWorldToLocal(t, w);
	check('stage ↔ node space round-trips', near(back.x, 30) && near(back.y, -12), json(back));

	const pts = [
		{ x: 0, y: 0 },
		{ x: 100, y: 0 },
		{ x: 100, y: 100 },
	];
	check('a point is hit within its radius', nearestPathPoint(pts, { x: 98, y: 3 }, 8) === 1);
	check('nothing is hit outside it', nearestPathPoint(pts, { x: 50, y: 50 }, 8) === -1);
	check(
		'a segment hit names its first point',
		json(nearestPathSegment(pts, false, { x: 50, y: 4 }, 8)) === json({ after: 0, t: 0.5 }),
	);
	check(
		'the closing segment is not hit on an open path',
		nearestPathSegment(pts, false, { x: 50, y: 50 }, 8) === undefined,
	);
	check('…and is on a loop', nearestPathSegment(pts, true, { x: 50, y: 50 }, 8)?.after === 2);

	const at = insertPathPoint(node, 0, { x: 0.4, y: 40.6 });
	check(
		'insert lands after the segment start, rounded',
		at === 1 && json(node.points[1]) === json({ x: 0, y: 41 }),
	);
	check(
		'move a point',
		setPathPoint(node, 1, { x: 10, y: 20 }) && json(node.points[1]) === json({ x: 10, y: 20 }),
	);
	check('a non-number move is refused', !setPathPoint(node, 1, { x: Number.NaN, y: 0 }));
	appendPathPoint(node);
	check(
		'append continues the last segment',
		json(node.points.at(-1)) === json({ x: 290, y: -20 }),
		json(node.points),
	);
	setPathClosed(node, true);
	const loopAt = appendPathPoint(node);
	check(
		'append on a loop goes halfway back to the start',
		json(node.points[loopAt]) === json({ x: 70, y: -10 }),
		json(node.points),
	);
	setPathClosed(node, false);
	check('opening stores no closed', !('closed' in node));
	while (node.points.length > 2) removePathPoint(node, 0);
	check(
		'delete never goes below two points',
		!removePathPoint(node, 0) && node.points.length === 2,
	);
	setPathSmoothing(node, 2);
	check('smoothing clamps to 1', node.smoothing === 1);
	setPathSmoothing(node, 0);
	check('smoothing 0 is not stored', !('smoothing' in node));
	check('an unsmoothed curve is the polyline', json(pathCurve(node)) === json(node.points));
	setPathSmoothing(node, 0.5);
	check('a smoothed curve is subdivided', pathCurve(node).length > node.points.length);
	check(
		'the edited node survives the save as is',
		json(save([structuredClone(node)])) === json([node]),
	);
}

console.log(
	failures === 0
		? `\nlayout path: ${passed}/${passed} passed.`
		: `\nlayout path: ${failures} FAILED (${passed} passed)`,
);
process.exit(failures === 0 ? 0 : 1);
