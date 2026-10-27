import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * The wire (`docs/design/realtime-multiplayer.md` §5).
 *
 * {@link Input} is the ONLY thing a device sends. It is flat and typed, so a field it does not
 * declare cannot arrive; it has no position, hit or score to claim. `engine-mechanics`
 * `sanitizeInput` clamps every field as it is decoded.
 *
 * {@link RoomState} is what devices draw: per player the place, the way it faces, whether it is
 * moving, the character, the name, whether it is connected, and `ack` (the `seq` of the newest
 * input the room applied, which a predicting device replays from), and what the rules own (P10.15):
 * the score, the status (`engine-mechanics` `STATUS`: free, stunned, out) and a rules module's
 * `mark`. Per room the phase, the step every state is stamped with, the round, the step its phase
 * ends at (0 = never) and the last round's winner. The level is never in the state.
 *
 * Events (a hit, a catch, a round's end, a join) arrive as one message of type `engine-mechanics`
 * `ONLINE_EVENT` per step that had any, an array in the order they happened, after the patch that
 * shows them.
 */

export const Input = schema({
	seq: t.uint32(),
	moveX: t.int8(),
	moveY: t.int8(),
	buttons: t.uint8(),
	aimX: t.float32(),
	aimY: t.float32(),
	/** The room step the device was drawing everyone else at (lag compensation, P10.15). */
	view: t.uint32(),
});
export type InputFrame = SchemaType<typeof Input>;

export const Player = schema({
	name: t.string(),
	character: t.string(),
	x: t.float32(),
	y: t.float32(),
	facing: t.uint8(),
	moving: t.boolean(),
	connected: t.boolean(),
	ack: t.uint32(),
	score: t.int32(),
	status: t.uint8(),
	mark: t.boolean(),
});

export const RoomState = schema({
	/** `waiting` until the first player joins; then `running` a round and `ended` between rounds. */
	phase: t.string(),
	step: t.uint32(),
	round: t.uint32(),
	endsAt: t.uint32(),
	winner: t.string(),
	players: t.map(Player),
});
export type RoomStateData = SchemaType<typeof RoomState>;
