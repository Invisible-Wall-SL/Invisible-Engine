/**
 * The page `nineSliceParity.mjs` drives: every case drawn by the game's views
 * (`engine-layout/slicedSpriteViews.ts`, from a real `PIXI.Spritesheet` frame carrying the export's
 * `borders`) and by the editor canvas's `drawNineSlice`, read back and compared pixel by pixel.
 *
 * Sampling is nearest on both sides, so what is compared is geometry: where each piece's source
 * and destination rects land. The art gives every pixel its own colour, so a piece a pixel out, a
 * rotated piece turned the wrong way or a tile restarting at the wrong place all show.
 *
 * A piece edge on a fractional pixel is a SEAM: the 2D canvas blends that pixel from both pieces
 * while WebGL gives it to one, so seam columns and rows are not compared. Everything else is.
 */
import * as PIXI from 'pixi.js';
import { buildSliceViews, sliceArt } from '../../packages/engine-layout/src/lib/slicedSpriteViews';
import { nineSlicePieces, type SliceMode } from '../../packages/engine-layout/src/lib/nineSlice';
import { drawNineSlice } from '../../apps/launcher-api/src/routes/(app)/editor/nineSliceDraw';

const ART_W = 24;
const ART_H = 18;
const PAGE = 128;
const INSETS = { left: 5, top: 4, right: 7, bottom: 3 };
const THRESHOLD = 2;

/**
 * `pattern`: a colour no other art pixel has (its own coordinates), so orientation and tile phase
 * show. `blocks`: one flat colour per piece, so a box that resamples the corners (smaller than two
 * of them) compares where the pieces land, not which source pixel nearest sampling picked.
 */
type ArtKind = 'pattern' | 'blocks';
const piece = (n: number, a: number, b: number, size: number): number =>
	n < a ? 0 : n < size - b ? 1 : 2;
const artColour = (kind: ArtKind, u: number, v: number): [number, number, number] => {
	if (kind === 'pattern') return [20 + u * 9, 20 + v * 12, (u * 7 + v * 13) % 2 ? 230 : 40];
	const col = piece(u, INSETS.left, INSETS.right, ART_W);
	const row = piece(v, INSETS.top, INSETS.bottom, ART_H);
	return [40 + col * 90, 40 + row * 90, (col + row) % 2 ? 220 : 60];
};

interface Frame {
	name: string;
	kind: ArtKind;
	x: number;
	y: number;
	rotated: boolean;
	trim?: { x: number; y: number; w: number; h: number };
}

/** Three packings of the same art: plain, rotated 90° clockwise, and trimmed out of a margin. */
const FRAMES: Frame[] = (['pattern', 'blocks'] as const).flatMap((kind, k) => [
	{ name: `${kind} plain`, kind, x: 2 + k * 64, y: 2, rotated: false },
	{ name: `${kind} rotated`, kind, x: 30 + k * 64, y: 2, rotated: true },
	{
		name: `${kind} trimmed`,
		kind,
		x: 2 + k * 64,
		y: 30,
		rotated: false,
		trim: { x: 3, y: 2, w: 30, h: 22 },
	},
]);

function makePage(): HTMLCanvasElement {
	const page = document.createElement('canvas');
	page.width = PAGE;
	page.height = PAGE;
	const ctx = page.getContext('2d') as CanvasRenderingContext2D;
	const img = ctx.createImageData(PAGE, PAGE);
	for (const f of FRAMES) {
		for (let v = 0; v < ART_H; v++) {
			for (let u = 0; u < ART_W; u++) {
				const px = f.rotated ? f.x + (ART_H - 1 - v) : f.x + u;
				const py = f.rotated ? f.y + u : f.y + v;
				const i = (py * PAGE + px) * 4;
				const [r, g, b] = artColour(f.kind, u, v);
				img.data.set([r, g, b, 255], i);
			}
		}
	}
	ctx.putImageData(img, 0, 0);
	return page;
}

