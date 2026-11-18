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
	snapFor3d,
	STATUS3D,
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
	/** `STATUS3D`: a dead player (Crash) is held still by the room and not drawn. */
	status?: number;
};

/** A room event as the view reads it: only a `knockback` of the own player matters to it. */
export type RoomEvent3d = {
	type: string;
	id?: string;
	seq?: number;
	vx?: number;
	vy?: number;
	vz?: number;
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
	/** The room's events (`ONLINE_EVENT`): a knockback of the own player is applied at its input. */
	events(events: readonly RoomEvent3d[]): void;
	/**
	 * One frame of the game's clock: an input each fixed step the frame holds, predicted as it is
	 * sent (the camera turns the stick into world axes; `faceYaw`, uint16, overrides the facing).
	 */
	frame(dtMs: number, nowMs: number, stick: Stick3d, cameraYawDeg: number, faceYaw?: number): void;
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
 * own simulation. With rules that kill a fall (Crash, `fallRespawns: false`) the prediction does not
 * take the fold's trip home; a dead player is reconciled as `still` and not drawn.
 */
export function createRoomView3d({
	meId,
	world,
	tickHz,
	patchHz,
	send,
	fallRespawns = true,
}: {
	meId: string;
	world: World3d;
	tickHz: number;
	patchHz: number;
	send: (input: Input3d) => void;
	fallRespawns?: boolean;
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
	const dead = new Set<string>();

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
			dead.clear();
			players.forEach((player, id) => {
				seen.add(id);
				if (player.status === STATUS3D.dead) dead.add(id);
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
						fallRespawns,
					});
				}
				if (player.ack > 0)
					me.reconcile({
						x: player.x,
						y: player.y,
						z: player.z,
						ack: player.ack,
						step,
						still: player.status === STATUS3D.dead,
					});
			});
			others.retain(seen);
			for (const id of specs.keys()) if (!seen.has(id)) specs.delete(id);
			ids = [...seen];
		},
		events(events) {
			for (const event of events)
				if (event.type === 'knockback' && event.id === meId && me && event.seq !== undefined)
					me.impulse(event.seq, { vx: event.vx ?? 0, vy: event.vy ?? 0, vz: event.vz ?? 0 });
		},
		frame(dtMs, nowMs, stick, cameraYawDeg, faceYaw) {
			viewStep = view.advance(nowMs) ?? viewStep;
			const own = me;
			if (!own) return;
			const cameraYaw = yawFromRadians((cameraYawDeg * Math.PI) / 180);
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
					pitch: 0,
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
				if (!spec || dead.has(id)) continue;
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
