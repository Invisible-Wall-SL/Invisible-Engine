/**
 * Invisible FX — BAKED effects (`invisible-fx.md` §"Baked effects"). Run:
 *
 *   pnpm --filter fx-spike run effect-bake
 *
 * Covers, against the real `engine-fx` functions:
 *  1. the doc field — absent stays absent (byte-identical), clamping, a malformed result dropped,
 *     idempotence through `normalizeEffectDoc`;
 *  2. the stale hash — stable under key order, blind to name / `enabled` / the result, moved by any
 *     layer or capture-setting change;
 *  3. what may bake (`effectBakeBlockers`) and the warm-up;
 *  4. the sheet: the plan's scale, each cell trimmed to what it draws (plus a transparent pixel; a
 *     multiply cell's white is nothing), the trims packed (on the page, never overlapping, on 4-px
 *     blocks with a 2 px gutter, no KTX2 block shared, never larger than the untrimmed grid,
 *     deterministic), and the TexturePacker JSON — every cell rebuilt from it the way Pixi builds a
 *     trimmed texture is pixel-identical to the cell composed — and each blend group's frame names;
 *  5. the runtime choice — bake on + every frame loaded ⇒ baked, one texture row per blend group;
 *     off / absent / driven / one frame missing / a pre-group bake that flattened mixed blends ⇒
 *     live — and that the default path reads no asset at all;
 *  6. the per-instance desync — deterministic, spread, and `Math.random` never drawn;
 *  7. the export — only a shipping bake survives `exportableEffectDoc`; the rest are stripped;
 *  8. a rig beat — the fades (in briefly, out over the longest particle life at the beat's speed),
 *     the opacity envelope, and the loop rate under `emitSpeed`;
 *  9. blend groups — consecutive layers sharing a blend are one group, in draw order; a stored
 *     result from before groups reads as one group, and is stale when the layers mix blends.
 */

import {
	DEFAULT_EMIT_SPEED,
	EFFECT_BAKE_BEAT_FADE_IN_SECONDS,
	EFFECT_BAKE_LIMITS,
	effectBakeBeatAlpha,
	effectBakeBeatFades,
	effectBakeBeatRate,
	effectBakeBlockers,
	effectBakeChoice,
	effectBakeFrameAt,
	effectBakeFrameCount,
	effectBakeFrameName,
	effectBakeGroupFrameNames,
	effectBakeGroups,
	effectBakeGroupsMatch,
	effectBakeHash,
	effectBakeInstanceKey,
	effectBakeLongestLife,
	effectBakeSeamFrames,
	effectBakeSeamWeight,
	effectBakeSheetJson,
	effectBakeShips,
	effectBakeStale,
	effectBakeStartFrame,
	effectBakeTrim,
	effectBakeWarmup,
	exportableEffectDoc,
	normalizeEffectBake,
	normalizeEffectDoc,
	packEffectBakeFrames,
	planEffectBakeSheet,
	type EffectDoc,
} from 'engine-fx';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) console.log(`  ✓ ${msg}`);
	else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const sparkConfig = (extra: Record<string, unknown> = {}) => ({
	lifetime: { min: 0.4, max: 1.2 },
	frequency: 0.008,
	emitterLifetime: -1,
	maxParticles: 1000,
	pos: { x: 0, y: 0 },
	addAtBack: false,
	behaviors: [
		{ type: 'alpha', config: { alpha: { list: [{ time: 0, value: 1 }] } } },
		{ type: 'blendMode', config: { blendMode: 'add' } },
	],
	...extra,
});

const rawDoc = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
	version: 1,
	id: 'firecracker',
	name: 'Firecracker',
	layers: [
		{
			key: 'spark',
			config: sparkConfig(),
			art: { assetKey: 'c/p/manifests/fx.json', frames: ['Spark_Mini'] },
			placement: { space: 'free' },
			particleKind: 'sprite',
		},
	],
	...extra,
});

const FRAMES = ['bake_00000000_000', 'bake_00000000_001', 'bake_00000000_002'];
const RESULT = {
	assetKey: 'c/p/fx-bakes/firecracker/fxbake_firecracker_00000000.json',
	groups: [{ blendMode: 'add', frames: FRAMES }],
	fps: 24,
	bounds: { x: -60, y: -80, w: 120, h: 140 },
	hash: '00000000',
	sheet: { w: 200, h: 80 },
};

