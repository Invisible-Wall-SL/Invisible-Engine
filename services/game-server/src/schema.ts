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
 * the score, the status (`engine-mechanics` `STATUS`: free, stunned, out, and
 * a rules module's grounded, hooked) and a rules module's
 * `mark`, and whether it is a bot the server plays (P10.16). Per room the phase, the step every
 * state is stamped with, the round, the step its phase ends at (0 = never) and the last round's
 * winner, and the room's seed, from which a device makes a generated field. The level is never in
 * the state.
 *
 * A room with `online.nearby` sends each device only the players inside that box around its own
 * ({@link NearbyRoomState}) and only the events about them; the room's fields still reach
 * everyone.
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

const playerFields = {
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
	/** A bot the server plays (P10.16). */
	bot: t.boolean(),
};

export const Player = schema(playerFields);

/** The `StateView` tags of a nearby room: every player a device is sent, and its own player. */
export const VIEW_TAG = Object.freeze({ near: 1, own: 2 });

/** A player of a nearby room: `ack` matters only to its own device (which replays from it), so it
 *  goes only there — a hundred players' acks would otherwise be a quarter of every patch. */
export const NearbyPlayer = schema({ ...playerFields, ack: t.uint32().view(VIEW_TAG.own) });

const roomFields = {
	/** `waiting` until the first player joins; then `running` a round and `ended` between rounds. */
	phase: t.string(),
	step: t.uint32(),
	round: t.uint32(),
	endsAt: t.uint32(),
	winner: t.string(),
	/** The room's seed (P11.2 (e)): a device makes the room's own field from it with the same
	 *  generator the server ran (`engine-mechanics` `generatedOnlineGame`). */
	seed: t.uint32(),
};

export const RoomState = schema({ ...roomFields, players: t.map(Player) });
export type RoomStateData = SchemaType<typeof RoomState>;

/** The state of a room that sends each device only the players near its own (`online.nearby`,
 *  P10.16): a player reaches the devices whose `StateView` holds it (`arcadeRoom.ts`). */
export const NearbyRoomState = schema({ ...roomFields, players: t.map(NearbyPlayer).view() });
