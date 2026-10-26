import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import {
	createEndpoint,
	createRouter,
	defineRoom,
	defineServer,
	matchMaker,
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
const MAX_PAYLOAD_BYTES = 1024;

/** The largest HTTP request body (a matchmaking request's join options): Colyseus reads a body
 *  whole before it routes it, with no limit of its own. */
const MAX_BODY_BYTES = 4096;

/** The matchmaking calls a device may make. `create` is not one: it would let a device make rooms
 *  nobody joins until the process holds no more (a room with space is made by `joinOrCreate`). */
const EXPOSED_METHODS = ['joinOrCreate', 'join', 'joinById', 'reconnect'];

/** An HTTP server that refuses a declared body over {@link MAX_BODY_BYTES} before any listener
 *  (Colyseus' body reader among them) sees the request. */
function cappedHttpServer() {
	const http = createServer();
	const emit = http.emit.bind(http);
	http.emit = ((event: string, ...args: unknown[]) => {
		if (event === 'request') {
			const [req, res] = args as [IncomingMessage, ServerResponse];
			if (Number(req.headers['content-length']) > MAX_BODY_BYTES) {
				res.writeHead(413, { connection: 'close' }).end();
				req.destroy();
				return true;
			}
		}
		return emit(event, ...args);
	}) as typeof http.emit;
	return http;
}

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
		transport: new WebSocketTransport({
			server: cappedHttpServer(),
			maxPayload: MAX_PAYLOAD_BYTES,
		}),
		gracefullyShutdown: options.gracefullyShutdown ?? true,
		greet: false,
		rooms: {
			[ROOM_NAME]: defineRoom(
				arcadeRoomClass({ loadGame: options.loadGame, maxRooms: options.maxRooms, rooms }),
			).filterBy(['game']),
		},
		routes: createRouter({ healthz }),
	});
	matchMaker.controller.exposedMethods = [...EXPOSED_METHODS];
	return {
		server,
		rooms,
		listen: (port) => server.listen(port),
		close: () => server.gracefullyShutdown(false),
	};
}