/** A doc whose bake is current: its result carries the doc's own hash. */
const freshDoc = (
	bakeExtra: Record<string, unknown> = {},
	docExtra: Record<string, unknown> = {},
) => {
	const settings = { enabled: true, fps: 24, loopSeconds: 2, scale: 0.5, seam: 'crossfade' };
	const draft = normalizeEffectDoc(rawDoc({ bake: { ...settings, ...bakeExtra }, ...docExtra }));
	const hash = effectBakeHash(draft);
	return normalizeEffectDoc({
		...draft,
		bake: { ...draft.bake, result: { ...RESULT, hash } },
	}) as EffectDoc;
};

console.log('1. the doc field');
{
	const plain = normalizeEffectDoc(rawDoc());
	assert(!('bake' in plain), 'a doc without bake normalizes without the key (byte-identical)');
	assert(
		eq(normalizeEffectDoc(rawDoc({ bake: 'yes' })), plain),
		'a non-object bake is no bake at all',
	);
	const d = normalizeEffectBake({ enabled: 1, fps: 500, loopSeconds: 0, scale: 9, seam: 'x' });
	assert(d?.enabled === false, 'enabled must be literally true');
	assert(d?.fps === EFFECT_BAKE_LIMITS.fps.max, 'fps clamps to its max');
	assert(d?.loopSeconds === EFFECT_BAKE_LIMITS.loopSeconds.min, 'loopSeconds clamps to its min');
	assert(d?.scale === EFFECT_BAKE_LIMITS.scale.max, 'scale clamps to its max');
	assert(d?.seam === 'crossfade', 'an unknown seam is crossfade');
	const bad = normalizeEffectBake({
		enabled: true,
		result: { ...RESULT, groups: [{ blendMode: 'add', frames: [] }] },
	});
	assert(bad?.enabled === true && !bad.result, 'a result with no frames is dropped (plays live)');
	const uneven = normalizeEffectBake({
		enabled: true,
		result: { ...RESULT, groups: [...RESULT.groups, { blendMode: 'normal', frames: ['x'] }] },
	});
	assert(!uneven?.result, 'groups with different frame counts are dropped');
	const oddBlend = normalizeEffectBake({
		enabled: true,
		result: { ...RESULT, groups: [{ blendMode: 'overlay', frames: FRAMES }] },
	});
	assert(!oddBlend?.result, 'a group with an unknown blend is dropped');
	const badKey = normalizeEffectBake({ enabled: true, result: { ...RESULT, assetKey: 'x.png' } });
	assert(!badKey?.result, 'a result whose assetKey is not a manifest key is dropped');
	const doc = freshDoc();
	assert(eq(normalizeEffectDoc(doc), doc), 'normalize is idempotent with a bake');
	assert(
		eq(normalizeEffectDoc(JSON.parse(JSON.stringify(doc))), doc),
		'a baked doc survives save → reload',
	);
	const withParams = normalizeEffectDoc(
		rawDoc({
			bake: { enabled: false },
			params: [{ id: 'k', kind: 'number', default: 1, drives: [] }],
		}),
	);
	assert(!!withParams.bake && !!withParams.params, 'bake and params both survive normalize');
}

console.log('2. the stale hash');
{
	const doc = freshDoc();
	assert(!effectBakeStale(doc), 'a just-baked doc is current');
	assert(!effectBakeStale({ ...doc, name: 'Renamed' } as EffectDoc), 'renaming does not stale it');
	assert(
		!effectBakeStale({ ...doc, bake: { ...doc.bake!, enabled: false } }),
		'turning it off does not stale it',
	);
	const reordered = JSON.parse(JSON.stringify(doc)) as EffectDoc;
	const cfg = reordered.layers[0].config as unknown as Record<string, unknown>;
	const flipped: Record<string, unknown> = {};
	for (const k of Object.keys(cfg).reverse()) flipped[k] = cfg[k];
	reordered.layers[0].config = flipped as unknown as EffectDoc['layers'][0]['config'];
	assert(!effectBakeStale(reordered), 'config key order does not matter');
	const tuned = JSON.parse(JSON.stringify(doc)) as EffectDoc;
	(tuned.layers[0].config as unknown as Record<string, unknown>).frequency = 0.01;
	assert(effectBakeStale(tuned), 'a tuned emitter makes the bake stale');
	assert(
		effectBakeStale({ ...doc, bake: { ...doc.bake!, fps: 30 } }),
		'a changed capture setting makes the bake stale',
	);
	const noResult = { ...doc, bake: { ...doc.bake!, result: undefined } };
	assert(effectBakeStale(noResult), 'no result is stale');
	assert(/^[0-9a-f]{8}$/.test(effectBakeHash(doc)), 'the hash is 8 hex digits');
}

