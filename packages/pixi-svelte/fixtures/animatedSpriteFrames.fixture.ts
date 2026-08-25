/**
 * Repro fixture for "the flipbook renders a still frame".
 *
 * Models the real chain around the extracted decision (`framesChanged`, imported from source): a
 * `<Flipbook>` derives its texture array from the clip + `loadedAssets`, `<AnimatedSprite>` decides
 * whether that array is genuinely new, and PIXI's `textures` setter — modelled faithfully below —
 * STOPS and rewinds playback whenever it is assigned.
 *
 * The bug this pins: `propsSyncEffect` re-assigns EVERY prop whenever ANY tracked prop changes, so
 * one unrelated change (alpha, x, a resize) re-assigned `textures` and froze the animation on frame
 * 0 forever — while `playing` looked fine to any code that only checked `play`. Confirmed live on
 * `test6`: 160 frames resolved, `playing:false, currentFrame:0`.
 *
 * Run: node --experimental-strip-types packages/pixi-svelte/fixtures/animatedSpriteFrames.fixture.ts
 */
import assert from 'node:assert/strict';

import { framesChanged } from '../src/lib/animatedSpriteFrames.ts';

type Texture = { id: string };

/** The part of `PIXI.AnimatedSprite` that decides whether a clip is animating. Faithful to v8:
 *  the `textures` setter ends in `gotoAndStop(0)`, which is the whole reason this bug exists. */
class FakeAnimatedSprite {
	_textures: Texture[];
	playing = false;
	currentTime = 0;

	constructor(textures: Texture[]) {
		this._textures = textures;
	}
	set textures(value: Texture[]) {
		this._textures = value;
		this.gotoAndStop(0); // ← PIXI does exactly this
	}
	get textures(): Texture[] {
		return this._textures;
	}
	gotoAndPlay(frame: number): void {
		this.currentTime = frame;
		this.playing = true;
	}
	gotoAndStop(frame: number): void {
		this.currentTime = frame;
		this.playing = false;
	}
	/** One ticker step at 12fps-ish. */
	tick(): void {
		if (this.playing) this.currentTime += 0.2;
	}
	get currentFrame(): number {
		return Math.floor(this.currentTime) % this._textures.length;
	}
}

/** `<AnimatedSprite>` as it now behaves: `textures` assigned only on a REAL change, playback
 *  carried across it; every other prop synced freely. */
function createSprite(initial: Texture[]) {
	const sprite = new FakeAnimatedSprite(initial);
	let applied: Texture[] | undefined = initial;
	return {
		sprite,
		/** One reactive pass: `propsSyncEffect` re-runs for ANY prop, then the textures effect. */
		syncProps(next: Texture[]): void {
			if (!framesChanged(applied, next)) return;
			const resume = sprite.playing;
			applied = next;
			sprite.textures = next;
			if (resume) sprite.gotoAndPlay(0);
		},
	};
}

/** What `<Flipbook>`'s `$derived` does — rebuild the array from the same clip. New identity, same
 *  contents. This happens on every recompute, which is what made the old code fatal. */
const deriveTextures = (frames: Texture[]): Texture[] => frames.map((f) => f);

const FRAMES: Texture[] = Array.from({ length: 160 }, (_, i) => ({ id: `frame_${i}` }));

let failures = 0;
const check = (name: string, fn: () => void): void => {
	try {
		fn();
		console.log(`  ✓ ${name}`);
	} catch (err) {
		failures++;
		console.error(`  ✗ ${name}\n      ${(err as Error).message.split('\n')[0]}`);
	}
};

console.log('animated sprite frames — a rebuilt-but-identical array must not stop playback');

check('an unrelated prop change leaves the clip PLAYING (the still-frame bug)', () => {
	const { sprite, syncProps } = createSprite(FRAMES);
	sprite.gotoAndPlay(0);
	for (let i = 0; i < 30; i++) sprite.tick();
	const before = sprite.currentFrame;
	assert.ok(before > 0, 'precondition: the clip advanced before the prop change');

	// alpha changed → propsSyncEffect re-runs → <Flipbook> re-derives its textures array
	syncProps(deriveTextures(FRAMES));

	assert.equal(sprite.playing, true, 'still playing after an unrelated prop change');
	for (let i = 0; i < 30; i++) sprite.tick();
	assert.ok(sprite.currentFrame > 0, 'and it keeps advancing');
});

check('the OLD behaviour is reproduced when the array is assigned unconditionally', () => {
	const sprite = new FakeAnimatedSprite(FRAMES);
	sprite.gotoAndPlay(0);
	for (let i = 0; i < 30; i++) sprite.tick();
	sprite.textures = deriveTextures(FRAMES); // what propsSyncEffect used to do
	assert.equal(sprite.playing, false, 'the old path stops playback');
	for (let i = 0; i < 60; i++) sprite.tick();
	assert.equal(sprite.currentFrame, 0, 'and it is stuck on frame 0 forever — the still frame');
});

check('a GENUINELY new frame list is applied, and playback carries across it', () => {
	const { sprite, syncProps } = createSprite(FRAMES);
	sprite.gotoAndPlay(0);
	for (let i = 0; i < 30; i++) sprite.tick();
	const other = FRAMES.slice(0, 40);
	syncProps(other);
	assert.equal(sprite.textures.length, 40, 'the new list is applied');
	assert.equal(sprite.playing, true, 'and it resumes rather than stopping');
});

check('a STOPPED sprite is not silently started by a frame-list change', () => {
	const { sprite, syncProps } = createSprite(FRAMES);
	sprite.gotoAndStop(0);
	syncProps(FRAMES.slice(0, 10));
	assert.equal(sprite.playing, false, 'a paused clip stays paused');
});

console.log('animated sprite frames — the decision itself');
check('same reference is not a change', () => assert.equal(framesChanged(FRAMES, FRAMES), false));
check('same contents, new array is not a change', () =>
	assert.equal(framesChanged(FRAMES, deriveTextures(FRAMES)), false),
);
check('a different length IS a change', () =>
	assert.equal(framesChanged(FRAMES, FRAMES.slice(0, 159)), true),
);
check('a reordered list IS a change', () => {
	const swapped = deriveTextures(FRAMES);
	[swapped[0], swapped[1]] = [swapped[1], swapped[0]];
	assert.equal(framesChanged(FRAMES, swapped), true);
});
check('an undefined previous list IS a change (first assign)', () =>
	assert.equal(framesChanged(undefined, FRAMES), true),
);
check('two empty lists are not a change', () => assert.equal(framesChanged([], []), false));

console.log('');
if (failures > 0) {
	console.error(`ANIMATED SPRITE FRAMES: ${failures} FAILURE(S)`);
	process.exit(1);
}
console.log('ANIMATED SPRITE FRAMES: PASSED');
