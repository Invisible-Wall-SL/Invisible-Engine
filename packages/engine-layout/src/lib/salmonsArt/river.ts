import {
	AnimatedSprite,
	Container,
	DisplacementFilter,
	Graphics,
	Matrix,
	Sprite,
	Texture,
	TilingSprite,
	type Application,
	type Ticker,
} from 'pixi.js';

import type { SalmonsRiverDrawing } from '../referenceLayouts/salmonsRiver';
import type { SalmonsTextures } from './load';
import { compassTile } from './regions';
import { seededRandom } from './random';

/**
 * SALMONS' RIVER IN ITS ORIGINAL ART: the river a room's seed made (`engine-mechanics`
 * `salmonsRiver`), drawn as the old client (`GuiltyForever/Salmon-` `client/game.js`) drew its
 * own, inside the same shapes the placeholder rectangles drew. The old client laid a 64 × 32
 * diamond grid; here a CELL of 48 world px is drawn as a 96 × 48 diamond, so every size of the old
 * client is scaled by {@link K}.
 *
 * Ground (painted diamonds: the grass and sand autotiles, the riverbed, the tint, the sea, the
 * waterfalls' faces) is drawn in the flat world under the same 2:1 turn `<IsoWorld>` gives a ground
 * node; upright things (rocks, whirlpools, trees, the waterfalls' lips and splashes) are drawn at
 * their projected places. Animated parts tick on the app's ticker. Only what the view holds is
 * drawn (each piece is culled by its box).
 */

export const CELL = 48;
/** The old client's sizes to the engine's: a 64 × 32 tile is a 96 × 48 one. */
export const K = CELL / 32;

const FOREST_FLOOR = 0x28591e;
const WATER_TINT = 0x0ea5e9;
const RAPIDS_TINT = 0x38bdf8;
const SOURCE_TINT = 0x7dd3fc;
const TINT_ALPHA = 0.75;
const RIVERBED = [
	0xb89968, 0xc4a576, 0xa88858, 0xd0b487, 0xb09060, 0xc8a878, 0xa07050, 0xb88f5d, 0xc59f70,
];
/** Each biome of the forest, `BIOME_ROWS` cells of the river long, grows two of the six trees. */
const BIOME_TREE_PAIRS = [
	[0, 1],
	[2, 3],
	[4, 5],
	[0, 3],
	[1, 4],
	[2, 5],
];
const BIOME_ROWS = 24;
const TREE_CHANCE = 0.07;
const TREE_W = 96 * K;
const FOREST_DEPTH = 4;
/** How far the sea runs on past the world, cells: the view at the sea sees past its corners. */
const SEA_MARGIN = 14;
/** The old client's whirlpool, drawn 230 px wide, at K, for the engine's pool of r 90. */
const WHIRLPOOL_W = 230.4 * K;
const WHIRLPOOL_FPS = 9;
const LIP_FPS = 3.6;
const SPLASH_FPS = 4.8;

type Wet = 'water' | 'rapids' | 'source' | 'sea';
type Box = { x0: number; y0: number; x1: number; y1: number };
type Culled = { view: Container; box: Box };

const project = (x: number, y: number) => ({ x: x - y, y: (x + y) / 2 });

/** A ground texture drawn over the world rectangle (x, y, w, h), in the flat frame: its diamond
 *  turned back to the square the projection turns into it. */
function groundTile(texture: Texture, x: number, y: number, w: number, h: number): Container {
	const sprite = new Sprite(texture);
	sprite.anchor.set(0.5);
	sprite.rotation = -Math.PI / 4;
	if (w === h) {
		sprite.position.set(x + w / 2, y + h / 2);
		sprite.scale.set((Math.SQRT2 * w) / texture.width, (Math.SQRT2 * h) / texture.height);
		return sprite;
	}
	const box = new Container();
	box.position.set(x + w / 2, y + h / 2);
	box.scale.set(w, h);
	sprite.scale.set(Math.SQRT2 / texture.width, Math.SQRT2 / texture.height);
	box.addChild(sprite);
	return box;
}

/** A 64 × 32 diamond (the old client's tile), drawn by `paint`, as a texture. */
function diamondTexture(app: Application, paint: (g: Graphics) => void): Texture {
	const g = new Graphics();
	paint(g);
	const texture = app.renderer.generateTexture({ target: g, resolution: 2 });
	g.destroy();
	return texture;
}

const diamond = (g: Graphics, w = 64, h = 32) =>
	g
		.moveTo(w / 2, 0)
		.lineTo(w, h / 2)
		.lineTo(w / 2, h)
		.lineTo(0, h / 2)
		.closePath();

