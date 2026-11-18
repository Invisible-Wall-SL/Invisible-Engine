import { createFixedStep } from 'engine-mechanics/src/motion.js';
import { createBody3d, type Motion3dSpec } from 'engine-mechanics/src/motion3d.js';
import {
	clampInput3d,
	createInterpolator3d,
	createPredictor3d,
	createSnapshotClock,
	levelOf3d,
	motionFor3d,
	moveFromStick,
	pitchFromRadians,
	snapFor3d,
	yawFromRadians,
	type Input3d,
	type Predictor3d,
	type World3d,
} from 'engine-mechanics/src/online3d.js';

import type { BodyView3d } from './play';
import { yawToward } from './rig';

/** One player as the 3D room's state carries it (`services/game-server` `Player3D`). */
export type RoomPlayer3d = {
	x: number;
	y: number;
	z: number;
	yaw: number;
	anim: number;
	ack: number;
	character: string;
};

/** The 3D room's state as the device reads it: the room's step and its players by session id. */
export type RoomState3d = {
	step?: number;
	players?: { forEach(each: (player: RoomPlayer3d, id: string) => void): void };
};

/** What the keys and the camera say this frame. */
export type Stick3d = { right: number; forward: number; buttons: number };

export type RoomView3d = {
	/** A state from the room: the own player reconciled, everyone else recorded at its step. */
	received(state: RoomState3d, nowMs: number): void;
	/**
	 * One frame of the game's clock: an input each fixed step the frame holds, predicted as it is
	 * sent (the camera turns the stick into world axes; `faceYaw`, uint16, overrides the facing;
	 * `aimPitchDeg`, up positive, is the aim the input carries — the first-person camera's).
	 */
	frame(
		dtMs: number,
		nowMs: number,
		stick: Stick3d,
		cameraYawDeg: number,
		faceYaw?: number,
		aimPitchDeg?: number,
	): void;
	/** Every player to draw: the own one predicted, the rest interpolated behind the room. */
	bodies(): BodyView3d[];
	/** The own player's predictor, once the room has shown the device its player. */
	readonly me: Predictor3d | undefined;
	/** Inputs sent so far. */
	readonly seq: number;
};

/**
 * The device's side of a 3D room (runtime step 4), with no transport: `send` is how an input leaves
 * (the seam hands it the Colyseus `room.input()`), `received` is fed the room's state. The own
 * player is predicted by `online3d` `createPredictor3d` from the first state that shows it — a
 * player is stepped only by an input, so that state is its home, exactly — at the room's `tickHz`;
 * everyone else is interpolated by `createInterpolator3d` about 100 ms behind
 * (`createSnapshotClock`). Pure, so `scripts/check-engine-3d-room.mjs` plays it against the room's
 * own simulation.
 */
export function createRoomView3d({
	meId,
	world,
	tickHz,
	patchHz,
	send,
}: {
	meId: string;
	world: World3d;
	tickHz: number;
	patchHz: number;
	send: (input: Input3d) => void;
}): RoomView3d {
	const level = levelOf3d(world);
	const clock = createFixedStep({ hz: tickHz });
	const view = createSnapshotClock({ stepMs: 1000 / tickHz });
	const fastest = [world.motion, ...Object.values(world.characters)].reduce((a, b) =>
		b.speed * b.sprint > a.speed * a.sprint ? b : a,
	);
	const others = createInterpolator3d({ snapM: snapFor3d(fastest, patchHz) });
	const specs = new Map<string, Motion3dSpec>();
	let me: Predictor3d | undefined;
	let seq = 0;
	let viewStep = 0;
	let ids: string[] = [];

	const specOf = (id: string, character: string) => {
		let spec = specs.get(id);
		if (!spec) {
			spec = motionFor3d(world, character);
			specs.set(id, spec);
		}
		return spec;
	};

	return {
		received(state, nowMs) {
			const { players, step } = state;
			if (!players || step === undefined) return;
			view.observe(step, nowMs);
			const seen = new Set<string>();
			players.forEach((player, id) => {
				seen.add(id);
				const spec = specOf(id, player.character);
				if (id !== meId) {
					others.push(id, step, {
						x: player.x,
						y: player.y,
						z: player.z,
						yaw: player.yaw,
						anim: player.anim,
					});
					return;
				}
				if (!me) {
					const home = { x: player.x, y: player.y, z: player.z, yaw: player.yaw };
					me = createPredictor3d({
						body: createBody3d(home),
						level,
						spec,
						dt: clock.dt,
						home,
						snapM: snapFor3d(spec, patchHz),
					});
				}
				if (player.ack > 0)
					me.reconcile({ x: player.x, y: player.y, z: player.z, ack: player.ack, step });
			});
			others.retain(seen);
			for (const id of specs.keys()) if (!seen.has(id)) specs.delete(id);
			ids = [...seen];
		},
		frame(dtMs, nowMs, stick, cameraYawDeg, faceYaw, aimPitchDeg = 0) {
			viewStep = view.advance(nowMs) ?? viewStep;
			const own = me;
			if (!own) return;
			const cameraYaw = yawFromRadians((cameraYawDeg * Math.PI) / 180);
			const pitch = pitchFromRadians((aimPitchDeg * Math.PI) / 180);
			clock.advance(dtMs, () => {
				seq += 1;
				const { moveX, moveZ } = moveFromStick(stick.right, stick.forward, cameraYaw);
				const facing = faceYaw ?? (moveX || moveZ ? yawToward(moveX, moveZ) : own.body.yaw);
				const input = clampInput3d({
					seq,
					moveX,
					moveZ,
					buttons: stick.buttons,
					yaw: facing,
					pitch,
					view: Math.max(0, Math.floor(viewStep)),
				});
				send(input);
				own.input(input);
			});
			own.frame(dtMs);
		},
		bodies() {
			const out: BodyView3d[] = [];
			for (const id of ids) {
				const spec = specs.get(id);
				if (!spec) continue;
				if (id === meId) {
					if (!me) continue;
					const at = me.drawn(clock.alpha);
					out.push({
						id,
						...at,
						vx: me.body.vx,
						vz: me.body.vz,
						radius: spec.radius,
						height: spec.height,
						kind: 'hero',
					});
					continue;
				}
				const at = others.at(id, viewStep);
				if (!at) continue;
				out.push({
					id,
					x: at.x,
					y: at.y,
					z: at.z,
					yaw: at.yaw,
					vx: 0,
					vz: 0,
					radius: spec.radius,
					height: spec.height,
					kind: 'other',
				});
			}
			return out;
		},
		get me() {
			return me;
		},
		get seq() {
			return seq;
		},
	};
}
