import { serverVariablesOf } from 'engine-flow-v2';
import { ONLINE_EVENT } from 'engine-mechanics';
import type { RoomState3d, RoomView3d } from 'engine-3d';
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
 * This module holds the connection (the room's rates and the joined room) and, once
 * `ArcadeStage3D.svelte` has loaded three.js and built it, the device's side of the room (`engine-3d`
 * `createRoomView3d`: the own player predicted, everyone else interpolated) with its state
 * listener. The view lives as long as the room, not the stage: a remounted stage keeps its input
 * `seq` (the room drops every `seq` it has seen), its predictor and the player's home. A room that
 * goes away for good stops the game on the error screen, as the 2D room does.
 *
 * A Crash room (`arcade.world3d.rules.module: 'crash'`) also reaches the game's Flow: its events
 * as Flow signals (`engine-mechanics` `crashFlowSignalsOf`: `pieceScored`, `kill`, `respawn`,
 * `pitRise`, `roundStart`, `roundEnd`, …) and its round, team score and own status as the values of
 * the variables the room owns (`crashServerValuesOf`), written on every state. The room view hears
 * the events too ({@link Online3d.onEvents}), for the knockbacks it predicts.
 */

/** The game server's 3D room type (`services/game-server/src/server.ts` `ROOM_NAME_3D`). */
const ROOM_NAME_3D = 'arcade3d';
/** The close code of a leave the device asked for. */
const CONSENTED = 4000;

export type Online3d = {
	room: Room;
	/** The raw `arcade.world3d` block (`game-config` drops it; `engine-3d` `world3dOf` reads it). */
	world3d: unknown;
	/** The room's seed, from which a generated level is made (`engine-3d` `generatedWorld3d`). */
	seed: number | undefined;
	tickHz: number;
	patchHz: number;
	/** The device's side of the room, built once by {@link sessionView3d}. */
	view?: RoomView3d;
	/** Detach the view's state listener (the room ended). */
	unlisten?: () => void;
	/** Hear the room's one-shots (`services/game-server` `Online3dEvent`: `{ type, id, … }`);
	 *  returns the unsubscribe. */
	onEvents(listener: (events: readonly RoomEvent[]) => void): () => void;
	/** The room runs Crash's rules (a fall kills, players die, Flow hears the round). */
	crash: boolean;
};

/** A room event (`services/game-server` `Online3dEvent`): `{ type, id?, … }`. */
export type RoomEvent = { type: string; id?: string; [key: string]: unknown };

let session: Online3d | undefined;

/** The joined 3D room, or `undefined` (an offline game, a 2D room, or not joined yet). */
export const online3dSession = (): Online3d | undefined => session;

/**
 * The session's room view: `create`d the first time, then the same one for the life of the room,
 * fed every state the room sends from then on (and the one it has now). A room playing another
 * world than the device's (`RoomView3d.mismatch`) is left at once (`refuseRoomWorld`).
 */
export function sessionView3d(current: Online3d, create: () => RoomView3d): RoomView3d {
	if (current.view) return current.view;
	const view = create();
	const received = (state: unknown) => {
		view.received(state as RoomState3d, performance.now());
		if (view.mismatch) refuseRoomWorld(OTHER_WORLD);
	};
	current.room.onStateChange(received);
	// A knockback of the own player is predicted at its input (`RoomView3d.events`).
	const unhear = current.onEvents((events) => view.events(events));
	current.unlisten = () => {
		current.room.onStateChange.remove(received);
		unhear();
	};
	current.view = view;
	received(current.room.state);
	return view;
}

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
	session?.unlisten?.();
	session = undefined;
	joined?.leave().catch(() => {});
	void refuseOnlineBoot(reason, true);
}

/** How long a join waits for the room's first state, which carries the seed of its level. */
const SEED_WAIT_MS = 10_000;

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
	const generated =
		typeof (world3d as { generator?: unknown }).generator === 'string' ? await roomSeed(joined) : 0;
	if (generated === undefined) {
		joined.leave().catch(() => {});
		return refuseOnlineBoot('the room did not say which level it plays');
	}
	const crash = (world3d as { rules?: { module?: unknown } }).rules?.module === 'crash';
	// The room's one-shots (`jumped`, `attacked`, `knockback`, …): the 3D stage's characters and room
	// view hear them, and a Crash room's Flow.
	const listeners = new Set<(events: readonly RoomEvent[]) => void>();
	const teamOf = () =>
		(joined.state as CrashRoomState | undefined)?.players?.get(joined.sessionId)?.team ?? -1;
	joined.onMessage(ONLINE_EVENT, (events: unknown) => {
		if (!Array.isArray(events)) return;
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
		if (session?.room === joined) {
			session.unlisten?.();
			session = undefined;
		}
		if (code !== CONSENTED) void refuseOnlineBoot(`the room closed (code ${code})`, true);
	});
	session = {
		room: joined,
		world3d,
		seed: generated,
		tickHz: resolved.online.tickHz,
		patchHz: resolved.online.patchHz,
		onEvents(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		crash,
	};
}

/** The seed the room's first state carries, or `undefined` if none comes in time. */
function roomSeed(room: Room): Promise<number | undefined> {
	const now = (room.state as { seed?: unknown } | undefined)?.seed;
	if (typeof now === 'number') return Promise.resolve(now);
	return new Promise((resolve) => {
		const first = (state: { seed?: unknown }) => {
			clearTimeout(timer);
			resolve(typeof state.seed === 'number' ? state.seed : undefined);
		};
		const timer = setTimeout(() => {
			room.onStateChange.remove(first);
			resolve(undefined);
		}, SEED_WAIT_MS);
		room.onStateChange.once(first);
	});
}