console.log('3. what may bake, and the warm-up');
{
	const ok = normalizeEffectDoc(rawDoc());
	assert(effectBakeBlockers(ok).length === 0, 'an ambient sprite effect can bake');
	const layer = (patch: Record<string, unknown>) =>
		normalizeEffectDoc(
			rawDoc({ layers: [{ ...(rawDoc().layers as Record<string, unknown>[])[0], ...patch }] }),
		);
	const cases: [string, EffectDoc][] = [
		['a rig-particle layer', layer({ particleKind: 'spine' })],
		['a bone layer', layer({ placement: { space: 'bone', bone: 'hand' } })],
		['an event layer', layer({ trigger: { on: 'event', eventType: 'win' } })],
		['a timed ambient layer', layer({ trigger: { on: 'always', duration: 500 } })],
		['a one-shot burst', layer({ config: sparkConfig({ emitterLifetime: 0.3 }) })],
		[
			'an effect with parameters',
			normalizeEffectDoc(rawDoc({ params: [{ id: 'k', kind: 'number', default: 1, drives: [] }] })),
		],
		['an effect with no layers', normalizeEffectDoc(rawDoc({ layers: [] }))],
	];
	for (const [label, doc] of cases)
		assert(effectBakeBlockers(doc).length > 0, `${label} is refused with a reason`);
	assert(
		Math.abs(effectBakeWarmup(ok) - (1.2 * 1.25 + 0.1)) < 1e-9,
		'warm-up covers the longest particle life plus a margin',
	);
	assert(
		effectBakeWarmup(layer({ config: sparkConfig({ lifetime: { min: 1, max: 900 } }) })) ===
			EFFECT_BAKE_LIMITS.warmupEmitterSeconds,
		'warm-up is capped',
	);
	assert(
		eq(effectBakeGroups(ok.layers), [{ blendMode: 'add', layers: ['spark'] }]),
		'all-additive layers bake as one add group',
	);
	const mixed = normalizeEffectDoc(
		rawDoc({
			layers: [
				...(rawDoc().layers as unknown[]),
				{
					key: 'smoke',
					config: sparkConfig({ behaviors: [] }),
					art: { assetKey: '', frames: [] },
					placement: { space: 'free' },
					particleKind: 'sprite',
				},
			],
		}),
	);
	assert(
		eq(
			effectBakeGroups(mixed.layers).map((g) => g.blendMode),
			['add', 'normal'],
		),
		'a normal layer after the additive one is its own group',
	);
	const zebra = normalizeEffectDoc(
		rawDoc({
			layers: Array.from({ length: EFFECT_BAKE_LIMITS.groups + 1 }, (_, i) => ({
				key: `l${i}`,
				config: sparkConfig(i % 2 ? { behaviors: [] } : {}),
				art: { assetKey: 'c/p/manifests/fx.json', frames: ['Spark_Mini'] },
				placement: { space: 'free' },
				particleKind: 'sprite',
			})),
		}),
	);
	assert(
		effectBakeBlockers(zebra).some((r) => /blend groups/.test(r)),
		`more than ${EFFECT_BAKE_LIMITS.groups} alternating blend runs is refused with a reason`,
	);
}