/** The old client's riverbed variant `seed` (0–8): a sandy diamond with its pebbles. */
function riverbedTexture(app: Application, seed: number): Texture {
	return diamondTexture(app, (g) => {
		const w = 64;
		const h = 32;
		diamond(g).fill(RIVERBED[seed % RIVERBED.length]);
		let s = (seed * 9301 + 49297) % 233280;
		const rand = () => {
			s = (s * 9301 + 49297) % 233280;
			return s / 233280;
		};
		const pebbles = 8 + Math.floor(rand() * 6);
		for (let i = 0; i < pebbles; i++) {
			const px = w * 0.1 + rand() * w * 0.8;
			const py = h * 0.1 + rand() * h * 0.8;
			const out = Math.abs(px - w / 2) / (w / 2) + Math.abs(py - h / 2) / (h / 2) > 0.9;
			const r = 0.7 + rand() * 1.6;
			const tone = rand();
			if (out) continue;
			g.circle(px, py, r).fill(tone < 0.55 ? 0x6e5235 : tone < 0.85 ? 0xe0c89a : 0x4a6b4a);
		}
	});
}

/** The old client's sea tile: a deep diamond with a lighter swell. */
function seaTexture(app: Application): Texture {
	return diamondTexture(app, (g) => {
		const w = 64;
		const h = 32;
		diamond(g).fill(0x0369a1);
		g.moveTo(w * 0.3, h * 0.45)
			.lineTo(w * 0.5, h * 0.4)
			.lineTo(w * 0.7, h * 0.45)
			.lineTo(w * 0.5, h * 0.5)
			.closePath()
			.fill(0x0284c7);
	});
}

/** The old client's displacement map: 256 × 256 smooth noise, red and green the x and y push. */
function displacementTexture(): Texture {
	const size = 256;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext('2d');
	if (ctx) {
		const image = ctx.createImageData(size, size);
		for (let y = 0; y < size; y++)
			for (let x = 0; x < size; x++) {
				const i = (y * size + x) * 4;
				const u = (x / size) * Math.PI * 2;
				const v = (y / size) * Math.PI * 2;
				const r =
					(Math.sin(u * 2 + v * 1.3) + Math.sin(u * 4.7 + v * 2.1) + Math.sin(u * 1.1 + v * 3.3)) /
					3;
				const gv =
					(Math.cos(u * 1.7 + v * 2.5) +
						Math.cos(u * 3.1 + v * 1.5) +
						Math.cos(u * 2.3 + v * 4.7)) /
					3;
				image.data[i] = ((r + 1) * 0.5 * 255) | 0;
				image.data[i + 1] = ((gv + 1) * 0.5 * 255) | 0;
				image.data[i + 2] = 128;
				image.data[i + 3] = 255;
			}
		ctx.putImageData(image, 0, 0);
	}
	const texture = Texture.from(canvas);
	texture.source.style.addressMode = 'repeat';
	return texture;
}

/** What the river holds at a world point: its kind of water, or `undefined` for a bank. */
function wetAt(river: SalmonsRiverDrawing, x: number, y: number): Wet | undefined {
	if (y >= river.sea.y) return 'sea';
	const { source } = river;
	if (y >= source.y && y < source.y + source.h) {
		return x >= source.x && x < source.x + source.w ? 'source' : undefined;
	}
	const band = river.bands.find((b) => y >= b.y && y < b.y + b.h);
	if (!band || x < band.left || x >= band.right) return undefined;
	return band.current > 100 ? 'rapids' : 'water';
}

/** A river drawn: its teardown, the pieces drawn with a Salmons texture by region, and whether
 *  everything it made is destroyed (the probe's). */
export type RiverArt = {
	teardown: () => void;
	regions: () => Record<string, number>;
	destroyed: () => boolean;
};

/** How far past the view a piece is still drawn, px: a tree's height, so nothing pops in at the
 *  view's edge (the view is read a frame behind the camera). */
const CULL_PAD = TREE_W * 1.5;

/**
 * Draw `river` into `into` (at the projected origin of its world screen) with `art`; returns its
 * teardown and its probes. `seed` keeps the trees, rocks and bed the same on every device of a room.
 */
