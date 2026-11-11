/**
 * Offline fixture: a kept `<Sprite>` handed another texture and box ends exactly where a new one
 * made for that texture would (the claim a pooled reel view relies on when it rebinds a sprite
 * symbol instead of mounting a new one, `apps/lines/src/game/reelViewPool.ts`).
 *
 *   pnpm check:all --only spriteRebind
 *
 * `<BaseSprite>` makes `new Sprite(texture)` and then assigns every defined prop, in the order
 * `<Sprite>` spreads them: the caller's `x`/`y`/`anchor`/`width`/`height` (the contain-fit box
 * overriding the last two), then `texture`. So a rebind sets the new box while the OLD texture is
 * still on the sprite and swaps the texture last; Pixi's `texture` setter re-applies the stored
 * width/height against the new frame, which is the same arithmetic a new sprite does once.
 */
import { Rectangle, Sprite, Texture, TextureSource } from 'pixi.js';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

const source = new TextureSource({ width: 2048, height: 2048 });
const frame = (
	x: number,
	y: number,
	w: number,
	h: number,
	extra: { orig?: Rectangle; trim?: Rectangle; defaultAnchor?: { x: number; y: number } } = {},
) => new Texture({ source, frame: new Rectangle(x, y, w, h), ...extra });

/** `<Sprite contain>`'s box for a texture: one uniform factor fitting it inside the cell. */
const containBox = (texture: Texture, boxW: number, boxH: number) => {
	const s = Math.min(boxW / texture.width, boxH / texture.height);
	return { width: texture.width * s, height: texture.height * s };
};

/** `<BaseSprite>`'s prop sync: every defined prop, in the spread's key order. */
const sync = (sprite: Sprite, texture: Texture, box: { width: number; height: number }): void => {
	sprite.anchor = 0.5;
	sprite.width = box.width;
	sprite.height = box.height;
	sprite.texture = texture;
};

const mounted = (texture: Texture, cell: number) => {
	const sprite = new Sprite(texture);
	sync(sprite, texture, containBox(texture, cell, cell));
	return sprite;
};

const pose = (sprite: Sprite) => {
	const b = sprite.getLocalBounds();
	return {
		texture: sprite.texture.uid,
		scale: [sprite.scale.x, sprite.scale.y],
		anchor: [sprite.anchor.x, sprite.anchor.y],
		position: [sprite.x, sprite.y],
		size: [sprite.width, sprite.height],
		bounds: [b.minX, b.minY, b.maxX, b.maxY],
		matrix: (() => {
			sprite.updateLocalTransform();
			const m = sprite.localTransform;
			return [m.a, m.b, m.c, m.d, m.tx, m.ty];
		})(),
	};
};

const CELL = 180;
const textures = {
	square: frame(0, 0, 256, 256),
	tall: frame(300, 0, 200, 311),
	wide: frame(600, 0, 377, 190),
	tiny: frame(1000, 0, 37, 53),
	trimmed: frame(1100, 0, 120, 140, {
		orig: new Rectangle(0, 0, 160, 180),
		trim: new Rectangle(20, 25, 120, 140),
	}),
	anchored: frame(1300, 0, 210, 240, { defaultAnchor: { x: 0.2, y: 0.9 } }),
};
const names = Object.keys(textures) as (keyof typeof textures)[];

console.log('a kept sprite handed the next cell matches a sprite made for it');
for (const from of names) {
	for (const to of names) {
		const kept = mounted(textures[from], CELL);
		sync(kept, textures[to], containBox(textures[to], CELL, CELL));
		check(`${from} → ${to}`, pose(kept), pose(mounted(textures[to], CELL)));
	}
}

console.log('a view handed cell after cell lands where a new view would, every time');
{
	const sequence = [
		'tall',
		'wide',
		'wide',
		'anchored',
		'trimmed',
		'tiny',
		'square',
		'tall',
	] as const;
	const kept = mounted(textures[sequence[0]], CELL);
	const poses: unknown[] = [];
	const fresh: unknown[] = [];
	for (const name of sequence) {
		sync(kept, textures[name], containBox(textures[name], CELL, CELL));
		poses.push(pose(kept));
		fresh.push(pose(mounted(textures[name], CELL)));
	}
	check('eight cells in a row', poses, fresh);
}

console.log('a different cell size rebinds the same way');
{
	const kept = mounted(textures.wide, 140);
	sync(kept, textures.tall, containBox(textures.tall, 220, 160));
	const fresh = new Sprite(textures.tall);
	sync(fresh, textures.tall, containBox(textures.tall, 220, 160));
	check('wide in 140 → tall in 220×160', pose(kept), pose(fresh));
}

if (failures) throw new Error(`spriteRebind.fixture: ${failures} FAILED`);
console.log('\nspriteRebind.fixture: all ok');
