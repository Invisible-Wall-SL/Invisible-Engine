// SALMONS' RIVER ART, AS A FINGERPRINT (`check:salmons-art`): `salmonsArt/river.ts` drawn in Node,
// with no GPU, into a scene graph whose every drawn piece, in the order it is drawn (its kind, its
// place, scale and turn from the river's container, tint, alpha, filters, depth, texture and every
// fill of a drawing), is hashed; how the pieces are grouped in containers is not. Two rivers with
// the same fingerprint are drawn alike, piece for piece and colour for colour. Textures made by the
// drawing (the riverbed and the sea) are named by their drawing's fills; the art's regions by their
// names.

import { createHash } from 'node:crypto';
import { createRequire, registerHooks } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PIXI = createRequire(join(ROOT, 'packages/engine-layout/package.json')).resolve('pixi.js');
const { Container, Graphics, Matrix, Sprite, Texture, TextureSource, TilingSprite } = await import(
	pathToFileURL(PIXI.replace(/index\.js$/, 'index.mjs')).href
);

// The projected world's registry is the real one (`worldDrawing.svelte.ts`, which the drawing imports
// without its extension): the spawn layer is one container registered under Salmons' field layer.
registerHooks({
	resolve: (specifier, context, next) =>
		specifier.endsWith('/worldDrawing.svelte')
			? next(`${specifier}.ts`, context)
			: next(specifier, context),
});
const { registerProjectedLayer } = await import(
	pathToFileURL(join(ROOT, 'packages/engine-layout/src/lib/worldDrawing.svelte.ts')).href
);
const { SALMONS_FIELD_LAYER } = await import(
	pathToFileURL(join(ROOT, 'packages/engine-layout/src/lib/referenceLayouts/salmonsRiver.ts')).href
);
globalThis.document ??= { createElement: () => ({ getContext: () => null }) };

const named = (label) =>
	new Texture({ source: new TextureSource({ width: 64, height: 64 }), label });
const fillsOf = (g) =>
	JSON.stringify(
		g.context.instructions.map((i) => [
			i.action,
			i.data?.style?.color,
			i.data?.style?.alpha,
			i.data?.path?.instructions?.map((p) => [p.action, p.data]),
		]),
	);

/** A stand-in for the app and the art: textures by name, a screen that sees everything. */
function stage() {
	const app = {
		renderer: {
			generateTexture: ({ target }) => named(`made:${fillsOf(target)}`),
			screen: { width: 1e7, height: 1e7 },
		},
		ticker: { add: () => {}, remove: () => {} },
	};
	const art = { region: (name) => named(name), face: named('face'), cliff: named('cliff') };
	return { app, art };
}

const round = (v) => Math.round(v * 1000) / 1000;
const tintTimes = (a, b) =>
	(((((a >> 16) & 255) * ((b >> 16) & 255)) / 255) << 16) |
	(((((a >> 8) & 255) * ((b >> 8) & 255)) / 255) << 8) |
	(((a & 255) * (b & 255)) / 255);
/**
 * Every piece `node` draws, in the order it draws them: each drawn leaf (a sprite, a tiling
 * sprite, a drawing) with its place, scale and turn as one matrix from `node`, its tint and alpha
 * times its containers', the filters it is drawn through, its depth, its anchor and its texture or
 * fills. Containers add nothing of their own, so two trees that draw the same leaves the same way
 * in the same order describe alike however their pieces are grouped. A piece hidden, not drawn or
 * fully see-through draws nothing and is not listed.
 */
function describe(node, out, at = new Matrix(), tint = 0xffffff, alpha = 1, filters = []) {
	if (!node.visible || node.alpha === 0) return;
	node.updateLocalTransform();
	const m = new Matrix().copyFrom(at).append(node.localTransform);
	const t = tintTimes(tint, node.tint);
	const a = alpha * node.alpha;
	const through = node.filters?.length
		? [...filters, ...node.filters.map((f) => f.constructor.name)]
		: filters;
	if (node.renderPipeId && node.renderable) {
		const row = [
			node.constructor.name,
			node.label ?? '',
			...[m.a, m.b, m.c, m.d, m.tx, m.ty].map(round),
			t,
			round(a),
			node.zIndex,
			through.join('+'),
		];
		if (node.anchor) row.push(round(node.anchor.x), round(node.anchor.y));
		if (node instanceof Sprite || node instanceof TilingSprite) row.push(node.texture.label);
		if (node instanceof TilingSprite)
			row.push(
				round(node.width),
				round(node.height),
				round(node.tileScale.x),
				round(node.tileScale.y),
				round(node.tilePosition.x),
				round(node.tilePosition.y),
			);
		if (node instanceof Graphics) row.push(fillsOf(node));
		const b = node.bounds;
		const xs = [];
		const ys = [];
		for (const [x, y] of [
			[b.minX, b.minY],
			[b.maxX, b.minY],
			[b.minX, b.maxY],
			[b.maxX, b.maxY],
		]) {
			xs.push(m.a * x + m.c * y + m.tx);
			ys.push(m.b * x + m.d * y + m.ty);
		}
		out.push({
			row,
			box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
		});
	}
	for (const child of node.children) describe(child, out, m, t, a, through);
}