export function mountSalmonsRiver(
	into: Container,
	app: Application,
	art: SalmonsTextures,
	river: SalmonsRiverDrawing,
	seed: number | string,
): RiverArt {
	const random = seededRandom(`salmons-art:${seed}`);
	const made: Texture[] = [];
	const own = (texture: Texture) => (made.push(texture), texture);
	const beds = RIVERBED.map((_, i) => own(riverbedTexture(app, i)));
	const sea = own(seaTexture(app));
	const noise = own(displacementTexture());
	const used = new Map<string, number>();
	const region = (name: string) => {
		used.set(name, (used.get(name) ?? 0) + 1);
		return art.region(name);
	};

	const cols = Math.ceil(river.world.w / CELL);
	const rows = Math.ceil(river.world.h / CELL);
	const wetCell = (c: number, r: number): Wet | undefined =>
		c < 0 || c >= cols || r < 0
			? r * CELL >= river.sea.y
				? 'sea'
				: undefined
			: wetAt(river, (c + 0.5) * CELL, (r + 0.5) * CELL);

	const floor = new Graphics();
	const corners = [
		project(-SEA_MARGIN * CELL, -SEA_MARGIN * CELL),
		project(river.world.w + SEA_MARGIN * CELL, river.world.h + SEA_MARGIN * CELL),
		project(river.world.w + SEA_MARGIN * CELL, -SEA_MARGIN * CELL),
		project(-SEA_MARGIN * CELL, river.world.h + SEA_MARGIN * CELL),
	];
	const fx0 = Math.min(...corners.map((p) => p.x));
	const fy0 = Math.min(...corners.map((p) => p.y));
	floor
		.rect(
			fx0,
			fy0,
			Math.max(...corners.map((p) => p.x)) - fx0,
			Math.max(...corners.map((p) => p.y)) - fy0,
		)
		.fill(FOREST_FLOOR);

	const turn = new Container();
	turn.scale.set(1, 0.5);
	const flat = new Container();
	flat.rotation = Math.PI / 4;
	flat.scale.set(Math.SQRT2);
	turn.addChild(flat);
	const bed = new Container();
	const seaLayer = new Container();
	const tint = new Container();
	const grass = new Container();
	const sand = new Container();
	const falls = new Container();
	flat.addChild(bed, seaLayer, tint, grass, sand, falls);
	const upright = new Container();
	const trees: { sprite: Sprite; y: number }[] = [];
	const displacement = new Sprite(noise);
	displacement.alpha = 0;
	const filter = new DisplacementFilter({ sprite: displacement, scale: { x: 6, y: 4 } });
	bed.filters = [filter];
	into.addChild(floor, displacement, turn, upright);

	const flatCulled: Culled[] = [];
	const uprightCulled: Culled[] = [];
	const cellBox = (c: number, r: number): Box => ({
		x0: c * CELL,
		y0: r * CELL,
		x1: (c + 1) * CELL,
		y1: (r + 1) * CELL,
	});
	const onGround = (layer: Container, view: Container, box: Box) => {
		layer.addChild(view);
		flatCulled.push({ view, box });
	};
	const bedTile = (c: number, r: number) =>
		beds[((Math.imul(c, 73856093) ^ Math.imul(r, 19349663)) >>> 0) % beds.length];
	const tintTile = (c: number, r: number, color: number) => {
		const square = new Sprite(Texture.WHITE);
		square.position.set(c * CELL, r * CELL);
		square.width = CELL;
		square.height = CELL;
		square.tint = color;
		square.alpha = TINT_ALPHA;
		onGround(tint, square, cellBox(c, r));
	};
	const tintOf = (wet: Wet) =>
		wet === 'rapids' ? RAPIDS_TINT : wet === 'source' ? SOURCE_TINT : WATER_TINT;
	const tree = (c: number, r: number, variant: number) => {
		const texture = region(`tree_${variant}`);
		const sprite = new Sprite(texture);
		const at = project((c + 0.5) * CELL, (r + 0.5) * CELL);
		sprite.anchor.set(0.5, 1);
		sprite.scale.set(TREE_W / texture.width);
		sprite.position.set(at.x, at.y + CELL / 4);
		trees.push({ sprite, y: sprite.y });
	};
	const biomeTree = (r: number) => {
		const pair = BIOME_TREE_PAIRS[((Math.floor(r / BIOME_ROWS) % 6) + 6) % 6];
		return pair[random() < 0.5 ? 0 : 1];
	};

	for (let r = 0; r < rows; r++)
		for (let c = 0; c < cols; c++) {
			const box = cellBox(c, r);
			const wet = wetCell(c, r);
			if (wet === 'sea') {
				onGround(seaLayer, groundTile(sea, box.x0, box.y0, CELL, CELL), box);
				continue;
			}
			if (wet) {
				onGround(bed, groundTile(bedTile(c, r), box.x0, box.y0, CELL, CELL), box);
				tintTile(c, r, tintOf(wet));
				continue;
			}
			const n = !wetCell(c, r - 1);
			const e = !wetCell(c + 1, r);
			const s = !wetCell(c, r + 1);
			const w = !wetCell(c - 1, r);
			if (!(n && e && s && w)) {
				const near =
					wetCell(c, r - 1) ?? wetCell(c + 1, r) ?? wetCell(c, r + 1) ?? wetCell(c - 1, r);
				// Under the shore's cut-out water: the water it meets.
				if (near === 'sea') onGround(seaLayer, groundTile(sea, box.x0, box.y0, CELL, CELL), box);
				else {
					onGround(bed, groundTile(bedTile(c, r), box.x0, box.y0, CELL, CELL), box);
					if (near) tintTile(c, r, tintOf(near));
				}
			}
			const tile = region(`grass_${compassTile(n, e, s, w)}`);
			onGround(grass, groundTile(tile, box.x0, box.y0, CELL, CELL), box);
			if (random() < TREE_CHANCE) tree(c, r, biomeTree(r));
		}
	const seaRow = Math.floor(river.sea.y / CELL);
	for (let r = -FOREST_DEPTH; r < rows + SEA_MARGIN; r++)
		for (let c = -SEA_MARGIN; c < cols + SEA_MARGIN; c++) {
			if (c >= 0 && c < cols && r >= 0 && r < rows) continue;
			const box = cellBox(c, r);
			if (r >= seaRow) onGround(seaLayer, groundTile(sea, box.x0, box.y0, CELL, CELL), box);
			else if (c >= -FOREST_DEPTH && c < cols + FOREST_DEPTH) tree(c, r, biomeTree(Math.max(0, r)));
		}

	for (const bank of river.sandbanks ?? []) {
		const across = Math.max(1, Math.round(bank.w / CELL));
		const down = Math.max(1, Math.round(bank.h / CELL));
		const w = bank.w / across;
		const h = bank.h / down;
		for (let j = 0; j < down; j++)
			for (let i = 0; i < across; i++) {
				const name = `sand_${compassTile(j > 0, i < across - 1, j < down - 1, i > 0)}`;
				const x = bank.x + i * w;
				const y = bank.y + j * h;
				onGround(sand, groundTile(region(name), x, y, w, h), {
					x0: x,
					y0: y,
					x1: x + w,
					y1: y + h,
				});
			}
	}

	const ticking: AnimatedSprite[] = [];
	const clip = (prefix: string, fps: number, frame = 0) => {
		const frames = [0, 1, 2, 3].map((i) => region(`${prefix}_${i}`));
		const sprite = new AnimatedSprite({ textures: frames, autoUpdate: false });
		sprite.animationSpeed = fps / 60;
		sprite.gotoAndPlay(frame % frames.length);
		ticking.push(sprite);
		return sprite;
	};
	const standUp = (view: Container, box: Box) => {
		upright.addChild(view);
		uprightCulled.push({ view, box });
	};
	const boxOf = (view: Container): Box => {
		const b = view.getLocalBounds();
		const sx = view.scale.x;
		const sy = view.scale.y;
		const xs = [view.x + b.minX * sx, view.x + b.maxX * sx];
		const ys = [view.y + b.minY * sy, view.y + b.maxY * sy];
		return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
	};

	const faces: TilingSprite[] = [];
	(river.waterfalls ?? []).forEach((fall) => {
		const band = river.bands.find((b) => b.y === fall.y + fall.h / 2) ?? river.bands[0];
		const x0 = band.left;
		const x1 = band.right;
		const face = new TilingSprite({ texture: art.face, width: x1 - x0, height: fall.h });
		face.position.set(x0, fall.y);
		face.tileScale.set(0.5, fall.h / art.face.height);
		face.alpha = 0.9;
		const mirrored = new TilingSprite({ texture: art.face, width: x1 - x0, height: fall.h });
		mirrored.position.set(x0, fall.y);
		mirrored.tileScale.set(-0.5, fall.h / art.face.height);
		mirrored.tilePosition.x = art.face.width / 2;
		mirrored.alpha = 0.45;
		const box = { x0, y0: fall.y, x1, y1: fall.y + fall.h };
		onGround(falls, face, box);
		onGround(falls, mirrored, box);
		faces.push(face, mirrored);
		used.set('waterfall_face', (used.get('waterfall_face') ?? 0) + 2);
		let i = 0;
		for (let x = x0 + CELL / 2; x < x1; x += CELL, i++) {
			const lip = clip('waterfall_lip', LIP_FPS, i);
			const top = project(x, fall.y);
			lip.anchor.set(0.5, 0.5);
			lip.scale.set(-K, K);
			lip.position.set(top.x, top.y);
			standUp(lip, boxOf(lip));
			const splash = clip('waterfall_splash', SPLASH_FPS, i);
			const foot = project(x, fall.y + fall.h);
			splash.anchor.set(0.5, 0.5);
			splash.scale.set(-K, K);
			splash.position.set(foot.x, foot.y);
			standUp(splash, boxOf(splash));
		}
	});

	river.whirlpools.forEach((pool, i) => {
		const sprite = clip('whirlpool', WHIRLPOOL_FPS, i);
		const at = project(pool.x, pool.y);
		const width = (WHIRLPOOL_W * pool.r) / 90;
		const scale = width / sprite.texture.width;
		sprite.anchor.set(0.5);
		sprite.scale.set(scale * (pool.spin === -1 ? -1 : 1), scale * 0.5);
		sprite.position.set(at.x, at.y);
		standUp(sprite, boxOf(sprite));
	});

	for (const rock of river.rocks ?? []) {
		const texture = region(`rock_${Math.floor(random() * 9)}`);
		const sprite = new Sprite(texture);
		const at = project(rock.x + rock.w / 2, rock.y + rock.h / 2);
		const scale = ((rock.w + rock.h) * 0.9) / texture.width;
		sprite.anchor.set(0.5);
		sprite.scale.set(random() < 0.5 ? -scale : scale, scale);
		sprite.position.set(at.x, at.y);
		standUp(sprite, boxOf(sprite));
	}

	trees.sort((a, b) => a.y - b.y);
	for (const { sprite } of trees) standUp(sprite, boxOf(sprite));

	let seen = '';
	const inverse = new Matrix();
	const cull = () => {
		const m = into.worldTransform;
		const screen = app.renderer.screen;
		const key = `${m.a},${m.d},${m.tx},${m.ty},${screen.width},${screen.height}`;
		if (key === seen) return;
		seen = key;
		inverse.copyFrom(m).invert();
		const pts = [
			[0, 0],
			[screen.width, 0],
			[0, screen.height],
			[screen.width, screen.height],
		].map(([x, y]) => inverse.apply({ x, y }));
		const view: Box = {
			x0: Math.min(...pts.map((p) => p.x)) - CULL_PAD,
			y0: Math.min(...pts.map((p) => p.y)) - CULL_PAD,
			x1: Math.max(...pts.map((p) => p.x)) + CULL_PAD,
			y1: Math.max(...pts.map((p) => p.y)) + CULL_PAD,
		};
		// The world box under the view: the projected corners turned back.
		const world = pts.map((p) => ({ x: p.y + p.x / 2, y: p.y - p.x / 2 }));
		const ground: Box = {
			x0: Math.min(...world.map((p) => p.x)) - CELL,
			y0: Math.min(...world.map((p) => p.y)) - CELL,
			x1: Math.max(...world.map((p) => p.x)) + CELL,
			y1: Math.max(...world.map((p) => p.y)) + CELL,
		};
		const show = (items: Culled[], b: Box) => {
			for (const { view: v, box } of items)
				v.visible = box.x1 >= b.x0 && box.x0 <= b.x1 && box.y1 >= b.y0 && box.y0 <= b.y1;
		};
		show(flatCulled, ground);
		show(uprightCulled, view);
	};

	const tick = (ticker: Ticker) => {
		const frames = ticker.deltaMS / (1000 / 60);
		displacement.x += 0.35 * frames;
		displacement.y += 0.18 * frames;
		for (let i = 0; i < faces.length; i += 2) {
			faces[i].tilePosition.y += 0.8 * frames;
			faces[i + 1].tilePosition.y += 0.45 * frames;
		}
		for (const sprite of ticking) if (sprite.visible) sprite.update(ticker);
		cull();
	};
	app.ticker.add(tick);
	cull();

	const roots = [floor, displacement, turn, upright];
	return {
		teardown: () => {
			app.ticker.remove(tick);
			bed.filters = [];
			filter.destroy();
			for (const root of roots) root.destroy({ children: true });
			for (const texture of made) texture.destroy(true);
		},
		regions: () => Object.fromEntries(used),
		destroyed: () => roots.every((root) => root.destroyed),
	};
}