console.log('4. the sheet plan');
{
	assert(effectBakeFrameCount({ fps: 24, loopSeconds: 2 }) === 48, '24 fps × 2 s = 48 frames');
	assert(
		effectBakeFrameCount({ fps: 60, loopSeconds: 8 }) === EFFECT_BAKE_LIMITS.frames.max,
		'frame count is capped',
	);
	assert(effectBakeSeamFrames({ seam: 'crossfade' }, 48) === 12, 'crossfade blends a quarter');
	assert(effectBakeSeamFrames({ seam: 'cut' }, 48) === 0, 'a cut blends nothing');
	assert(effectBakeSeamWeight(0, 12) === 0, 'loop frame 0 is all the post-loop capture');
	assert(effectBakeSeamWeight(6, 12) === 0.5, 'half way through the seam is half and half');
	assert(effectBakeSeamWeight(12, 12) === 1, 'past the seam is pure capture');

	const plan = planEffectBakeSheet(300, 200, 48, 0.5)!;
	assert(plan.scale === 0.5, 'a small effect keeps its requested scale');
	assert(plan.cols * plan.rows >= 48, 'every frame has a cell');
	const big = planEffectBakeSheet(2048, 2048, 120, 1)!;
	assert(
		big.width <= EFFECT_BAKE_LIMITS.sheetSide && big.height <= EFFECT_BAKE_LIMITS.sheetSide,
		'a huge effect is scaled down to fit one page',
	);
	assert(big.scale < 1, '… and reports the lower scale');
	assert(planEffectBakeSheet(1e6, 1e6, 120, 1) === undefined, 'an impossible sheet is refused');

	// A cell `w × h` (RGBA, straight alpha) with `boxes` painted in it.
	type Box = { x: number; y: number; w: number; h: number; rgba?: number[] };
	const paint = (w: number, h: number, boxes: Box[], ground = [0, 0, 0, 0]): Uint8ClampedArray => {
		const px = new Uint8ClampedArray(w * h * 4);
		for (let i = 0; i < w * h; i++) px.set(ground, i * 4);
		for (const b of boxes)
			for (let y = b.y; y < b.y + b.h; y++)
				for (let x = b.x; x < b.x + b.w; x++)
					px.set(b.rgba ?? [200, 120, 40, 180], (y * w + x) * 4);
		return px;
	};

	assert(
		eq(effectBakeTrim(paint(20, 16, [{ x: 5, y: 4, w: 4, h: 3 }]), 20, 16, 'add'), {
			x: 4,
			y: 3,
			w: 6,
			h: 5,
		}),
		'a trim is the drawn box grown by one transparent pixel each side',
	);
	assert(
		eq(effectBakeTrim(paint(20, 16, [{ x: 0, y: 13, w: 20, h: 3 }]), 20, 16, 'normal'), {
			x: 0,
			y: 12,
			w: 20,
			h: 4,
		}),
		'… clamped to the cell where the art reaches its edge',
	);
	assert(
		eq(effectBakeTrim(paint(20, 16, []), 20, 16, 'add'), { x: 0, y: 0, w: 1, h: 1 }),
		'a cell that draws nothing keeps one transparent pixel',
	);
	const overWhite = paint(
		20,
		16,
		[
			{ x: 2, y: 2, w: 3, h: 3, rgba: [255, 255, 255, 128] },
			{ x: 10, y: 8, w: 2, h: 2, rgba: [90, 60, 60, 255] },
		],
		[255, 255, 255, 255],
	);
	assert(
		eq(effectBakeTrim(overWhite, 20, 16, 'multiply'), { x: 9, y: 7, w: 4, h: 4 }),
		'a multiply cell trims away its white (white at any alpha multiplies by 1)',
	);
	assert(
		eq(effectBakeTrim(overWhite, 20, 16, 'normal'), { x: 0, y: 0, w: 20, h: 16 }),
		'… but white is paint in any other blend',
	);

	// 2 blend groups × 48 frames of the 300×200 effect at 0.5: a spark drifting across its cell.
	const cellW = plan.cellW;
	const cellH = plan.cellH;
	const cells: Uint8ClampedArray[] = [];
	for (let i = 0; i < 96; i++) {
		const s = 4 + ((i * 7) % 23);
		const at = { x: (i * 13) % (cellW - s), y: (i * 29) % (cellH - s) };
		cells.push(
			paint(cellW, cellH, [
				{ ...at, w: s, h: s, rgba: [255, 200, 90, 40 + (i % 200)] },
				{ x: at.x + s, y: at.y, w: 1, h: 1, rgba: [255, 255, 255, 1] },
			]),
		);
	}
	// One empty cell, and one that is drawn edge to edge.
	cells[5] = paint(cellW, cellH, []);
	cells[60] = paint(cellW, cellH, [{ x: 0, y: 0, w: cellW, h: cellH }]);
	const blendOf = (i: number): 'normal' | 'add' => (i < 48 ? 'normal' : 'add');
	const trims = cells.map((px, i) => effectBakeTrim(px, cellW, cellH, blendOf(i)));
	const layout = packEffectBakeFrames(cellW, cellH, trims)!;
	assert(!!layout, 'the trimmed frames pack');
	// One 3068×30 shelf is the smallest page for these, by under 5%.
	const flat = Array.from({ length: 48 }, () => ({ x: 0, y: 0, w: 60, h: 30 }));
	const squarish = packEffectBakeFrames(200, 100, flat)!;
	assert(
		Math.max(squarish.width, squarish.height) < 1024,
		`flat frames pack into a block, not a 3068-px strip (${squarish.width}×${squarish.height})`,
	);
	assert(
		eq(packEffectBakeFrames(cellW, cellH, trims), layout),
		'packing is deterministic (the page and /api/fx/bake lay out the same page)',
	);
	const two = planEffectBakeSheet(300, 200, 96, 0.5)!;
	assert(
		layout.width * layout.height < 0.5 * two.width * two.height,
		`the packed page is a fraction of the grid (${layout.width}×${layout.height} vs ` +
			`${two.width}×${two.height})`,
	);
	const full = Array.from({ length: 96 }, () => ({ x: 0, y: 0, w: cellW, h: cellH }));
	const untrimmed = packEffectBakeFrames(cellW, cellH, full)!;
	assert(
		untrimmed.width * untrimmed.height <= 1.05 * two.width * two.height &&
			untrimmed.width <= EFFECT_BAKE_LIMITS.sheetSide &&
			untrimmed.height <= EFFECT_BAKE_LIMITS.sheetSide,
		'full-cell frames pack onto a page that fits, about the grid the plan fitted',
	);
	const huge = planEffectBakeSheet(2048, 2048, 120, 1)!;
	const hugeFull = Array.from({ length: 120 }, () => ({
		x: 0,
		y: 0,
		w: huge.cellW,
		h: huge.cellH,
	}));
	assert(
		!!packEffectBakeFrames(huge.cellW, huge.cellH, hugeFull),
		'… even at the largest sheet the plan allows',
	);

	const pageRects = layout.frames.map((f) => ({ x: f.x, y: f.y, w: f.trim.w, h: f.trim.h }));
	assert(
		pageRects.every((r) => r.x + r.w <= layout.width && r.y + r.h <= layout.height),
		'every frame lies on the page',
	);
	assert(
		pageRects.every((r) => r.x % 4 === 0 && r.y % 4 === 0),
		'every frame starts on a 4-px block',
	);
	let crowded = false;
	for (let i = 0; i < pageRects.length; i++)
		for (let j = i + 1; j < pageRects.length; j++) {
			const a = pageRects[i];
			const b = pageRects[j];
			const apart =
				a.x + a.w + 2 <= b.x ||
				b.x + b.w + 2 <= a.x ||
				a.y + a.h + 2 <= b.y ||
				b.y + b.h + 2 <= a.y;
			if (!apart) crowded = true;
		}
	assert(!crowded, 'no two frames overlap, and at least 2 transparent pixels part any two');
	const blockOwner = new Map<string, number>();
	let shared = false;
	pageRects.forEach((r, i) => {
		for (let by = Math.floor(r.y / 4); by <= Math.floor((r.y + r.h - 1) / 4); by++)
			for (let bx = Math.floor(r.x / 4); bx <= Math.floor((r.x + r.w - 1) / 4); bx++) {
				const owner = blockOwner.get(`${bx},${by}`);
				if (owner !== undefined && owner !== i) shared = true;
				blockOwner.set(`${bx},${by}`, i);
			}
	});
	assert(!shared, 'no 4×4 block (a KTX2 block) holds pixels of two frames');
	assert(
		layout.width === Math.max(...pageRects.map((r) => r.x + r.w)) &&
			layout.height === Math.max(...pageRects.map((r) => r.y + r.h)),
		'the page is no larger than its frames need',
	);

	// The page as the canvas composes it, then every cell rebuilt from the JSON the way Pixi builds
	// a trimmed texture (`frame` on the page, placed at `spriteSourceSize` inside `sourceSize`).
	const page = new Uint8ClampedArray(layout.width * layout.height * 4);
	layout.frames.forEach(({ x, y, trim }, i) => {
		for (let r = 0; r < trim.h; r++)
			for (let c = 0; c < trim.w; c++) {
				const from = ((trim.y + r) * cellW + trim.x + c) * 4;
				page.set(cells[i].subarray(from, from + 4), ((y + r) * layout.width + x + c) * 4);
			}
	});
	const sheet = effectBakeSheetJson(layout, 'p.png', '0badf00d');
	type Frame = {
		frame: { x: number; y: number; w: number; h: number };
		trimmed: boolean;
		spriteSourceSize: { x: number; y: number; w: number; h: number };
		sourceSize: { w: number; h: number };
	};
	let misplaced = 0;
	let wrongSize = 0;
	const names = effectBakeGroupFrameNames('0badf00d', 48, 2).flat();
	names.forEach((name, i) => {
		const f = sheet.frames[name] as Frame;
		if (f.sourceSize.w !== cellW || f.sourceSize.h !== cellH) wrongSize++;
		const { frame, spriteSourceSize: sss } = f;
		if (frame.w !== sss.w || frame.h !== sss.h) wrongSize++;
		for (let cy = 0; cy < cellH; cy++)
			for (let cx = 0; cx < cellW; cx++) {
				const inside = cx >= sss.x && cx < sss.x + sss.w && cy >= sss.y && cy < sss.y + sss.h;
				const at = ((frame.y + cy - sss.y) * layout.width + frame.x + cx - sss.x) * 4;
				const want = cells[i].subarray((cy * cellW + cx) * 4, (cy * cellW + cx) * 4 + 4);
				for (let k = 0; k < 4; k++) if ((inside ? page[at + k] : 0) !== want[k]) misplaced++;
			}
	});
	assert(
		wrongSize === 0,
		'every frame keeps the full cell as its sourceSize and its trim as its size',
	);
	assert(
		misplaced === 0,
		'rebuilt from the JSON, every cell is pixel-identical to the one composed (96 cells)',
	);
	assert(
		Object.keys(sheet.frames)[0] === effectBakeFrameName('0badf00d', 0) &&
			Object.keys(sheet.frames)[0] === 'bake_0badf00d_000',
		'frames are named in order, by the bake',
	);
	assert(
		names.every((n) => n in sheet.frames) && Object.keys(sheet.frames).length === 96,
		'each blend group names its own 48 frames of the sheet',
	);
	assert(
		(sheet.frames[names[5]] as Frame).trimmed &&
			!(sheet.frames[names[60]] as Frame).trimmed &&
			eq((sheet.frames[names[60]] as Frame).spriteSourceSize, { x: 0, y: 0, w: cellW, h: cellH }),
		'a trimmed frame says so; one drawn edge to edge is the whole cell, untrimmed',
	);
	assert(
		eq(sheet.meta.size, { w: layout.width, h: layout.height }) && sheet.meta.image === 'p.png',
		'the JSON names the page and its packed size',
	);
	assert(
		packEffectBakeFrames(cellW, cellH, [{ x: cellW - 4, y: 0, w: 8, h: 4 }]) === undefined &&
			packEffectBakeFrames(cellW, cellH, [{ x: 0, y: 0, w: 0, h: 4 }]) === undefined &&
			packEffectBakeFrames(cellW, cellH, [{ x: 0.5, y: 0, w: 4, h: 4 }]) === undefined &&
			packEffectBakeFrames(cellW, cellH, ['x']) === undefined &&
			packEffectBakeFrames(cellW, cellH, []) === undefined,
		'a trim outside its cell, empty, fractional or malformed — or no trims — is refused',
	);
}

