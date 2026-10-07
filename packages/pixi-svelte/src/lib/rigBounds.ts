import * as RIG from 'engine-rig/pixi';

/**
 * Natural bounds of a skeleton, with a FALLBACK for rigs exported WITHOUT skeleton
 * width/height (a degenerate setup pose — art driven entirely by animations, so rig
 * writes no `skeleton.width/height`). Such a rig otherwise has no natural size, so it
 * pins its pivot to the origin and can't be sized by an authored width/height. Here we
 * synthesize the size by sampling the FIRST animation across its duration and taking the
 * max extent (the art's full reveal), then cache it per `SkeletonData`.
 *
 * Returns `{0,0}` if it can't be measured (no animations), so every
 * caller transparently keeps its prior behaviour. Fully guarded — never throws.
 */
const cache = new WeakMap<RIG.SkeletonData, { width: number; height: number }>();

export function rigNaturalBounds(data: RIG.SkeletonData): {
	width: number;
	height: number;
} {
	if (data.width > 0 && data.height > 0) return { width: data.width, height: data.height };
	const hit = cache.get(data);
	if (hit) return hit;

	let result = { width: 0, height: 0 };
	try {
		const probe = new RIG.RigView(data);
		const anims = data.animations;
		if (anims && anims.length) {
			const anim = anims[0];
			let maxW = 0;
			let maxH = 0;
			const off = new RIG.Vector2();
			const size = new RIG.Vector2();
			for (const t of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
				probe.skeleton.setToSetupPose();
				probe.state.setAnimation(0, anim.name, false);
				probe.state.update(anim.duration * t);
				probe.state.apply(probe.skeleton);
				probe.skeleton.updateWorldTransform(RIG.Physics.update);
				probe.skeleton.getBounds(off, size, []);
				if (size.x > maxW) maxW = size.x;
				if (size.y > maxH) maxH = size.y;
			}
			if (maxW > 0 && maxH > 0) result = { width: maxW, height: maxH };
		}
		probe.destroy();
	} catch {
		/* measurement unavailable — caller keeps prior behaviour */
	}

	cache.set(data, result);
	return result;
}
