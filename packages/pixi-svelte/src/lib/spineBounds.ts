import * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';

/**
 * Natural bounds of a skeleton, with a FALLBACK for spines exported WITHOUT skeleton
 * width/height (a degenerate setup pose — art driven entirely by animations, so Spine
 * writes no `skeleton.width/height`). Such a spine otherwise has no natural size, so it
 * pins its pivot to the origin and can't be sized by an authored width/height. Here we
 * synthesize the size by sampling the FIRST animation across its duration and taking the
 * max extent (the art's full reveal), then cache it per `SkeletonData`.
 *
 * Returns `{0,0}` if it can't be measured (no animations / runtime API mismatch), so every
 * caller transparently keeps its prior behaviour. Fully guarded — never throws.
 */
const cache = new WeakMap<SPINE_PIXI.SkeletonData, { width: number; height: number }>();

export function spineNaturalBounds(data: SPINE_PIXI.SkeletonData): {
	width: number;
	height: number;
} {
	if (data.width > 0 && data.height > 0) return { width: data.width, height: data.height };
	const hit = cache.get(data);
	if (hit) return hit;

	let result = { width: 0, height: 0 };
	try {
		const probe = new SPINE_PIXI.Spine(data);
		const anims = data.animations;
		if (anims && anims.length) {
			const physics = (SPINE_PIXI as unknown as { Physics?: { update?: unknown } }).Physics?.update;
			const anim = anims[0];
			let maxW = 0;
			let maxH = 0;
			for (const t of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
				probe.skeleton.setToSetupPose();
				probe.state.setAnimation(0, anim.name, false);
				probe.state.update(anim.duration * t);
				probe.state.apply(probe.skeleton);
				(probe.skeleton.updateWorldTransform as (p?: unknown) => void)(physics);
				const off = {
					x: 0,
					y: 0,
					set(x: number, y: number) {
						this.x = x;
						this.y = y;
					},
				};
				const size = {
					x: 0,
					y: 0,
					set(x: number, y: number) {
						this.x = x;
						this.y = y;
					},
				};
				(probe.skeleton.getBounds as (o: unknown, s: unknown, t: unknown[]) => void)(off, size, []);
				if (size.x > maxW) maxW = size.x;
				if (size.y > maxH) maxH = size.y;
			}
			if (maxW > 0 && maxH > 0) result = { width: maxW, height: maxH };
		}
		(probe as unknown as { destroy?: () => void }).destroy?.();
	} catch {
		/* measurement unavailable — caller keeps prior behaviour */
	}

	cache.set(data, result);
	return result;
}
