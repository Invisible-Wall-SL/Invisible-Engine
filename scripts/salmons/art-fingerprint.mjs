// SALMONS' RIVER ART, AS A FINGERPRINT (`check:salmons-art`): `salmonsArt/river.ts` drawn in Node,
// with no GPU, into a scene graph whose every piece (its kind, place, scale, turn, tint, alpha,
// depth, texture and every fill of a drawing) is hashed. Two rivers with the same fingerprint are
// drawn alike, piece for piece and colour for colour. Textures made by the drawing (the riverbed
// and the sea) are named by their drawing's fills; the art's regions by their names.

import { createHash } from 'node:crypto';
import { createRequire, registerHooks } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PIXI = createRequire(join(ROOT, 'packages/engine-layout/package.json')).resolve('pixi.js');
const { Container, Graphics, Sprite, Texture, TextureSource, TilingSprite } = await import(
	pathToFileURL(PIXI.replace(/index\.js$/, 'index.mjs')).href
);

// The projected world's registry (a Svelte module) stood in for: the spawn layer is one container
// the drawing finds, and the projector the one it is handed.
const layer = { current: undefined };
globalThis.__salmonsArtLayer = layer;
registerHooks({
	resolve: (specifier, context, next) =>
		specifier === '../worldDrawing.svelte'
			? {
					url:
						'data:text/javascript,' +
						encodeURIComponent(
							'export const projectedLayer = () => globalThis.__salmonsArtLayer.current;',
						),
					shortCircuit: true,
				}
			: next(specifier, context),
});
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
function describe(node, out) {
	const row = [
		node.constructor.name,
		node.label ?? '',
		round(node.x),
		round(node.y),
		round(node.scale.x),
		round(node.scale.y),
		round(node.rotation),
		node.tint,
		round(node.alpha),
		node.zIndex,
	];
	if (node instanceof Sprite || node instanceof TilingSprite) row.push(node.texture.label);
	if (node instanceof Graphics) row.push(fillsOf(node));
	out.push(row);
	for (const child of node.children) describe(child, out);
}

/**
 * The fingerprint of `river` (a `salmonsMapRiver`) drawn by the drawing in `module` (a path under
 * `salmonsArt/`, default `river.ts`) with `projector`: the hash of everything it drew, under the
 * river's container and in the spawn layer, and the count of pieces. `strip(container)` may take
 * a part away first.
 */
export async function riverArtFingerprint(river, projector, { module = 'river.ts', omit } = {}) {
	const { mountSalmonsRiver } = await import(
		pathToFileURL(join(ROOT, 'packages/engine-layout/src/lib/salmonsArt', module)).href
	);
	const { app, art } = stage();
	const into = new Container();
	layer.current = new Container();
	// The displacement map is drawn on a canvas, which Node has none of.
	const from = Texture.from;
	Texture.from = (source) => (source?.getContext ? named('canvas') : from.call(Texture, source));
	let drawn;
	try {
		drawn = mountSalmonsRiver(into, app, art, river, river.seed, projector);
	} finally {
		Texture.from = from;
	}
	into.updateLocalTransform();
	const rows = [];
	if (omit) omit(into);
	describe(into, rows);
	describe(layer.current, rows);
	const hash = createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 24);
	drawn.teardown();
	return { hash, pieces: rows.length, rows };
}
