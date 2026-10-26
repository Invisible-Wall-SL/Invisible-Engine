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

/** The largest HTTP request body (a matchmaking request's join options). Colyseus' router reads a
 *  body whole, with no limit of its own, so the server refuses a bigger one before it is read. */
const MAX_BODY_BYTES = 4096;

/** Matchmaking requests one address may make per {@link MATCHMAKE_WINDOW_MS}: a held seat lasts
 *  {@link SEAT_SECONDS}, so this bounds the seats (and config reads) one address can tie up. */
export const MATCHMAKE_PER_WINDOW = 30;
const MATCHMAKE_WINDOW_MS = 10_000;

/** How long a seat is held for a device that asked for one before it connects. */
export const SEAT_SECONDS = 5;

/** The matchmaking calls a device may make. `create` is not one: it would let a device make rooms
 *  nobody joins until the process holds no more (a room with space is made by `joinOrCreate`). */
const EXPOSED_METHODS = ['joinOrCreate', 'join', 'joinById', 'reconnect'];

const BODYLESS = new Set(['GET', 'HEAD', 'OPTIONS']);

const refuse = (req: IncomingMessage, res: ServerResponse, status: number): true => {
	res.writeHead(status, { connection: 'close', 'access-control-allow-origin': '*' }).end();
	req.destroy();
	return true;
};

/**
 * An HTTP server that refuses, before any listener (Colyseus' router among them) sees it: a
 * request that would carry a body with no `content-length` (a chunked body is streamed with no
 * limit; Node itself rejects a request naming both), one declaring more than
 * {@link MAX_BODY_BYTES} (Node reads no more than the declared length), and an address's
 * matchmaking requests past `perWindow` ({@link MATCHMAKE_PER_WINDOW}) in a window. `trustProxy`: the address is
 * the last `x-forwarded-for` entry, the one the platform's proxy added (Railway); otherwise the
 * socket's.
 */
function guardedHttpServer(trustProxy: boolean, perWindow: number) {
	const http = createServer();
	const emit = http.emit.bind(http);
	let window = 0;
	let counts = new Map<string, number>();
	const addressOf = (req: IncomingMessage) => {
		const forwarded = trustProxy ? req.headers['x-forwarded-for'] : undefined;
		const last = typeof forwarded === 'string' ? forwarded.split(',').pop()?.trim() : undefined;
		return last || req.socket.remoteAddress || '';
	};
	http.emit = ((event: string, ...args: unknown[]) => {
		if (event === 'request') {
			const [req, res] = args as [IncomingMessage, ServerResponse];
			const method = req.method ?? 'GET';
			const length = req.headers['content-length'];
			if (!BODYLESS.has(method) && length === undefined) return refuse(req, res, 411);
			if (Number(length) > MAX_BODY_BYTES) return refuse(req, res, 413);
			if (req.url?.startsWith('/matchmake/')) {
				const now = Math.floor(Date.now() / MATCHMAKE_WINDOW_MS);
				if (now !== window) {
					window = now;
					counts = new Map();
				}
				const address = addressOf(req);
				const count = (counts.get(address) ?? 0) + 1;
				counts.set(address, count);
				if (count > perWindow) return refuse(req, res, 429);
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
	/** Read a device's address from the proxy's `x-forwarded-for` (behind Railway's edge). */
	trustProxy?: boolean;
	/** Matchmaking requests one address may make per window. Default {@link MATCHMAKE_PER_WINDOW}. */
	matchmakePerWindow?: number;
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
			server: guardedHttpServer(
				options.trustProxy ?? false,
				options.matchmakePerWindow ?? MATCHMAKE_PER_WINDOW,
			),
			maxPayload: MAX_PAYLOAD_BYTES,
		}),
		gracefullyShutdown: options.gracefullyShutdown ?? true,
		greet: false,
		rooms: {
			[ROOM_NAME]: defineRoom(
				arcadeRoomClass({
					loadGame: options.loadGame,
					maxRooms: options.maxRooms,
					seatSeconds: SEAT_SECONDS,
					rooms,
				}),
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
