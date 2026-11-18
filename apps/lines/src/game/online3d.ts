import { ONLINE_EVENT } from 'engine-mechanics';
import type { Room } from 'engine-rooms';
import { normalizeGameConfigDoc, onlineGameOf } from 'game-config';

import { bakedGameConfig, refuseOnlineBoot } from '../editor-scenes';
import { joinOnlineRoom as joinOnlineRoom2d } from './online';

/**
 * The online 3D room (runtime step 4, `docs/design/3d-games.md`), compiled only into the `arcade3d`
 * runtime (`families/arcade3d.ts` exports this module's {@link joinOnlineRoom} in place of the 2D
 * one). A config with an `arcade.world3d` block plays only in the game server's `arcade3d` room
 * (`services/game-server` `arcadeRoom3d.ts`); any other online game joins the 2D room as before.
 *
 * This module holds only the connection: the room's rates and the joined room, read by
 * `ArcadeStage3D.svelte`, which builds the device's side of it (`engine-3d` `createRoomView3d`:
 * the own player predicted, everyone else interpolated) once three.js has loaded. A room that goes
 * away for good stops the game on the error screen, as the 2D room does.
 */

/** The game server's 3D room type (`services/game-server/src/server.ts` `ROOM_NAME_3D`). */
const ROOM_NAME_3D = 'arcade3d';
/** The close code of a leave the device asked for. */
const CONSENTED = 4000;

export type Online3d = {
	room: Room;
	/** The raw `arcade.world3d` block (`game-config` drops it; `engine-3d` `world3dOf` reads it). */
	world3d: unknown;
	tickHz: number;
	patchHz: number;
};

let session: Online3d | undefined;

/** The joined 3D room, or `undefined` (an offline game, a 2D room, or not joined yet). */
export const online3dSession = (): Online3d | undefined => session;

/** Why a device leaves a room whose world it does not play (`refuseRoomWorld`). */
export const OTHER_WORLD =
	'the game server plays another version of this game — try again in a minute';

/**
 * Leave the room and stop on the error screen, saying `reason`: the device cannot play the room's
 * 3D world — it plays another (`engine-3d` `RoomView3d.mismatch`: the game server reads the
 * published config through a cache, and the runtime and the server are released apart, so the two
 * differ for a while), or its own config's world does not read. Predicting there would correct the
 * own player on every step, or draw no field at all.
 */
export function refuseRoomWorld(reason: string): void {
	const joined = session?.room;
	session = undefined;
	joined?.leave().catch(() => {});
	void refuseOnlineBoot(reason, true);
}

/** The raw config's `arcade.world3d`, or `undefined`. */
const rawWorld3d = (): unknown =>
	(bakedGameConfig() as { arcade?: { world3d?: unknown } } | undefined)?.arcade?.world3d;

/**
 * Join this game's room, or stop the boot on the error screen saying why. A 3D game (an
 * `arcade.world3d` block) joins the `arcade3d` room; every other online game the 2D one.
 */
export async function joinOnlineRoom(): Promise<void> {
	const world3d = rawWorld3d();
	if (world3d === undefined || world3d === null) return joinOnlineRoom2d();
	const resolved = onlineGameOf(normalizeGameConfigDoc(bakedGameConfig()) ?? null);
	if (!resolved) return refuseOnlineBoot('the config is not an online game');
	if ('refused' in resolved) return refuseOnlineBoot(resolved.refused);
	const params = new URLSearchParams(window.location.search);
	const url = params.get('rooms_url');
	const game = params.get('rooms_game') || params.get('project');
	if (!url) return refuseOnlineBoot('the launch names no game server (?rooms_url=)');
	if (!game) return refuseOnlineBoot('the launch names no game (?rooms_game=)');
	let room: Room | undefined;
	try {
		const { Client } = await import('engine-rooms');
		room = await new Client(url).joinOrCreate(ROOM_NAME_3D, {
			game,
			name: params.get('rooms_name') ?? undefined,
			character: params.get('rooms_character') ?? undefined,
		});
	} catch (error) {
		room?.leave().catch(() => {});
		return refuseOnlineBoot(
			`the game server did not let it in (${error instanceof Error ? error.message : String(error)})`,
		);
	}
	const joined = room;
	// The room's one-shots (`jumped`, `landed`, `enterZone`, …) reach Flow in a later step; until
	// then they are received and set aside, so the SDK has a handler for them.
	joined.onMessage(ONLINE_EVENT, () => {});
	joined.onLeave((code: number) => {
		if (session?.room === joined) session = undefined;
		if (code !== CONSENTED) void refuseOnlineBoot(`the room closed (code ${code})`, true);
	});
	session = {
		room: joined,
		world3d,
		tickHz: resolved.online.tickHz,
		patchHz: resolved.online.patchHz,
	};
}