/** The TexturePacker JSON the export writes for these frames, `borders` included. */
function sheetData(): PIXI.SpritesheetData {
	const frames: PIXI.SpritesheetData['frames'] = {};
	for (const f of FRAMES) {
		frames[f.name] = {
			frame: { x: f.x, y: f.y, w: ART_W, h: ART_H },
			rotated: f.rotated,
			trimmed: !!f.trim,
			spriteSourceSize: { x: f.trim?.x ?? 0, y: f.trim?.y ?? 0, w: ART_W, h: ART_H },
			sourceSize: { w: f.trim?.w ?? ART_W, h: f.trim?.h ?? ART_H },
			borders: INSETS,
		};
	}
	return { frames, meta: { image: 'page', scale: 1, size: { w: PAGE, h: PAGE } } };
}

/** The last box is smaller than two corners: they shrink, so only the `blocks` art compares it. */
const BOXES: [number, number][] = [
	[ART_W, ART_H],
	[61, 37],
	[90, 23],
	[9, 6],
];
const SHRUNK = 3;

interface Result {
	label: string;
	differing: number;
	drawn: number;
}

/** The pixel columns (or rows) a fractional piece edge crosses. */
function seams(edges: number[]): Set<number> {
	const out = new Set<number>();
	for (const e of edges) if (!Number.isInteger(e)) out.add(Math.floor(e));
	return out;
}

async function run(): Promise<void> {
	const page = makePage();
	const source = new PIXI.CanvasSource({ resource: page, scaleMode: 'nearest' });
	const sheet = new PIXI.Spritesheet(new PIXI.Texture({ source }), sheetData());
	await sheet.parse();

	const W = 96;
	const H = 48;
	const app = new PIXI.Application();
	await app.init({
		width: W,
		height: H,
		backgroundAlpha: 0,
		antialias: false,
		preference: 'webgl',
		preserveDrawingBuffer: true,
	});

	const results: Result[] = [];
	for (const f of FRAMES) {
		const art = sliceArt(sheet.textures[f.name]);
		for (const mode of ['stretch', 'tile'] as SliceMode[]) {
			for (const [b, [bw, bh]] of BOXES.entries()) {
				if (b === SHRUNK && f.kind === 'pattern') continue;
				const label = `${f.name} ${mode} ${bw}×${bh}`;
				const { views, textures } = buildSliceViews(art, bw, bh, mode);
				const holder = new PIXI.Container();
				for (const v of views) holder.addChild(v);
				app.stage.addChild(holder);
				app.renderer.render(app.stage);
				const game = app.renderer.extract.pixels({
					target: app.stage,
					frame: new PIXI.Rectangle(0, 0, W, H),
				}).pixels;
				app.stage.removeChild(holder);
				holder.destroy({ children: true });
				for (const t of textures) t.destroy(false);

				const canvas = document.createElement('canvas');
				canvas.width = W;
				canvas.height = H;
				const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
				ctx.imageSmoothingEnabled = false;
				drawNineSlice(
					ctx,
					page,
					{ x: f.x, y: f.y, w: ART_W, h: ART_H, rotated: f.rotated },
					INSETS,
					bw,
					bh,
					mode,
				);
				const editor = ctx.getImageData(0, 0, W, H).data;

				const pieces = nineSlicePieces(ART_W, ART_H, INSETS, bw, bh, mode);
				const seamX = seams(pieces.flatMap((p) => [p.dx, p.dx + p.dw]));
				const seamY = seams(pieces.flatMap((p) => [p.dy, p.dy + p.dh]));
				let differing = 0;
				let drawn = 0;
				for (let i = 0; i < W * H * 4; i += 4) {
					const px = (i / 4) % W;
					const py = Math.floor(i / 4 / W);
					if (seamX.has(px) || seamY.has(py)) continue;
					const ga = game[i + 3];
					const ea = editor[i + 3];
					if (ga === 0 && ea === 0) continue;
					drawn++;
					const off =
						Math.abs(ga - ea) > THRESHOLD ||
						Math.abs(game[i] - editor[i]) > THRESHOLD ||
						Math.abs(game[i + 1] - editor[i + 1]) > THRESHOLD ||
						Math.abs(game[i + 2] - editor[i + 2]) > THRESHOLD;
					if (off) differing++;
				}
				results.push({ label, differing, drawn });
			}
		}
	}
	(window as unknown as { result: Result[] }).result = results;
	(window as unknown as { ready: boolean }).ready = true;
}

run().catch((e: unknown) => {
	console.error(`[uncaught] ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
});