console.log('5. the runtime choice');
{
	const doc = freshDoc();
	const loaded = new Map<string, string>(
		FRAMES.map((f) => [`${RESULT.assetKey}::${f}`, `tex:${f}`]),
	);
	const lookup = (k: string) => loaded.get(k);
	const on = effectBakeChoice(doc, lookup);
	assert(on.mode === 'baked', 'bake on + every frame loaded ⇒ baked');
	assert(
		on.mode === 'baked' && eq(on.textures, [FRAMES.map((f) => `tex:${f}`)]),
		'… one row per blend group, with the frames in order',
	);

	const reads: string[] = [];
	const spy = (k: string) => {
		reads.push(k);
		return loaded.get(k);
	};
	const plain = normalizeEffectDoc(rawDoc());
	const none = effectBakeChoice(plain, spy);
	assert(none.mode === 'live' && none.reason === 'no-bake', 'no bake ⇒ live');
	const off = effectBakeChoice({ ...doc, bake: { ...doc.bake!, enabled: false } }, spy);
	assert(off.mode === 'live' && off.reason === 'off', 'bake off ⇒ live');
	assert(reads.length === 0, 'the live default reads no asset');
	const driven = effectBakeChoice(doc, spy, true);
	assert(driven.mode === 'live' && driven.reason === 'driven', 'a driven mount ⇒ live');

	loaded.delete(`${RESULT.assetKey}::bake_00000000_001`);
	const missing = effectBakeChoice(doc, lookup);
	assert(missing.mode === 'live' && missing.reason === 'missing-art', 'one frame missing ⇒ live');
	loaded.set('bake_00000000_001', 'tex:bare');
	assert(effectBakeChoice(doc, lookup).mode === 'baked', 'a bare frame key also resolves');

	const event = JSON.parse(JSON.stringify(doc)) as EffectDoc;
	event.layers[0].trigger = { on: 'event', eventType: 'win' };
	const refused = effectBakeChoice(event, lookup);
	assert(refused.mode === 'live' && refused.reason === 'not-bakeable', 'an unbakeable doc ⇒ live');
}

