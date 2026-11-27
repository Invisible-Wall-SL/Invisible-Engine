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
import {
	SALMONS_BIOMES,
	SALMONS_BIOME_CYCLE,
	biomeAt,
	biomeStretches,
	type SalmonsBiome,
	type SalmonsBiomes,
} from 'engine-mechanics';
import { sceneryArtSourceFor, type ZoneArtSource, type ZoneStamp } from 'game-config';

import { spawnPropsOf } from '../arcadeProps.svelte';
import { projectedLayer } from '../worldDrawing.svelte';
import { ISO_DEPTH_SPREAD, ISO_PROJECTOR, isoDepth, type IsoProjector } from '../projection';
import { SALMONS_FIELD_LAYER, type SalmonsRiverDrawing } from '../referenceLayouts/salmonsRiver';
import { riverElevation } from '../referenceLayouts/salmonsElevation';
import type { ZoneRig } from '../zoneArtRig';
import type { SalmonsTextures } from './load';
import { compassTile } from './regions';
import { drawPropPiece, type DrawnPropNode } from './propDraw';
import { seededRandom } from './random';
import { CELL, K } from './scale';
import { TINT_ALPHA, tintOf, wetAt, type Wet } from './water';
import { zoneFrames, type RiverZoneArt, type ZoneFrames } from './zoneArt';

/**
 * SALMONS' RIVER IN ITS ORIGINAL ART: the river a room's seed made (`engine-mechanics`
 * `salmonsRiver`), drawn as the old client (`GuiltyForever/Salmon-` `client/game.js`) drew its
 * own, inside the same shapes the placeholder rectangles drew. The old client laid a 64 × 32
 * diamond grid; here a CELL of 48 world px is drawn as a 96 × 48 diamond, so every size of the old
 * client is scaled by {@link K}.
 *
 * Drawn by the screen's projector (`projection.ts`): Salmons' screen is `mirrored`, so the source
 * is top-left and the sea bottom-right as in the original, and every texture keeps the original's
 * orientation. Ground (painted diamonds: the grass and sand autotiles, the riverbed, the tint, the
 * sea) is drawn in the flat world under the projector's ground turn; upright things (rocks,
 * whirlpools, trees, the waterfalls' lips and splashes, the bridges' pillars and slopes) at their
 * projected places, in
 * the old client's z order. Per row, as the old client: grass only within 5 cells of the water,
 * then a forest wall of a tree on every cell 6 to 17 cells out on both sides (following the
 * meander), the forest floor beyond, 12 rows of forest past the source and the sea, and sandy
 * beaches in the last 80 columns (a river on the original's grid; P10.16's band river keeps its
 * grass world with a forest round it). The forest trees stand in front of a character at the same
 * depth (the old client's `+1001` over a player's `+1000`), so they are drawn among the players, in
 * the projected world's spawn layer. The bridges are prop components (`propDraw.ts`): their water
 * and behind pieces are drawn here from what the arcade runtime published, their deck cells among
 * the players by `<SpawnProps>`. Everything upstream of a
 * waterfall is raised by its step (`referenceLayouts/salmonsElevation.ts`): a raised piece of
 * ground is drawn at its world place less its lift on both axes, which the turn makes straight up,
 * and an upright thing that much higher. Under each waterfall's lip a cliff of `cliff.png` and the
 * falling water stand on its line, behind the ground at its foot. Animated parts tick on the app's
 * ticker. Only what the view holds is drawn (each piece is culled by its box).
 *
 * ZONE ART (`zoneArt.ts`, Game Config `arcade.zoneArt`): a rock or a whirlpool whose zone has a
 * stamp is drawn with the stamp's picture in the built-in one's place, at its size times the
 * stamp's scale; any other stamp stands upright on its zone, fitted inside it. A rig picture is
 * one `RigView` per piece (`zoneArtRig.ts`, handed in by the runtime), its box standing for the
 * picture's, started at its zone's phase and moved on by this ticker while it is in view. With
 * the trees' art (`@trees`, never a rig), every scattered and forest tree draws one of its
 * pictures in place of `tree_N`, a tree's width times its scale, on its foot: by the seed and the
 * tree's cell, or, on a level with authored biomes, the picture of the variant its biome picked
 * (variant `v` draws picture `v` of the source and its variants, round again past the last), so a
 * biome's `trees` choose among the authored pictures as they choose among `tree_0`…`tree_5`.
 * Every other piece, and every seeded choice, is as without it.
 */

/** The families whose built-in piece a stamp replaces; any other family's stamp is drawn too. */
const REPLACED_FAMILIES = ['rock#', 'whirlpool#'];
/** The probe's count of the trees drawn with the trees' art (`regions()`). */
const TREE_ART = 'zoneArt:@trees';

/**
 * BIOMES (`engine-mechanics` `salmonsBiomes.js`): each row of the river is drawn by the biome of its
 * column, with that biome's trees, lone-tree chance, grass strip (the old client's `bankMargin` 5),
 * forest wall past it (the old client's `FOREST_DEPTH` 12), grass tint, floor and riverbed. A river
 * whose level has no biomes block is drawn by the original's six, in turn every 35 columns.
 */
