import {
	createEndpoint,
	createRouter,
	defineRoom,
	defineServer,
	type Server,
} from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';

import { arcadeRoomClass } from './arcadeRoom.ts';
import type { LoadGame } from './configSource.ts';

/**
 * THE INVISIBLE GAME SERVER (`docs/design/realtime-multiplayer.md` §9): one process, many rooms,
 * one replica. A device joins `arcade` with `{ game, name, character }`; `GET /healthz` reports
 * the commit it runs and its rooms.
 */

/** The room type every online arcade game is played in. */
export const ROOM_NAME = 'arcade';

/** The largest WebSocket message the server reads: an input is a few bytes. */
export const MAX_PAYLOAD_BYTES = 1024;

export type GameServerOptions = {
	loadGame: LoadGame;
	maxRooms: number;
	commit: string;
	/** Colyseus' own shutdown on SIGTERM; the gate turns it off to close the server itself. */
	gracefullyShutdown?: boolean;
};

export type GameServer = {
	server: Server;
	rooms: { count: number };
	listen(port: number): Promise<void>;
	close(): Promise<void>;
};

export function createGameServer(options: GameServerOptions): GameServer {
	const rooms = { count: 0 };
	const healthz = createEndpoint('/healthz', { method: 'GET' }, async () =>
		Response.json({ ok: true, commit: options.commit, rooms: rooms.count }),
	);
	const server = defineServer({
		transport: new WebSocketTransport({ maxPayload: MAX_PAYLOAD_BYTES }),
		gracefullyShutdown: options.gracefullyShutdown ?? true,
		greet: false,
		rooms: {
			[ROOM_NAME]: defineRoom(
				arcadeRoomClass({ loadGame: options.loadGame, maxRooms: options.maxRooms, rooms }),
			).filterBy(['game']),
		},
		routes: createRouter({ healthz }),
	});
	return {
		server,
		rooms,
		listen: (port) => server.listen(port),
		close: () => server.gracefullyShutdown(false),
	};
}