console.log('6. per-instance desync');
{
	const realRandom = Math.random;
	let draws = 0;
	Math.random = () => {
		draws++;
		return realRandom();
	};
	const starts = new Set<number>();
	for (let i = 0; i < 11; i++)
		starts.add(effectBakeStartFrame(effectBakeInstanceKey('firecracker', 'pot', i * 90, 400), 48));
	const again = effectBakeStartFrame(effectBakeInstanceKey('firecracker', 'pot', 90, 400), 48);
	const first = effectBakeStartFrame(effectBakeInstanceKey('firecracker', 'pot', 90, 400), 48);
	Math.random = realRandom;
	assert(draws === 0, 'Math.random is never drawn');
	assert(again === first, 'the same instance starts on the same frame every run');
	assert(starts.size >= 8, `eleven firecrackers spread over the loop (${starts.size} distinct)`);
	assert(
		effectBakeInstanceKey('e', undefined, 10.4, -3.6) === 'e||10,-4',
		'the key rounds the position',
	);
	assert(effectBakeStartFrame('anything', 1) === 0, 'a one-frame loop starts at 0');
	assert(effectBakeFrameAt(40, 0.5, 24, 48) === 4, 'playback wraps around the loop');
	assert(effectBakeFrameAt(3, -1, 24, 48) === 3, 'negative time holds the start');
}