const ORIGINAL_BIOMES: SalmonsBiomes = {
	kinds: SALMONS_BIOMES,
	cycle: SALMONS_BIOME_CYCLE,
};
const UNTINTED = '#ffffff';
const colour = (hex: string) => parseInt(hex.slice(1), 16);
/** The last cell out of a biome's forest wall (17, the original's). */
const forestTo = (kind: SalmonsBiome) => kind.grass + kind.forest;
const TREE_W = 96 * K;
/** Rows of forest past the source and past the sea's margin (the old client's end caps). */
const FOREST_CAP = 12;
/** P10.16's band river (not the original's grid): cells of forest round its grass world. */
const EDGE_FOREST = 4;
/** How far the sea runs on past the world, cells: the view at the sea sees past its corners. */
const SEA_MARGIN = 14;
/** The beaches (the old client's `sandPeakU = riverLength − 4`, `sandFadeLen = 80`). */
const SAND_PEAK_BEFORE_SEA = 4;
const SAND_FADE_ROWS = 80;
/** The old client's whirlpool, drawn 230 px wide, at K, for the engine's pool of r 90. */
const WHIRLPOOL_W = 230.4 * K;
const WHIRLPOOL_FPS = 9;
const LIP_FPS = 3.6;
const SPLASH_FPS = 4.8;
/** The old client's sizes, old px: a rock's width, a lip, a splash. */
const ROCK_W = 119.5;
const LIP = { w: 64, h: 24 };
const SPLASH = { w: 64, h: 32 };
const SPLASHES = 3;
/** The old client's z offsets over a piece's screen y (old px), in ground depth (`x + y` world
 *  px: an old px of screen y is 3 of them): a player's is `+1000`. */
const Z = {
	whirlpool: -50,
	lip: 50,
	splash: 100,
	rock: 300,
	tree: 500,
	forest: 1001,
	player: 1000,
};
const DEPTH_PER_OLD_PX = CELL / 16;

type Box = { x0: number; y0: number; x1: number; y1: number };
type Culled = { view: Container; box: Box };
/** A zone's stamp and what draws it: its loaded frames, or its rig. */
type Stamped = { stamp: ZoneStamp } & (
	{ frames: ZoneFrames; rig?: undefined } | { rig: ZoneRig; frames?: undefined }
);
/** An upright piece centred on its place (a sprite anchored at its middle, or a rig), and its own
 *  size, px. */
type Piece = { view: Container; w: number; h: number };

/** A ground texture drawn over the world rectangle (x, y, w, h), in the flat frame: its diamond
 *  turned back to the square the projection turns into it, mirrored back by `flip` (the ground
 *  turn's, so the texture keeps its own orientation on screen). */
