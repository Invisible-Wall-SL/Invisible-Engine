import { createCamera, stepCamera } from 'engine-mechanics/src/camera.js';

import type { BodyView3d } from './play';
import type { Rig3d, Vec3 } from './rig';

/**
 * The 3D camera's target, from the arcade camera (`camera.js`): the same dead zone, smoothing and
 * look-ahead, in metres on the ground plane (its x / y are the level's x / z). `camera.js` holds a
 * view rectangle by its top-left and caps the dead zone at the view, so the view here is the dead
 * zone itself and the target is its centre. Height eases on its own with the same smoothing, so a
 * jump lifts the view a little after the body.
 */
export function createFollow3d(rig: Rig3d): {
	step(dtMs: number, body: BodyView3d): Vec3;
} {
	const camera = createCamera(
		{
			smoothing: rig.smoothing,
			lookAhead: rig.lookAhead,
			deadZone: rig.deadZone,
			clampToWorld: false,
		},
		Math.random,
	);
	const view = rig.deadZone;
	let y: number | undefined;
	return {
		step(dtMs, body) {
			const dt = dtMs / 1000;
			stepCamera(camera, dt, {
				view,
				target: { x: body.x, y: body.z, vx: body.vx, vy: body.vz },
			});
			const aimY = body.y + rig.aimHeight;
			const ease = y === undefined || rig.smoothing <= 0 ? 1 : 1 - Math.exp(-dt / rig.smoothing);
			y = y === undefined ? aimY : y + (aimY - y) * ease;
			return { x: camera.x + view.w / 2, y, z: camera.y + view.h / 2 };
		},
	};
}
