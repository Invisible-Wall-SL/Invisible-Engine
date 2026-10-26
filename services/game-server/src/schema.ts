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
 * input the room applied, which a predicting device replays from). Per room the phase and the step.
 * The level is never in the state.
 */
export const Input = schema({
	seq: t.uint32(),
	moveX: t.int8(),
	moveY: t.int8(),
	buttons: t.uint8(),
	aimX: t.float32(),
	aimY: t.float32(),
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
});

export const RoomState = schema({
	/** `waiting` until the first player joins, `running` from then on. Rounds that end are P10.15. */
	phase: t.string(),
	step: t.uint32(),
	players: t.map(Player),
});
export type RoomStateData = SchemaType<typeof RoomState>;