function groundTile(
	texture: Texture,
	x: number,
	y: number,
	w: number,
	h: number,
	flip: 1 | -1,
): Container {
	const sprite = new Sprite(texture);
	sprite.anchor.set(0.5);
	sprite.rotation = -Math.PI / 4;
	if (w === h) {
		sprite.position.set(x + w / 2, y + h / 2);
		sprite.scale.set((flip * Math.SQRT2 * w) / texture.width, (Math.SQRT2 * h) / texture.height);
		return sprite;
	}
	const box = new Container();
	box.position.set(x + w / 2, y + h / 2);
	box.scale.set(w, h);
	sprite.scale.set((flip * Math.SQRT2) / texture.width, Math.SQRT2 / texture.height);
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

/** The old client's riverbed variant `seed` (0–8) in one of `sands`: a sandy diamond with its
 *  pebbles. */
function riverbedTexture(app: Application, seed: number, sands: readonly string[]): Texture {
	return diamondTexture(app, (g) => {
		const w = 64;
		const h = 32;
		diamond(g).fill(colour(sands[seed % sands.length]));
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

/** A river drawn: its teardown, the pieces drawn with a Salmons texture by region, and whether
 *  everything it made is destroyed (the probe's). */
export type RiverArt = {
	teardown: () => void;
	regions: () => Record<string, number>;
	destroyed: () => boolean;
	/** How many pieces stand among the players now (the forest trees), and whether they
	 *  found the spawn layer they stand in (the probe's). */
	among: () => { drawn: number; layer: boolean };
	/** Move what stands on the water (the bridges' reflections, the upright pieces) over whatever
	 *  was added to the river's container since (what is under the surface: the bloodstains). */
	aboveWater: () => void;
};

/** How far past the view a piece is still drawn, px: a tree's height, so nothing pops in at the
 *  view's edge (the view is read a frame behind the camera). */
const CULL_PAD = TREE_W * 1.5;

/** A piece that stands among the players: made the first time it is in view, then kept. */
type Among = {
	make: () => Container;
	view?: Container;
	box: Box;
	z: number;
	at: { x: number; y: number };
};

/**
 * The container the players' spawn layer draws its instances in: under the layer's own container
 * `<IsoWorld>` registers by its id (`worldDrawing.svelte.ts` `projectedLayer`, Salmons'
 * {@link SALMONS_FIELD_LAYER}), down `<LayoutNodeView>`'s wrappers (each a lone child placed by the
 * node, below ground depth) to the one whose children are the instances (zIndex in ground-depth
 * order, `isoDepthOrder`, from {@link ISO_DEPTH_SPREAD}) or that has none yet.
 */
export function spawnLayerOf(id: string): Container | undefined {
	let at = projectedLayer(id);
	while (at && at.children.length === 1) {
		const only = at.children[0];
		if (only.label === AMONG || only.zIndex >= ISO_DEPTH_SPREAD) break;
		at = only;
	}
	return at;
}

const AMONG = 'salmons-art:among';

/**
 * Draw `river` into `into` (at the projected origin of its world screen) with `art`, by
 * `projector` (the screen's); returns its teardown and its probes. `seed` keeps the trees, rocks
 * and bed the same on every device of a room.
 */
export function mountSalmonsRiver(
	into: Container,
	app: Application,
	art: SalmonsTextures,
	river: SalmonsRiverDrawing,
	seed: number | string,
	projector: IsoProjector = ISO_PROJECTOR,
	zoneArt?: RiverZoneArt,
): RiverArt {
	const { project, unproject } = projector;
	const flip = projector.ground.flip;
	const random = seededRandom(`salmons-art:${seed}`);
	const forestRandom = seededRandom(`salmons-forest:${seed}`);
	const made: Texture[] = [];
	const own = (texture: Texture) => (made.push(texture), texture);
	const biomes = river.biomes ?? ORIGINAL_BIOMES;
	const bedSets = new Map<string, Texture[]>();
	/** A biome's riverbed tiles, one per sand: made once per set of sands. */
	const bedsOf = (kind: SalmonsBiome) => {
		const key = kind.riverbed.join();
		let set = bedSets.get(key);
		if (!set) {
			set = kind.riverbed.map((_, i) => own(riverbedTexture(app, i, kind.riverbed)));
			bedSets.set(key, set);
		}
		return set;
	};
	const sea = own(seaTexture(app));
	const noise = own(displacementTexture());
	const used = new Map<string, number>();
	const region = (name: string) => {
		used.set(name, (used.get(name) ?? 0) + 1);
		return art.region(name);
	};
	const stamps = zoneArt?.stamps ?? [];
	const byZone = new Map(stamps.map((s) => [s.zone, s]));
	const trees = zoneArt?.trees;
	const assets = stamps.length || trees ? zoneArt?.assets() : undefined;
	/** The rig pictures drawn: each moves on with the river's ticker while it is in view. */
	const rigs: ZoneRig[] = [];
	/** `source` drawn as a rig from `phase` of its animation; none for another kind, a rig not
	 *  loaded, or a river given no rig drawing. */
	const rigOf = (source: ZoneArtSource, phase: number) => {
		const rig = source.kind === 'rig' ? zoneArt?.rig?.(source, phase) : undefined;
		if (rig) rigs.push(rig);
		return rig;
	};
	/** A zone's stamp and what draws it, its loaded frames or its rig; none ⇒ the built-in piece. */
	const stampOf = (zone: string): Stamped | undefined => {
		const stamp = byZone.get(zone);
		if (!stamp) return undefined;
		const rig = rigOf(stamp.source, stamp.phase ?? 0);
		const frames = rig ? undefined : zoneFrames(stamp.source, assets);
		const own: Stamped | undefined = rig ? { stamp, rig } : frames && { stamp, frames };
		if (own) used.set(`zoneArt:${stamp.family}`, (used.get(`zoneArt:${stamp.family}`) ?? 0) + 1);
		return own;
	};
	const ticking: AnimatedSprite[] = [];
	const animate = (frames: Texture[], fps: number, frame = 0) => {
		const sprite = new AnimatedSprite({ textures: frames, autoUpdate: false });
		sprite.animationSpeed = fps / 60;
		sprite.gotoAndPlay(((Math.floor(frame) % frames.length) + frames.length) % frames.length);
		ticking.push(sprite);
		return sprite;
	};
	const clip = (prefix: string, fps: number, frame = 0) =>
		animate(
			[0, 1, 2, 3].map((i) => region(`${prefix}_${i}`)),
			fps,
			frame,
		);
	/** A stamp's picture: a sprite of a sheet's frame, a clip's frames played on the ticker. */
	const pictureOf = ({ textures, fps }: ZoneFrames, frame = 0): Sprite =>
		textures.length > 1 ? animate(textures, fps, frame) : new Sprite(textures[0]);
	/** A sprite as an upright piece centred on its place, its texture's size. */
	const centred = (sprite: Sprite): Piece => {
		sprite.anchor.set(0.5);
		return { view: sprite, w: sprite.texture.width, h: sprite.texture.height };
	};
	/** A stamp's picture as an upright piece centred on its place: its frames' sprite (a clip's
	 *  starting at `frame`), or its rig, measured as the rig's box. */
	const pieceOf = (own: Stamped, frame = 0): Piece =>
		own.rig
			? { view: own.rig.view, w: own.rig.w, h: own.rig.h }
			: centred(pictureOf(own.frames, frame));
	const treeFrames = new Map<ZoneArtSource, ZoneFrames | undefined>();
	const treePictures = trees ? [trees.source, ...(trees.variants ?? [])] : [];
	/** The trees' picture the tree of `variant` on cell (c, r) draws, its frames loaded; none ⇒
	 *  `tree_N`. Authored biomes pick it by the variant, else the seed and the cell do. */
	const treeArtOf = (c: number, r: number, variant: number) => {
		if (!trees) return undefined;
		const source = river.biomes
			? treePictures[variant % treePictures.length]
			: sceneryArtSourceFor(trees, c, r, seed);
		if (!treeFrames.has(source)) treeFrames.set(source, zoneFrames(source, assets));
		const frames = treeFrames.get(source);
		return frames && { frames, scale: trees.scale ?? 1 };
	};

	const cols = Math.ceil(river.world.w / CELL);
	const rows = Math.ceil(river.world.h / CELL);
	const seaRow = Math.floor(river.sea.y / CELL);
	const sourceRows = river.grid?.sourceRows ?? Math.round((river.source.y + river.source.h) / CELL);
	const gyMin = river.grid?.gyMin ?? 0;
	const wetCell = (c: number, r: number): Wet | undefined =>
		c < 0 || c >= cols || r < 0
			? r * CELL >= river.sea.y
				? 'sea'
				: undefined
			: wetAt(river, (c + 0.5) * CELL, (r + 0.5) * CELL);
	/** A row's water, cells (`lo` to `hi`): its band's, the source's for the rows above the river. */
	const spanOf = (r: number) => {
		const y = (r + 0.5) * CELL;
		const band =
			river.bands.find((b) => y >= b.y && y < b.y + b.h) ??
			(y < (river.bands[0]?.y ?? 0) ? river.bands[0] : river.bands[river.bands.length - 1]);
		return band
			? { lo: Math.round(band.left / CELL), hi: Math.round(band.right / CELL) - 1 }
			: { lo: 0, hi: cols - 1 };
	};
	/** How many cells of beach a row has past its water (the old client's `isBankAt`): 0 but in the
	 *  last {@link SAND_FADE_ROWS} columns of a river on the original's grid. */
	const riverRows = seaRow - sourceRows;
	const beachOf = (r: number) => {
		const gx = r - sourceRows;
		if (!river.grid || gx < 0 || gx >= riverRows) return 0;
		const peak = riverRows - SAND_PEAK_BEFORE_SEA;
		const t = Math.max(0, Math.min(1, (gx - (peak - SAND_FADE_ROWS)) / SAND_FADE_ROWS));
		const depth = Math.round(Math.sqrt(t) * 5);
		return depth >= 2 ? depth : 0;
	};

	// An autotile's art names its sides by the screen (`n` its up-right edge, `e` down-right, `s`
	// down-left, `w` up-left, as the old client drew them): each world neighbour is read on the side
	// the projector draws it.
	const sides = [
		[0, -1],
		[1, 0],
		[0, 1],
		[-1, 0],
	].map(([dc, dr]) => {
		const at = project(dc, dr);
		const side = at.x > 0 ? (at.y < 0 ? 0 : 1) : at.y > 0 ? 2 : 3;
		return { dc, dr, side };
	});
	const compass = (same: (dc: number, dr: number) => boolean) => {
		const by = [false, false, false, false];
		for (const { dc, dr, side } of sides) by[side] = same(dc, dr);
		return compassTile(by[0], by[1], by[2], by[3]);
	};

	/** The biome a row of the world is drawn by: its river column's (`gx` is the row less the rows
	 *  above the source). */
	const kindOf = (r: number) => biomeAt(biomes, r - sourceRows);
	const deepest = Math.max(...biomes.kinds.map(forestTo));
	const elevation = riverElevation(river.waterfalls);
	const floor = new Graphics();
	const out = SEA_MARGIN + FOREST_CAP + deepest;
	const corners = [
		project(-out * CELL, -out * CELL),
		project(river.world.w + out * CELL, river.world.h + out * CELL),
		project(river.world.w + out * CELL, -out * CELL),
		project(-out * CELL, river.world.h + out * CELL),
	];
	const fx0 = Math.min(...corners.map((p) => p.x));
	const fy0 = Math.min(...corners.map((p) => p.y)) - elevation.total;
	floor
		.rect(
			fx0,
			fy0,
			Math.max(...corners.map((p) => p.x)) - fx0,
			Math.max(...corners.map((p) => p.y)) - fy0,
		)
		.fill(colour(kindOf(0).forestFloor));

	const turn = new Container();
	turn.scale.set(1, 0.5);
	const flat = new Container();
	flat.rotation = projector.ground.rotation;
	flat.scale.set(flip * Math.SQRT2, Math.SQRT2);
	turn.addChild(flat);
	const bed = new Container();
	const seaLayer = new Container();
	const tint = new Container();
	const grass = new Container();
	const sand = new Container();
	// An authored river's floor, biome by biome, under everything else on the ground.
	const floors = river.biomes ? new Container() : undefined;
	if (floors) flat.addChild(floors);
	flat.addChild(bed, seaLayer, tint, grass, sand);
	const cliffs = new Container();
	const reflections = new Container();
	const upright = new Container();
	const displacement = new Sprite(noise);
	displacement.alpha = 0;
	const filter = new DisplacementFilter({ sprite: displacement, scale: { x: 6, y: 4 } });
	bed.filters = [filter];
	into.addChild(floor, displacement, cliffs, turn, reflections, upright);

	const flatCulled: Culled[] = [];
	const uprightCulled: Culled[] = [];
	const among: Among[] = [];
	const cellBox = (c: number, r: number): Box => ({
		x0: c * CELL,
		y0: r * CELL,
		x1: (c + 1) * CELL,
		y1: (r + 1) * CELL,
	});
	/** Each ground layer's raised parts, by lift: a container moved back by it on both axes. */
	const raised = new Map<Container, Map<number, Container>>();
	const liftedIn = (layer: Container, lift: number) => {
		if (!lift) return layer;
		let byLift = raised.get(layer);
		if (!byLift) raised.set(layer, (byLift = new Map()));
		let part = byLift.get(lift);
		if (!part) {
			part = new Container();
			part.position.set(-lift, -lift);
			layer.addChild(part);
			byLift.set(lift, part);
		}
		return part;
	};
	const onGround = (layer: Container, view: Container, box: Box) => {
		const lift = elevation.at(box.y0);
		liftedIn(layer, lift).addChild(view);
		flatCulled.push({
			view,
			box: { x0: box.x0 - lift, y0: box.y0 - lift, x1: box.x1 - lift, y1: box.y1 - lift },
		});
	};
	const tile = (layer: Container, texture: Texture, c: number, r: number, tinted = UNTINTED) => {
		const box = cellBox(c, r);
		const view = groundTile(texture, box.x0, box.y0, CELL, CELL, flip);
		if (tinted !== UNTINTED) view.tint = colour(tinted);
		onGround(layer, view, box);
	};
	// An authored river's floor, biome by biome: a strip of each stretch's floor across the world
	// and the forest's reach past it, cut at each waterfall's line and raised with the ground.
	if (floors) {
		const first = -FOREST_CAP - sourceRows;
		const last = rows + SEA_MARGIN + FOREST_CAP - sourceRows;
		const stretches = biomeStretches(biomes, first, last);
		const lines = elevation.steps.map((s) => s.line);
		stretches.forEach(({ from, to, kind }, i) => {
			const y0 = i === 0 ? -out * CELL : (from + sourceRows) * CELL;
			const y1 = i === stretches.length - 1 ? river.world.h + out * CELL : (to + sourceRows) * CELL;
			const cuts = [y0, ...lines.filter((l) => l > y0 && l < y1).sort((a, b) => a - b), y1];
			for (let k = 1; k < cuts.length; k++) {
				const strip = new Graphics()
					.rect(-out * CELL, cuts[k - 1], river.world.w + 2 * out * CELL, cuts[k] - cuts[k - 1])
					.fill(colour(kind.forestFloor));
				liftedIn(floors, elevation.at(cuts[k - 1])).addChild(strip);
			}
		});
	}
	/** A world point's projected place, raised with the ground under it. */
	const placed = (x: number, y: number) => {
		const at = project(x, y);
		return { x: at.x, y: at.y - elevation.at(y) };
	};
	/** The old client's z of a piece at world (x, y), `offset` old px over its screen y. */
	const zOf = (x: number, y: number, offset: number) => isoDepth(x, y) + offset * DEPTH_PER_OLD_PX;
	const bedTile = (c: number, r: number) => {
		const beds = bedsOf(kindOf(r));
		return beds[((Math.imul(c, 73856093) ^ Math.imul(r, 19349663)) >>> 0) % beds.length];
	};
	const tintTile = (c: number, r: number, color: number) => {
		const square = new Sprite(Texture.WHITE);
		square.position.set(c * CELL, r * CELL);
		square.width = CELL;
		square.height = CELL;
		square.tint = color;
		square.alpha = TINT_ALPHA;
		onGround(tint, square, cellBox(c, r));
	};
	const water = (c: number, r: number, wet: Wet) => {
		if (wet === 'sea') return tile(seaLayer, sea, c, r);
		tile(bed, bedTile(c, r), c, r);
		tintTile(c, r, tintOf(wet));
	};
	/** One of a biome's trees, by a draw of `rng` (of two, below a half the first). */
	const treeOf = (r: number, rng: () => number) => {
		const { trees } = kindOf(r);
		return trees[Math.floor(rng() * trees.length)];
	};
	const treeSprite = (c: number, r: number, variant: number) => {
		const own = treeArtOf(c, r, variant);
		if (own) used.set(TREE_ART, (used.get(TREE_ART) ?? 0) + 1);
		const texture = own ? own.frames.textures[0] : region(`tree_${variant}`);
		// A clip's neighbouring trees start on different frames.
		const sprite = own ? pictureOf(own.frames, c * 3 + r * 5) : new Sprite(texture);
		const at = project((c + 0.5) * CELL, (r + 0.5) * CELL);
		sprite.anchor.set(0.5, 1);
		sprite.scale.set((TREE_W * (own?.scale ?? 1)) / texture.width);
		sprite.position.set(at.x, at.y + CELL / 4 - elevation.at(r * CELL));
		return sprite;
	};
	const scatteredTree = (c: number, r: number) => {
		const sprite = treeSprite(c, r, treeOf(r, random));
		sprite.zIndex = zOf((c + 0.5) * CELL, (r + 0.5) * CELL, Z.tree);
		standUp(sprite, boxOf(sprite));
	};
	/** A forest tree: in front of a player at its depth, so it stands among the players. */
	const forestTree = (c: number, r: number) => {
		const variant = treeOf(r, forestRandom);
		const x = (c + 0.5) * CELL;
		const y = (r + 0.5) * CELL;
		const at = project(x, y);
		const lift = elevation.at(r * CELL);
		const own = treeArtOf(c, r, variant);
		const w = TREE_W * (own?.scale ?? 1);
		const texture = own?.frames.textures[0];
		const h = texture ? (w * texture.height) / texture.width : TREE_W * 1.5;
		const half = w / 2;
		among.push({
			make: () => treeSprite(c, r, variant),
			box: {
				x0: at.x - half,
				y0: at.y + CELL / 4 - lift - h,
				x1: at.x + half,
				y1: at.y + CELL / 4 - lift,
			},
			z: amongZ(x, y, Z.forest),
			at: { x: at.x, y: at.y + CELL / 4 - lift },
		});
	};
	/** A piece among the players drawn in ground-depth order (`isoDepthOrder`): over every player
	 *  whose depth is less than its old z (`offset`) less a player's. */
	const amongZ = (x: number, y: number, offset: number) =>
		(Math.floor(isoDepth(x, y)) + Math.ceil((offset - Z.player) * DEPTH_PER_OLD_PX)) *
		ISO_DEPTH_SPREAD;

	// The original's levels (on its grid) are walled by the meander-following forest; P10.16's band
	// river keeps its grass world, a forest of EDGE_FOREST cells round it.
	const walled = !!river.grid;
	/** How a dry cell of row `r` is drawn: by how far it is from the water (`out`, cells). */
	const dryKind = (c: number, r: number, lo: number, hi: number, beach: number) => {
		if (!walled)
			return c >= 0 && c < cols
				? 'grass'
				: c >= -EDGE_FOREST && c < cols + EDGE_FOREST
					? 'forest'
					: 'floor';
		const kind = kindOf(r);
		const out = c < lo ? lo - c : c > hi ? c - hi : 0;
		if (out > kind.grass) return out <= forestTo(kind) ? 'forest' : 'floor';
		if (beach && out <= beach) return 'beach';
		return out <= kind.grass ? 'grass' : 'floor';
	};
	for (let r = 0; r < seaRow; r++) {
		const { lo, hi } = spanOf(r);
		const beach = beachOf(r);
		const biome = kindOf(r);
		const from = walled ? lo - forestTo(biome) : -EDGE_FOREST;
		const to = walled ? hi + forestTo(biome) : cols - 1 + EDGE_FOREST;
		for (let c = from; c <= to; c++) {
			const wet = wetCell(c, r);
			if (wet) {
				water(c, r, wet);
				continue;
			}
			const kind = dryKind(c, r, lo, hi, beach);
			if (kind === 'forest') forestTree(c, r);
			if (kind !== 'grass' && kind !== 'beach') continue;
			const dry = (dc: number, dr: number) => !wetCell(c + dc, r + dr);
			const near = wetCell(c, r - 1) ?? wetCell(c + 1, r) ?? wetCell(c, r + 1) ?? wetCell(c - 1, r);
			if (kind === 'beach') {
				// A beach: the riverbed and the tint under a sand tile, as the old client's.
				water(c, r, near === 'sea' ? 'sea' : (near ?? 'water'));
				tile(sand, region(`sand_${compass(dry)}`), c, r);
				continue;
			}
			// Under the shore's cut-out water: the water it meets.
			if (near) water(c, r, near);
			tile(grass, region(`grass_${compass(dry)}`), c, r, biome.grassTint);
			if (random() < biome.treeChance) scatteredTree(c, r);
		}
	}
	for (let r = seaRow; r < rows + SEA_MARGIN; r++)
		for (let c = -SEA_MARGIN; c < cols + SEA_MARGIN; c++) tile(seaLayer, sea, c, r);
	// The forest's end caps: past the source, and (walled) past the sea's margin.
	const top = spanOf(0);
	const cap = walled ? FOREST_CAP : EDGE_FOREST;
	for (let r = -cap; r < 0; r++) {
		const reach = forestTo(kindOf(r));
		for (
			let c = walled ? top.lo - reach : -EDGE_FOREST;
			c <= (walled ? top.hi + reach : cols - 1 + EDGE_FOREST);
			c++
		)
			forestTree(c, r);
	}
	if (walled)
		for (let r = rows + SEA_MARGIN; r < rows + SEA_MARGIN + FOREST_CAP; r++)
			for (let c = -SEA_MARGIN; c < cols + SEA_MARGIN; c++) forestTree(c, r);

	// Sand on the cell grid (the original's islands, one rect per run of a row) is tiled against its
	// neighbouring cells, so an island reads as one; any other sandbank is tiled as its own patch.
	const onGrid = !!river.grid;
	const sandCells = new Set<string>();
	for (const bank of river.sandbanks ?? [])
		if (onGrid)
			for (let y = bank.y; y < bank.y + bank.h; y += CELL)
				for (let x = bank.x; x < bank.x + bank.w; x += CELL) sandCells.add(`${x},${y}`);
	const sandAt = (x: number, y: number) => sandCells.has(`${x},${y}`);
	for (const cell of sandCells) {
		const [x, y] = cell.split(',').map(Number);
		const name = `sand_${compass((dc, dr) => sandAt(x + dc * CELL, y + dr * CELL))}`;
		onGround(sand, groundTile(region(name), x, y, CELL, CELL, flip), {
			x0: x,
			y0: y,
			x1: x + CELL,
			y1: y + CELL,
		});
	}
	for (const bank of river.sandbanks ?? []) {
		if (onGrid) continue;
		const across = Math.max(1, Math.round(bank.w / CELL));
		const down = Math.max(1, Math.round(bank.h / CELL));
		const w = bank.w / across;
		const h = bank.h / down;
		for (let j = 0; j < down; j++)
			for (let i = 0; i < across; i++) {
				const name = `sand_${compass((di, dj) => i + di >= 0 && i + di < across && j + dj >= 0 && j + dj < down)}`;
				const x = bank.x + i * w;
				const y = bank.y + j * h;
				onGround(sand, groundTile(region(name), x, y, w, h, flip), {
					x0: x,
					y0: y,
					x1: x + w,
					y1: y + h,
				});
			}
	}

	function standUp(view: Container, box: Box) {
		upright.addChild(view);
		uprightCulled.push({ view, box });
	}
	function boxOf(view: Container): Box {
		const b = view.getLocalBounds();
		const sx = view.scale.x;
		const sy = view.scale.y;
		const xs = [view.x + b.minX * sx, view.x + b.maxX * sx];
		const ys = [view.y + b.minY * sy, view.y + b.maxY * sy];
		return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
	}

	// A waterfall's cliff and face stand on its line as the old client's (`SKEW_Y = −atan(1/2)`):
	// from the line's left end on screen, a local px one screen px along the line.
	const ALONG = Math.sqrt(5) / 2;
	const along = (x0: number, x1: number, line: number, top: number) => {
		const at = project(projector.mirrored ? x1 : x0, line);
		const view = new Container();
		const slope = projector.mirrored ? -1 : 1;
		view.setFromMatrix(new Matrix(1 / ALONG, slope / (2 * ALONG), 0, 1, at.x, at.y - top));
		return { view, length: (x1 - x0) * ALONG };
	};
	const alongBox = (x0: number, x1: number, line: number, top: number, h: number): Box => {
		const a = project(x0, line);
		const b = project(x1, line);
		return {
			x0: Math.min(a.x, b.x),
			y0: Math.min(a.y, b.y) - top,
			x1: Math.max(a.x, b.x),
			y1: Math.max(a.y, b.y) - top + h,
		};
	};
	const behind = (view: Container, box: Box) => {
		cliffs.addChild(view);
		uprightCulled.push({ view, box });
	};
	const faces: TilingSprite[] = [];
	(river.waterfalls ?? []).forEach((fall) => {
		const line = fall.y + fall.h / 2;
		const step = elevation.steps.find((s) => s.line === line);
		if (!step) return;
		const r = Math.round(line / CELL);
		const { lo, hi } = spanOf(r);
		const x0 = lo * CELL;
		const x1 = (hi + 1) * CELL;
		// The cliff: the face and the forest's reach each side (17 cells), one texture high.
		const reach = forestTo(kindOf(r));
		const c0 = x0 - (reach + 0.5) * CELL;
		const c1 = x1 + (reach + 0.5) * CELL;
		const cliff = along(c0, c1, line, step.top);
		const rock = new TilingSprite({ texture: art.cliff, width: cliff.length, height: step.cliff });
		rock.tileScale.set(step.cliff / art.cliff.height);
		cliff.view.addChild(rock);
		used.set('cliff', (used.get('cliff') ?? 0) + 1);
		behind(cliff.view, alongBox(c0, c1, line, step.top, step.cliff));

		// The falling water: one cell past each end of the water, two layers at the texture's size.
		const f0 = x0 - CELL / 2;
		const f1 = x1 + CELL / 2;
		const face = along(f0, f1, line, step.top);
		const sheet = new TilingSprite({ texture: art.face, width: face.length, height: step.cliff });
		sheet.tileScale.set(K);
		sheet.alpha = 0.9;
		const mirrored = new TilingSprite({
			texture: art.face,
			width: face.length,
			height: step.cliff,
		});
		mirrored.tileScale.set(-K, K);
		mirrored.tilePosition.x = art.face.width / 2;
		mirrored.alpha = 0.45;
		face.view.addChild(sheet, mirrored);
		behind(face.view, alongBox(f0, f1, line, step.top, step.cliff));
		faces.push(sheet, mirrored);
		used.set('waterfall_face', (used.get('waterfall_face') ?? 0) + 2);

		const gx = r - sourceRows;
		// The lips and the splashes, per cell as the old client's: a lip's frame by the cell, three
		// splashes at hashed offsets (two more past the up-river end on screen's right).
		const splashAt = (c: number, p: number, phase: number) => {
			const gy = c + gyMin;
			const h = ((gx * 73856093) ^ (gy * 19349663) ^ (p * 83492791)) >>> 0;
			const rx = ((h & 0xff) / 255 - 0.5) * 36 * K;
			const ry = (((h >> 8) & 0xff) / 255 - 0.5) * 16 * K;
			const x = (c + 0.5) * CELL;
			const splash = clip('waterfall_splash', SPLASH_FPS, (phase + p * 1.3) % 4);
			const foot = placed(x, fall.y + fall.h);
			splash.anchor.set(0.5);
			splash.scale.set(
				(-flip * SPLASH.w * K) / splash.texture.width,
				(SPLASH.h * K) / splash.texture.height,
			);
			splash.position.set(foot.x + rx, foot.y + ry);
			splash.zIndex = zOf(x, line, Z.splash + p);
			standUp(splash, boxOf(splash));
		};
		const phaseOf = (c: number) => (((gx - (c + gyMin)) % 4) + 4) % 4;
		for (let c = lo; c <= hi; c++) {
			const x = (c + 0.5) * CELL;
			const phase = phaseOf(c);
			const lip = clip('waterfall_lip', LIP_FPS, phase);
			const at = placed(x, fall.y);
			lip.anchor.set(0.5, 1);
			lip.scale.set((-flip * LIP.w * K) / lip.texture.width, (LIP.h * K) / lip.texture.height);
			lip.position.set(at.x, at.y + (LIP.h * K) / 2);
			lip.zIndex = zOf(x, line, Z.lip);
			standUp(lip, boxOf(lip));
			for (let p = 0; p < SPLASHES; p++) splashAt(c, p, phase);
		}
		const cap = projector.mirrored ? lo - 1 : hi + 1;
		for (let p = 0; p < 2; p++) splashAt(cap, p, phaseOf(cap));
	});

	// A whirlpool, a rock or another stamp drawn with a rig is the built-in piece's place and size
	// (or the zone's), the rig's box standing for the picture's.
	river.whirlpools.forEach((pool, i) => {
		const own = stampOf(`whirlpool${i}`);
		const { view, w } = own ? pieceOf(own, i) : centred(clip('whirlpool', WHIRLPOOL_FPS, i));
		const at = placed(pool.x, pool.y);
		const width = ((WHIRLPOOL_W * pool.r) / 90) * (own?.stamp.scale ?? 1);
		const scale = width / w;
		view.scale.set(scale * (pool.spin === -1 ? -1 : 1), scale * 0.5);
		view.position.set(at.x, at.y);
		view.zIndex = zOf(pool.x, pool.y, Z.whirlpool);
		standUp(view, boxOf(view));
	});

	(river.rocks ?? []).forEach((rock, i) => {
		// Both of a rock's seeded choices are drawn whatever draws it, so every piece after it is
		// the same with or without zone art.
		const variant = Math.floor(random() * 9);
		const flipped = random() < 0.5;
		const own = stampOf(`rock${i}`);
		const { view, w } = own ? pieceOf(own) : centred(new Sprite(region(`rock_${variant}`)));
		const x = rock.x + rock.w / 2;
		const y = rock.y + rock.h / 2;
		const at = placed(x, y);
		const scale = (ROCK_W * K * (own?.stamp.scale ?? 1)) / w;
		view.scale.set(flipped ? -scale : scale, scale);
		view.position.set(at.x, at.y);
		view.zIndex = zOf(x, y, Z.rock);
		standUp(view, boxOf(view));
	});

	// Every other stamp, upright on its zone's centre, fitted inside the zone's box.
	for (const { zone, family } of stamps) {
		if (REPLACED_FAMILIES.includes(family)) continue;
		const own = stampOf(zone);
		if (!own) continue;
		const { stamp } = own;
		const { view, w, h } = pieceOf(own);
		const x = stamp.x + stamp.w / 2;
		const y = stamp.y + stamp.h / 2;
		const at = placed(x, y);
		view.scale.set(Math.min(stamp.w / w, stamp.h / h));
		view.position.set(at.x, at.y);
		view.zIndex = zOf(x, y, Z.rock);
		standUp(view, boxOf(view));
	}

	// The bridges: the `water` and `behind` pieces of the props the arcade runtime published for
	// the field's layer (`arcadeProps.svelte.ts`; the seed `bridgeProp`, placed by
	// `propPlacement.ts`), drawn in the river's own layers. Their `sorted` pieces (the deck cells)
	// stand among the players, drawn by `<SpawnProps>`.
	// A piece's painted art (a sprite's region, a clip) is drawn as a zone's picture is.
	const propPictures = (source: ZoneArtSource) => {
		const frames = zoneFrames(source, zoneArt?.assets());
		return frames ? pictureOf(frames) : undefined;
	};
	const swaying: DrawnPropNode[] = [];
	for (const piece of spawnPropsOf(SALMONS_FIELD_LAYER)) {
		if (piece.band !== 'water' && piece.band !== 'behind') continue;
		for (const node of drawPropPiece(piece, project, propPictures)) {
			if (piece.band === 'water') {
				reflections.addChild(node.view);
				uprightCulled.push({ view: node.view, box: boxOf(node.view) });
				if (node.play) swaying.push(node);
			} else {
				node.view.zIndex = (piece as { zIndex?: number }).zIndex ?? 0;
				standUp(node.view, boxOf(node.view));
			}
		}
	}

	// Sorted once by the old client's z; nothing in it moves (a zIndex turns sorting on per frame).
	upright.sortChildren();
	upright.sortableChildren = false;

	let layer: Container | undefined;
	let layerShift = { x: 0, y: 0 };
	let amongDrawn = 0;
	const findLayer = () => {
		const now = spawnLayerOf(SALMONS_FIELD_LAYER);
		if (now === layer && (!now || !now.destroyed)) return layer;
		amongDrawn = 0;
		for (const piece of among) if (piece.view?.parent) piece.view.removeFromParent();
		layer = now && !now.destroyed ? now : undefined;
		if (layer) layerShift = layer.toLocal({ x: 0, y: 0 }, into);
		return layer;
	};

	let seen = '';
	const inverse = new Matrix();
	let viewBox: Box = { x0: 0, y0: 0, x1: 0, y1: 0 };
	const cull = () => {
		const m = into.worldTransform;
		const screen = app.renderer.screen;
		const key = `${m.a},${m.b},${m.c},${m.d},${m.tx},${m.ty},${screen.width},${screen.height}`;
		if (key === seen) return false;
		seen = key;
		inverse.copyFrom(m).invert();
		const pts = [
			[0, 0],
			[screen.width, 0],
			[0, screen.height],
			[screen.width, screen.height],
		].map(([x, y]) => inverse.apply({ x, y }));
		viewBox = {
			x0: Math.min(...pts.map((p) => p.x)) - CULL_PAD,
			y0: Math.min(...pts.map((p) => p.y)) - CULL_PAD,
			x1: Math.max(...pts.map((p) => p.x)) + CULL_PAD,
			y1: Math.max(...pts.map((p) => p.y)) + CULL_PAD,
		};
		// The world box under the view: the projected corners turned back.
		const world = pts.map((p) => unproject(p.x, p.y));
		const ground: Box = {
			x0: Math.min(...world.map((p) => p.x)) - CELL,
			y0: Math.min(...world.map((p) => p.y)) - CELL,
			x1: Math.max(...world.map((p) => p.x)) + CELL,
			y1: Math.max(...world.map((p) => p.y)) + CELL,
		};
		const show = (items: Culled[], b: Box) => {
			for (const { view: v, box } of items) v.visible = meets(box, b);
		};
		show(flatCulled, ground);
		show(uprightCulled, viewBox);
		return true;
	};
	/** The pieces among the players in view, in the spawn layer; the rest out of it. */
	const placeAmong = (moved: boolean) => {
		const had = layer;
		const target = findLayer();
		if (!target) return;
		if (!moved && had === target) return;
		amongDrawn = 0;
		for (const piece of among) {
			const show = meets(piece.box, viewBox);
			if (show) {
				if (!piece.view) {
					piece.view = piece.make();
					piece.view.label = AMONG;
					piece.view.zIndex = piece.z;
				}
				piece.view.position.set(piece.at.x + layerShift.x, piece.at.y + layerShift.y);
				if (piece.view.parent !== target) target.addChild(piece.view);
				amongDrawn += 1;
			} else if (piece.view?.parent) piece.view.removeFromParent();
		}
	};

	let frame = 0;
	const tick = (ticker: Ticker) => {
		const frames = ticker.deltaMS / (1000 / 60);
		frame += frames;
		displacement.x += 0.35 * frames;
		displacement.y += 0.18 * frames;
		for (let i = 0; i < faces.length; i += 2) {
			faces[i].tilePosition.y += 0.8 * frames;
			faces[i + 1].tilePosition.y += 0.45 * frames;
		}
		for (const sprite of ticking) if (sprite.visible && sprite.parent) sprite.update(ticker);
		for (const rig of rigs) if (rig.view.visible && rig.view.parent) rig.update(ticker.deltaMS);
		for (const node of swaying) if (node.view.visible) node.play?.(frame / 60);
		placeAmong(cull());
	};
	app.ticker.add(tick);
	placeAmong(cull());

	const roots = [floor, displacement, cliffs, turn, reflections, upright];
	return {
		teardown: () => {
			app.ticker.remove(tick);
			bed.filters = [];
			filter.destroy();
			for (const rig of rigs) rig.destroy();
			for (const piece of among) piece.view?.destroy();
			for (const root of roots) root.destroy({ children: true });
			for (const texture of made) texture.destroy(true);
		},
		regions: () => Object.fromEntries(used),
		destroyed: () => roots.every((root) => root.destroyed),
		among: () => ({ drawn: amongDrawn, layer: !!layer }),
		aboveWater: () => {
			into.addChild(reflections, upright);
		},
	};
}

const meets = (a: Box, b: Box) => a.x1 >= b.x0 && a.x0 <= b.x1 && a.y1 >= b.y0 && a.y0 <= b.y1;