console.log('7. the export');
{
	const doc = freshDoc();
	assert(effectBakeShips(doc), 'a current, enabled bake ships');
	assert(eq(exportableEffectDoc(doc), doc), '… and is exported as is');
	const plain = normalizeEffectDoc(rawDoc());
	assert(exportableEffectDoc(plain) === plain, 'a doc without bake is exported untouched');
	const off = { ...doc, bake: { ...doc.bake!, enabled: false } };
	assert(!('bake' in exportableEffectDoc(off)), 'a disabled bake is stripped from the export');
	const tuned = JSON.parse(JSON.stringify(doc)) as EffectDoc;
	(tuned.layers[0].config as unknown as Record<string, unknown>).frequency = 0.02;
	assert(!effectBakeShips(tuned), 'a stale bake does not ship');
	assert(!('bake' in exportableEffectDoc(tuned)), '… and is stripped, so the game plays live');
	const exported = exportableEffectDoc(doc);
	assert(
		effectBakeChoice(exported, (k) => (k.startsWith(RESULT.assetKey) ? 1 : undefined)).mode ===
			'baked',
		'the exported doc still chooses baked once its sheet is loaded',
	);
}

console.log('8. a rig beat');
{
	const doc = freshDoc();
	const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
	assert(effectBakeLongestLife(doc) === 1.2, 'the longest life is the largest lifetime.max');
	const fades = effectBakeBeatFades(doc);
	const life = 1.2 / DEFAULT_EMIT_SPEED / 1000;
	assert(near(fades.fadeOut, life), `it fades out over that life at the default speed (${life} s)`);
	assert(
		fades.fadeIn === EFFECT_BAKE_BEAT_FADE_IN_SECONDS,
		`and in over ${EFFECT_BAKE_BEAT_FADE_IN_SECONDS} s`,
	);
	const fast = effectBakeBeatFades(doc, DEFAULT_EMIT_SPEED * 2);
	assert(near(fast.fadeOut, life / 2), 'twice the emit speed halves the fade-out');
	assert(effectBakeBeatRate() === 1, 'the default speed plays the loop at 1');
	assert(effectBakeBeatRate(DEFAULT_EMIT_SPEED * 2) === 2, 'twice the emit speed plays it at 2');
	const short = {
		...doc.layers[0],
		config: { ...doc.layers[0].config, lifetime: { min: 0.01, max: 0.02 } },
	};
	const tiny = effectBakeBeatFades({ layers: [short] });
	assert(tiny.fadeIn === tiny.fadeOut, 'the fade-in is never longer than the life');

	const f = { fadeIn: 0.1, fadeOut: 0.5 };
	assert(effectBakeBeatAlpha(0, undefined, f) === 0, 'nothing drawn on the beat itself');
	assert(near(effectBakeBeatAlpha(0.05, undefined, f), 0.5), 'half-way up the fade-in');
	assert(effectBakeBeatAlpha(3, undefined, f) === 1, 'full while emitting, without end');
	assert(effectBakeBeatAlpha(0.9, 1, f) === 1, 'full until emission ends');
	assert(near(effectBakeBeatAlpha(1.25, 1, f), 0.5), 'half-way down the fade-out');
	assert(effectBakeBeatAlpha(1.5, 1, f) === 0, 'gone once the longest life has passed');
	assert(effectBakeBeatAlpha(9, 1, f) === 0, 'and stays gone');
	assert(
		near(effectBakeBeatAlpha(0.05, 0.05, f), 0.5) && near(effectBakeBeatAlpha(0.3, 0.05, f), 0.25),
		'released mid fade-in ⇒ fades out from where it had got to',
	);
	assert(effectBakeBeatAlpha(0, 0, f) === 0, 'released at once ⇒ never drawn');
	assert(
		effectBakeBeatAlpha(1, 1, { fadeIn: 0, fadeOut: 0 }) === 0,
		'no lifetime ⇒ off at the end',
	);
	assert(
		effectBakeBeatAlpha(0, undefined, { fadeIn: 0, fadeOut: 0 }) === 1,
		'… and full before it',
	);
}