/** The grid the drawn pieces' boxes are sorted into to find the ones that overlap, px, and how far
 *  two must overlap to count (two that only touch meet by a rounding error). */
const GRID = 128;
const OVERLAP = 1e-3;

/**
 * The pieces in a canonical order that keeps every two whose boxes overlap in the order they are
 * drawn, and puts the rest by what they are: two lists that draw every overlapping pair in the same
 * order draw the same pixels, and come out the same here, whatever order they draw the others in.
 */
function canonical(drawn) {
	const n = drawn.length;
	const keys = drawn.map(({ row }) => JSON.stringify(row));
	const cells = new Map();
	drawn.forEach(({ box }, i) => {
		for (let gy = Math.floor(box[1] / GRID); gy <= Math.floor(box[3] / GRID); gy++)
			for (let gx = Math.floor(box[0] / GRID); gx <= Math.floor(box[2] / GRID); gx++) {
				const key = `${gx},${gy}`;
				const list = cells.get(key);
				if (list) list.push(i);
				else cells.set(key, [i]);
			}
	});
	const after = Array.from({ length: n }, () => []);
	const before = new Int32Array(n);
	for (const [key, list] of cells) {
		const [gx, gy] = key.split(',').map(Number);
		for (let p = 0; p < list.length; p++)
			for (let q = p + 1; q < list.length; q++) {
				const a = drawn[list[p]].box;
				const b = drawn[list[q]].box;
				const x0 = Math.max(a[0], b[0]);
				const y0 = Math.max(a[1], b[1]);
				if (Math.min(a[2], b[2]) - x0 < OVERLAP || Math.min(a[3], b[3]) - y0 < OVERLAP) continue;
				// Each pair once: in the cell its overlap starts in.
				if (Math.floor(x0 / GRID) !== gx || Math.floor(y0 / GRID) !== gy) continue;
				after[list[p]].push(list[q]);
				before[list[q]]++;
			}
	}
	const heap = [];
	const less = (i, j) => keys[i] < keys[j];
	const push = (i) => {
		heap.push(i);
		for (let k = heap.length - 1; k > 0;) {
			const up = (k - 1) >> 1;
			if (!less(heap[k], heap[up])) break;
			[heap[k], heap[up]] = [heap[up], heap[k]];
			k = up;
		}
	};
	const pop = () => {
		const top = heap[0];
		const last = heap.pop();
		if (heap.length) {
			heap[0] = last;
			for (let k = 0; ;) {
				const l = 2 * k + 1;
				const r = l + 1;
				let m = k;
				if (l < heap.length && less(heap[l], heap[m])) m = l;
				if (r < heap.length && less(heap[r], heap[m])) m = r;
				if (m === k) break;
				[heap[k], heap[m]] = [heap[m], heap[k]];
				k = m;
			}
		}
		return top;
	};
	for (let i = 0; i < n; i++) if (!before[i]) push(i);
	const order = [];
	while (heap.length) {
		const i = pop();
		order.push(keys[i]);
		for (const j of after[i]) if (!--before[j]) push(j);
	}
	return order;
}

/**
 * The fingerprint of `river` (a `salmonsMapRiver`) drawn by the drawing in `module` (a path under
 * `salmonsArt/`, default `river.ts`) with `projector`, seen whole: the hash of everything it drew,
 * under the river's container and in the spawn layer, in {@link canonical} order, the count of
 * pieces and the pieces as drawn. `omit(container)` may take a part away first.
 */
export async function riverArtFingerprint(river, projector, { module = 'river.ts', omit } = {}) {
	const { mountSalmonsRiver } = await import(
		pathToFileURL(join(ROOT, 'packages/engine-layout/src/lib/salmonsArt', module)).href
	);
	const { app, art } = stage();
	const into = new Container();
	const layer = new Container();
	// The view: far past the river's every side (its container, unattached, has none of its own).
	const view = new Matrix(1, 0, 0, 1, 5e6, 5e6);
	for (const container of [into, layer])
		Object.defineProperty(container, 'worldTransform', { get: () => view });
	const unregister = registerProjectedLayer(SALMONS_FIELD_LAYER, layer);
	// The displacement map is drawn on a canvas, which Node has none of.
	const from = Texture.from;
	Texture.from = (source) => (source?.getContext ? named('canvas') : from.call(Texture, source));
	let drawn;
	try {
		drawn = mountSalmonsRiver(into, app, art, river, river.seed, projector);
	} finally {
		Texture.from = from;
	}
	const pieces = [];
	if (omit) omit(into);
	describe(into, pieces);
	describe(layer, pieces);
	const rows = pieces.map(({ row }) => row);
	const hash = createHash('sha256')
		.update(JSON.stringify(canonical(pieces)))
		.digest('hex')
		.slice(0, 24);
	drawn.teardown();
	unregister();
	return { hash, pieces: rows.length, rows, boxes: pieces.map(({ box }) => box) };
}
