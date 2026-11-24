import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * The wire (`docs/design/realtime-multiplayer.md` §5).
 *
 * {@link Input} is the ONLY thing a device sends. It is flat and typed, so a field it does not
 * declare cannot arrive; it has no position, hit or score to claim (what its screen shows only
 * adds to who it is sent, as far as the config's `max`). `engine-mechanics` `sanitizeInput` clamps
 * every field as it is decoded.
 *
 * {@link RoomState} is what devices draw: per player the place, the way it faces, whether it is
 * moving, the character, the name, whether it is connected, and `ack` (the `seq` of the newest
 * input the room applied, which a predicting device replays from), and what the rules own (P10.15):
 * the score, the status (`engine-mechanics` `STATUS`: free, stunned, out, or a rules module's
 * grounded, hooked), the module's `mark`, whether it is a bot the server plays (P10.16) and how
 * high a module lifted it (`z`), whether a module holds it still (`held`) and the move it carries
 * (`air`, `carryX`, `carryY`). Per room the phase, the step every state is stamped with, the
 * round, the step its phase ends at (0 = never) and the last round's winner, the room's seed,
 * from which a device makes a generated field, and the stains its rules module left on the field
 * (Salmons' bloodstains, the newest last). The level is never in the state.
 *
 * A room with `online.nearby` sends each device only the players inside that box around its own
 * ({@link NearbyRoomState}) and only the events about them; the room's fields still reach
 * everyone. With `nearby.max`, a device that says what its screen shows is sent the players in
 * that view too, as far as the `max` box.
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
	/** A caught player's Respawn, as `1 +` the index of the character it picked in
	 *  `arcade.online.characters` (0: none). Read only while the room waits for it (`rules.respawn:
	 *  'manual'`); a device may send it on every input until it is back. */
	respawn: t.uint8(),
	/** What the device's screen shows about its own player, whole px (`engine-mechanics`
	 *  `shown.js`; 0 × 0: it says nothing): world x / y extents (`shownIso` 0), or a 2:1 isometric
	 *  screen's across / down extents in world-projected px (`shownIso` 1). Only a room whose
	 *  `online.nearby` has a `max` reads it, to send the device the players in that view as well
	 *  as the box's; the step never does. A runtime older than these fields never sets them. */
	shownW: t.uint16(),
	shownH: t.uint16(),
	shownIso: t.uint8(),
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
	/** How high a rules module has lifted it off the ground, px (a salmon's leap). */
	z: t.float32(),
	/** Free but held still by a rules module (a salmon climbing a waterfall): a predicting device
	 *  steps it with no input, as the room does. */
	held: t.boolean().default(false),
	/** Inputs left for which the room carries a move (`carryX`, `carryY`: a leaping salmon keeps
	 *  its leap's move while the stick rests; `engine-mechanics` `carriedInput`): a predicting
	 *  device steps the same input. */
	air: t.uint8().default(0),
	carryX: t.int8().default(0),
	carryY: t.int8().default(0),
	/** A fisherman's line (Salmons): out while `lineActive` is 1, its bobber at `lineX`, `lineY`
	 *  (world px), from the cast until it is reeled home, hooked or not. */
	lineX: t.float32().default(0),
	lineY: t.float32().default(0),
	lineActive: t.uint8().default(0),
	/** The player holding it in its hands while its status is `held` (a `hook` ability's `carry`:
	 *  Salmons' caught salmon in the fisherman's hands); '' otherwise. The last field, so a
	 *  runtime older than it reads every other as before. */
	heldBy: t.string().default(''),
};

export const Player = schema(playerFields);

/** The `StateView` tags of a nearby room: every player a device is sent, and its own player. */
export const VIEW_TAG = Object.freeze({ near: 1, own: 2 });

/** A player of a nearby room: `ack` matters only to its own device (which replays from it), so it
 *  goes only there — a hundred players' acks would otherwise be a quarter of every patch. */
export const NearbyPlayer = schema({ ...playerFields, ack: t.uint32().view(VIEW_TAG.own) });

/** A mark a rules module left on the field, field px (Salmons' bloodstain where a salmon died). */
export const Stain = schema({ x: t.float32(), y: t.float32() });

const roomFields = {
	/** `waiting` until the first player joins; then `running` a round and `ended` between rounds. */
	phase: t.string(),
	step: t.uint32(),
	round: t.uint32(),
	endsAt: t.uint32(),
	winner: t.string(),
	/** The last round's winner's name (a far winner is not in a nearby device's view). */
	winnerName: t.string(),
	/** The room's seed (P11.2 (e)): a device makes the room's own field from it with the same
	 *  generator the server ran (`engine-mechanics` `generatedOnlineGame`). */
	seed: t.uint32(),
	/** The rules module's stains, the newest last, at most its own cap: every device draws them,
	 *  in a nearby room too (`engine-mechanics` `OnlineRules.stains`). */
	stains: t.array(Stain),
};

export const RoomState = schema({ ...roomFields, players: t.map(Player) });
export type RoomStateData = SchemaType<typeof RoomState>;

/** The state of a room that sends each device only the players near its own (`online.nearby`,
 *  P10.16): a player reaches the devices whose `StateView` holds it (`arcadeRoom.ts`). */
export const NearbyRoomState = schema({ ...roomFields, players: t.map(NearbyPlayer).view() });

/**
 * THE 3D WIRE (`docs/design/3d/gameplay-evaluation.md` §3), used only by the 3D room
 * (`arcadeRoom3d.ts`); the classes above are untouched by it.
 *
 * {@link Input3D} is what a 3D device sends: int8 WORLD-space move axes (the device turned its
 * camera into a direction before quantising), the buttons, a uint16 yaw that is only copied, an
 * int16 pitch and the room step it was drawing at. `engine-mechanics` `sanitizeInput3d` clamps it as
 * it is decoded.
 *
 * {@link Player3D} is a 3D player as devices draw it: the place (`x y z`, metres, y up, `y` the
 * feet) and yaw, `status` and `team` (the rules'), `anim` (`ANIM3D` bits: grounded, sprinting,
 * carrying, aiming, double-jumped), and what the rules own (Crash, `engine-mechanics`
 * `crashRules.js`): `hp`, `shield`, the `hero` and `weapon` ids and the entity it is `carrying`
 * (''). Its OWN device (`VIEW_TAG.own`) is sent more: `ack`, the whole body to the bit (`bx by bz`,
 * `vx vy vz`, `climb` float64, `coyote`, `buffer`, `flags` — `engine-mechanics` `bodyOfWire3d`),
 * which its prediction is reconciled with, and the inputs the room holds for it (`waiting`) and the
 * steps its body owes (`credit`), which keep the device's clock on the room's
 * (`createClockSync3d`). One-shots (a jump, a landing, a bounce, a zone, a fall and its respawn, a
 * swing, a hit, a kill, a knockback, a score) arrive as `ONLINE_EVENT` messages, not state.
 *
 * {@link Entity3D} is a thing the rules put on the field: a `piece` or a `corpse` (carriable), a
 * `projectile`; its place (`x y z`, metres), who carries it (`carriedBy`, ''), its
 * `engine-mechanics` `ENTITY_STATE` and its `owner` (a corpse's player, a projectile's shooter).
 * {@link RoomState3D}'s `world` is the room's `worldHash3d`: a device whose own world differs
 * refuses the room. It adds the round (`round`, the step it ends at `endsAt`, the `winner` team),
 * the teams' `scores` (red, blue) and the pit's `pitLevel`.
 */
export const Input3D = schema({
	seq: t.uint32(),
	moveX: t.int8(),
	moveZ: t.int8(),
	buttons: t.uint8(),
	yaw: t.uint16(),
	pitch: t.int16(),
	view: t.uint32(),
});
export type Input3DFrame = SchemaType<typeof Input3D>;

export const Player3D = schema({
	name: t.string(),
	character: t.string(),
	x: t.float32(),
	y: t.float32(),
	z: t.float32(),
	yaw: t.uint16(),
	status: t.uint8(),
	team: t.uint8(),
	anim: t.uint8(),
	connected: t.boolean(),
	bot: t.boolean(),
	ack: t.uint32().view(VIEW_TAG.own),
	bx: t.float64().view(VIEW_TAG.own),
	by: t.float64().view(VIEW_TAG.own),
	bz: t.float64().view(VIEW_TAG.own),
	vx: t.float64().view(VIEW_TAG.own),
	vy: t.float64().view(VIEW_TAG.own),
	vz: t.float64().view(VIEW_TAG.own),
	coyote: t.uint16().view(VIEW_TAG.own),
	buffer: t.uint16().view(VIEW_TAG.own),
	climb: t.float64().view(VIEW_TAG.own),
	flags: t.uint8().view(VIEW_TAG.own),
	waiting: t.uint8().view(VIEW_TAG.own),
	credit: t.uint8().view(VIEW_TAG.own),
	hp: t.uint16(),
	shield: t.uint16(),
	hero: t.string(),
	weapon: t.string(),
	carrying: t.string(),
});

export const Entity3D = schema({
	kind: t.string(),
	x: t.float32(),
	y: t.float32(),
	z: t.float32(),
	carriedBy: t.string(),
	state: t.uint8(),
	owner: t.string(),
});

export const RoomState3D = schema({
	/** `waiting` until the first person joins, then `running` — with rules, `ended` between rounds. */
	phase: t.string(),
	step: t.uint32(),
	seed: t.uint32(),
	world: t.uint32(),
	round: t.uint32(),
	endsAt: t.uint32(),
	winner: t.string(),
	scores: t.array('int32'),
	pitLevel: t.float32(),
	players: t.map(Player3D),
	entities: t.map(Entity3D),
});
export type RoomState3DData = SchemaType<typeof RoomState3D>;
