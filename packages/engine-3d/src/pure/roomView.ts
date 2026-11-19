import { createFixedStep } from 'engine-mechanics/src/motion.js';
import { createBody3d, type Motion3dSpec } from 'engine-mechanics/src/motion3d.js';
import {
	ANIM3D,
	CATCH_UP_SECONDS_3D,
	bodyOfWire3d,
	clampInput3d,
	createClockSync3d,
	createInterpolator3d,
	createPredictor3d,
	createSnapshotClock,
	levelOf3d,
	motionFor3d,
	moveFromStick,
	pitchFromRadians,
	snapFor3d,
	STATUS3D,
	worldHash3d,
	yawFromRadians,
	type BodyWire3d,
	type Input3d,
	type Predictor3d,
	type World3d,
} from 'engine-mechanics/src/online3d.js';

import type { BodyView3d } from './play';
import { yawToward } from './rig';

/** One player as the 3D room's state carries it (`services/game-server` `Player3D`); the own
 *  player also carries its `ack`, its whole body ({@link BodyWire3d}) and its clock. */
export type RoomPlayer3d = Partial<BodyWire3d> & {
	x: number;
	y: number;
	z: number;
	yaw: number;
	anim: number;
	character: string;
	ack?: number;
	waiting?: number;
	credit?: number;
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

/** The 3D room's state as the device reads it: the room's step, its world's fingerprint and its
 *  players by session id. */
export type RoomState3d = {
	step?: number;
	world?: number;
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
	/** The room plays another world than this device's (`worldHash3d`): it predicts nothing, and
	 *  the game must not go on in this room. */
	readonly mismatch: boolean;
};

/**
 * The device's side of a 3D room (runtime step 4), with no transport: `send` is how an input leaves
 * (the seam hands it the Colyseus `room.input()`), `received` is fed the room's state. The own
 * player is predicted by `online3d` `createPredictor3d` from the first state that shows it — a
 * player is stepped only by an input, so that state is its home, exactly — at the room's `tickHz`,
 * and reconciled with the whole body the room sends its own device; the input clock follows the
 * room's (`createClockSync3d`: now and then an input skipped or added, judged only while the device
 * steps), and a long frame sends every step up to `CATCH_UP_SECONDS_3D` at once. Everyone else is
 * interpolated by `createInterpolator3d` about 100 ms behind (`createSnapshotClock`). A room whose
 * world is not this device's (`RoomState3D.world`) is not played: {@link RoomView3d.mismatch}.
 * With rules that kill a fall (Crash, `fallRespawns: false`) the prediction does not take the
 * fold's trip home; a dead player is reconciled as `still` and not drawn. Pure, so
 * `scripts/check-engine-3d-room.mjs` plays it against the room's own simulation.
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
	/** The most inputs one frame sends: what the room waits for (a longer hitch it rests through). */
	const catchUp = Math.ceil(tickHz * CATCH_UP_SECONDS_3D);
	const clock = createFixedStep({ hz: tickHz, maxSteps: catchUp });
	const view = createSnapshotClock({ stepMs: 1000 / tickHz });
	const fastest = [world.motion, ...Object.values(world.characters)].reduce((a, b) =>
		b.speed * b.sprint > a.speed * a.sprint ? b : a,
	);
	const others = createInterpolator3d({ snapM: snapFor3d(fastest, patchHz) });
	const sync = createClockSync3d({ states: patchHz });
	const fingerprint = worldHash3d(world, tickHz);
	const specs = new Map<string, Motion3dSpec>();
	const characters = new Map<string, string>();
	let me: Predictor3d | undefined;
	let seq = 0;
	let viewStep = 0;
	let ids: string[] = [];
	let mismatch = false;
	/** Inputs to skip (below 0: the device runs ahead) or to add (above 0: it runs behind). */
	let nudge = 0;
	/** When the device last sent an input, ms: a state after a longer gap (a hidden tab) says
	 *  nothing about its clock. */
	let sentAt = -Infinity;
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
			if (state.world !== undefined && state.world !== fingerprint) mismatch = true;
			if (mismatch || !players || step === undefined) return;
			view.observe(step, nowMs);
			const seen = new Set<string>();
			dead.clear();
			players.forEach((player, id) => {
				seen.add(id);
				characters.set(id, player.character);
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
				if (player.bx === undefined || player.by === undefined || player.bz === undefined) return;
				if (!me) {
					const home = { x: player.bx, y: player.by, z: player.bz, yaw: player.yaw };
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
				const ack = player.ack ?? 0;
				if (ack > 0)
					me.reconcile({
						ack,
						step,
						body: bodyOfWire3d(player as BodyWire3d),
						still: player.status === STATUS3D.dead,
					});
				if (nowMs - sentAt > 1000 * CATCH_UP_SECONDS_3D) sync.reset();
				else {
					const more = nudge + sync.observe(player.waiting ?? 0, player.credit ?? 0);
					nudge = Math.max(-catchUp, Math.min(catchUp, more));
				}
			});
			others.retain(seen);
			for (const id of specs.keys()) if (!seen.has(id)) specs.delete(id);
			for (const id of characters.keys()) if (!seen.has(id)) characters.delete(id);
			ids = [...seen];
		},
		events(events) {
			for (const event of events)
				if (event.type === 'knockback' && event.id === meId && me && event.seq !== undefined)
					me.impulse(event.seq, { vx: event.vx ?? 0, vy: event.vy ?? 0, vz: event.vz ?? 0 });
		},
		frame(dtMs, nowMs, stick, cameraYawDeg, faceYaw, aimPitchDeg = 0) {
			viewStep = view.advance(nowMs) ?? viewStep;
			const own = me;
			if (!own || mismatch) return;
			const cameraYaw = yawFromRadians((cameraYawDeg * Math.PI) / 180);
			const pitch = pitchFromRadians((aimPitchDeg * Math.PI) / 180);
			const step = (extra: boolean) => {
				seq += 1;
				sentAt = nowMs;
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
				own.input(input, extra);
			};
			clock.advance(dtMs, () => {
				if (nudge < 0) {
					nudge += 1;
					return;
				}
				step(false);
				if (nudge > 0) {
					nudge -= 1;
					step(true);
				}
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
						character: characters.get(id),
						grounded: me.body.grounded,
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
					character: characters.get(id),
					grounded: (at.anim & ANIM3D.grounded) !== 0,
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
		get mismatch() {
			return mismatch;
		},
	};
}
