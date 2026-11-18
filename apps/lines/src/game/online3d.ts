import { serverVariablesOf } from 'engine-flow-v2';
import { ONLINE_EVENT } from 'engine-mechanics';
import {
	crashFlowSignalsOf,
	crashServerValuesOf,
	type CrashRoomState,
} from 'engine-mechanics/src/crashFlow.js';
import type { Room } from 'engine-rooms';
import { normalizeGameConfigDoc, onlineGameOf } from 'game-config';

import { bakedFlowV2Doc, bakedGameConfig, refuseOnlineBoot } from '../editor-scenes';
import { getFlowV2 } from './flowV2InterpreterHolder';
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
 *
 * A Crash room (`arcade.world3d.rules.module: 'crash'`) also reaches the game's Flow: its events
 * as Flow signals (`engine-mechanics` `crashFlowSignalsOf`: `pieceScored`, `kill`, `respawn`,
 * `pitRise`, `roundStart`, `roundEnd`, …) and its round, team score and own status as the values of
 * the variables the room owns (`crashServerValuesOf`), written on every state. The stage hears the
 * events too ({@link Online3d.listen}), for the knockbacks it predicts.
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
	/** The room runs Crash's rules (a fall kills, players die, Flow hears the round). */
	crash: boolean;
	/** Hear the room's events, each batch in order. */
	listen(listener: (events: readonly RoomEvent[]) => void): void;
};

type RoomEvent = { type: string; [key: string]: unknown };

let session: Online3d | undefined;

/** The joined 3D room, or `undefined` (an offline game, a 2D room, or not joined yet). */
export const online3dSession = (): Online3d | undefined => session;

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
	const crash = (world3d as { rules?: { module?: unknown } }).rules?.module === 'crash';
	const listeners: ((events: readonly RoomEvent[]) => void)[] = [];
	const teamOf = () =>
		(joined.state as CrashRoomState | undefined)?.players?.get(joined.sessionId)?.team ?? -1;
	joined.onMessage(ONLINE_EVENT, (events: RoomEvent[]) => {
		for (const listener of listeners) listener(events);
		if (!crash) return;
		const flow = getFlowV2();
		for (const signal of crashFlowSignalsOf(events, joined.sessionId, teamOf()))
			void flow?.dispatch(signal.name, signal.payload);
	});
	if (crash) {
		const tickHz = resolved.online.tickHz;
		let bound: { id: string; server: string }[] | undefined;
		joined.onStateChange((state: CrashRoomState) => {
			const store = getFlowV2()?.state;
			if (!store) return;
			bound ??= serverVariablesOf(bakedFlowV2Doc() ?? {});
			if (!bound.length) return;
			const values: Record<string, unknown> = crashServerValuesOf(state, joined.sessionId, tickHz);
			for (const { id, server } of bound) store.write(id, values[server]);
		});
	}
	joined.onLeave((code: number) => {
		if (session?.room === joined) session = undefined;
		if (code !== CONSENTED) void refuseOnlineBoot(`the room closed (code ${code})`, true);
	});
	session = {
		room: joined,
		world3d,
		tickHz: resolved.online.tickHz,
		patchHz: resolved.online.patchHz,
		crash,
		listen: (listener) => {
			listeners.push(listener);
		},
	};
}