console.log('9. blend groups');
{
	const layer = (key: string, blend?: string) => ({
		key,
		config: sparkConfig({
			behaviors: blend ? [{ type: 'blendMode', config: { blendMode: blend } }] : [],
		}),
		art: { assetKey: 'c/p/manifests/fx.json', frames: ['Spark_Mini'] },
		placement: { space: 'free' },
		particleKind: 'sprite',
	});
	// The Overlay Buffalo Duel `s_sparks_small` stack: two normal layers under four additive ones.
	const layers = [
		layer('Clouds'),
		layer('Fire'),
		layer('layer-5', 'add'),
		layer('Sparks2', 'add'),
		layer('layer-6', 'add'),
		layer('layer-7', 'add'),
	];
	const groups = effectBakeGroups(normalizeEffectDoc(rawDoc({ layers })).layers);
	assert(
		eq(groups, [
			{ blendMode: 'normal', layers: ['Clouds', 'Fire'] },
			{ blendMode: 'add', layers: ['layer-5', 'Sparks2', 'layer-6', 'layer-7'] },
		]),
		'consecutive layers that share a blend are one group, in draw order',
	);
	const sandwich = effectBakeGroups(
		normalizeEffectDoc(
			rawDoc({ layers: [layer('a', 'add'), layer('b'), layer('c', 'add'), layer('d', 'screen')] }),
		).layers,
	);
	assert(
		eq(
			sandwich.map((g) => g.blendMode),
			['add', 'normal', 'add', 'screen'],
		),
		'a blend that comes back later is a new group (draw order is kept)',
	);
	assert(
		eq(
			effectBakeGroups(
				normalizeEffectDoc(rawDoc({ layers: [layer('m', 'multiply'), layer('x', 'overlay')] }))
					.layers,
			).map((g) => g.blendMode),
			['multiply', 'normal'],
		),
		'multiply is its own group; an unknown blend draws as normal',
	);

	// A bake from before blend groups: `frames` + `blendMode` at the top of the result.
	const settings = { enabled: true, fps: 24, loopSeconds: 2, scale: 0.25, seam: 'crossfade' };
	const legacy = (blendMode: string, docLayers: unknown[]) => {
		const draft = normalizeEffectDoc(rawDoc({ layers: docLayers, bake: settings }));
		const { groups: _groups, ...rest } = RESULT;
		return normalizeEffectDoc({
			...draft,
			bake: {
				...draft.bake,
				result: { ...rest, frames: FRAMES, blendMode, hash: effectBakeHash(draft) },
			},
		}) as EffectDoc;
	};
	const mixed = legacy('normal', layers);
	assert(
		eq(mixed.bake?.result?.groups, [{ blendMode: 'normal', frames: FRAMES }]),
		'a pre-group result reads as one group',
	);
	assert(
		!effectBakeGroupsMatch(mixed) && effectBakeStale(mixed),
		'… and when its layers mix blends (it flattened them) it is stale — Bake again',
	);
	assert(!effectBakeShips(mixed), '… so the export does not ship it');
	const lookup = (k: string) => (k.startsWith(RESULT.assetKey) ? 1 : undefined);
	const choice = effectBakeChoice(mixed, lookup);
	assert(
		choice.mode === 'live' && choice.reason === 'stale-blend',
		'… and a game that already has it plays the effect live',
	);
	const allAdd = legacy('add', [layer('a', 'add'), layer('b', 'add')]);
	assert(
		effectBakeGroupsMatch(allAdd) && !effectBakeStale(allAdd),
		'a pre-group bake of an all-additive effect is still current',
	);
	assert(effectBakeChoice(allAdd, lookup).mode === 'baked', '… and still plays baked');
	const allNormal = legacy('normal', [layer('a'), layer('b')]);
	assert(!effectBakeStale(allNormal), 'a pre-group bake of an all-normal effect is still current');
	const allScreen = legacy('normal', [layer('a', 'screen')]);
	assert(effectBakeStale(allScreen), 'a pre-group bake that flattened screen to normal is stale');
}

if (failures) {
	console.error(`\n${failures} failure(s)`);
	process.exit(1);
}
console.log('\nall effect-bake checks passed');
