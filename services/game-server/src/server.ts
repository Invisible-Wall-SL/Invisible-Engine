import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

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

/** Requests with a body (every matchmaking call) one address may make per
 *  {@link MATCHMAKE_WINDOW_MS}: a held seat lasts {@link SEAT_SECONDS}, so this bounds the seats
 *  (and config reads) one address can tie up. */
export const MATCHMAKE_PER_WINDOW = 30;
const MATCHMAKE_WINDOW_MS = 10_000;

/** How long a seat is held for a device that asked for one before it connects. */
export const SEAT_SECONDS = 5;

/** The matchmaking calls a device may make. `create` is not one: it would let a device make rooms
 *  nobody joins until the process holds no more (a room with space is made by `joinOrCreate`). */
const EXPOSED_METHODS = ['joinOrCreate', 'join', 'joinById', 'reconnect'];

const BODYLESS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The methods the server serves. The router hands any method to `new Request(…)`, which throws
 *  for some (`TRACE`) out of the server; every other method is refused first. */
const SERVED = new Set([...BODYLESS, 'POST']);

/** WebSockets one address may hold open: a household or a school behind one address, not a
 *  process's worth of sockets. */
const SOCKETS_PER_ADDRESS = 64;

/** How long a request (headers and body) may take; the default five minutes lets slow clients pile
 *  up. A WebSocket, once upgraded, is not a request and is not timed by it. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Sockets one process holds: every player's WebSocket, with room for matchmaking requests. */
const MAX_CONNECTIONS = 6000;

/** Answer `status` and close. The socket is dropped only once the answer is out, so a refused
 *  device reads why; `connection: close` keeps Node from reading the rest of its body. */
const refuse = (req: IncomingMessage, res: ServerResponse, status: number): true => {
	res.on('finish', () => req.destroy());
	res.writeHead(status, { connection: 'close', 'access-control-allow-origin': '*' }).end();
	return true;
};

/**
 * Where the request says it is, built as Colyseus' router (better-call) builds it — from
 * `x-forwarded-proto`, `host` and the raw target — or `undefined` when that is not a URL. The
 * router does it with no guard, so a request it cannot parse would throw out of the server and
 * end the process; this one is refused first.
 */
const locate = (req: IncomingMessage): URL | undefined => {
	if (!req.url?.startsWith('/')) return undefined;
	const proto = req.headers['x-forwarded-proto'];
	if (proto !== undefined && proto !== 'http' && proto !== 'https') return undefined;
	try {
		return new URL(`${proto ?? 'http'}://${req.headers.host}${req.url}`);
	} catch {
		return undefined;
	}
};

/**
 * An HTTP server that refuses, before any listener (Colyseus' router among them) sees it: a
 * request whose URL the router could not build (400); one that would carry a body with no
 * `content-length` (411 — a chunked body is streamed with no limit; Node itself rejects a request
 * naming both) or declares more than {@link MAX_BODY_BYTES} (413 — Node reads no more than the
 * declared length); and an address's requests that can carry a body (every matchmaking call)
 * past `perWindow` ({@link MATCHMAKE_PER_WINDOW}) in a window; a method it does not serve (405) (429; counted by method, so no
 * spelling of the path escapes it). `trustProxy`: the address is the last `x-forwarded-for` entry,
 * the one the platform's proxy added (Railway); otherwise the socket's. The WebSocket upgrade is
 * guarded the same way for its URL, and one address holds at most {@link SOCKETS_PER_ADDRESS}
 * WebSockets.
 */
function guardedHttpServer(trustProxy: boolean, perWindow: number) {
	const http = createServer({
		requestTimeout: REQUEST_TIMEOUT_MS,
		headersTimeout: REQUEST_TIMEOUT_MS,
	});
	http.maxConnections = MAX_CONNECTIONS;
	const emit = http.emit.bind(http);
	let window = 0;
	let counts = new Map<string, number>();
	const addressOf = (req: IncomingMessage) => {
		const forwarded = trustProxy ? req.headers['x-forwarded-for'] : undefined;
		const last = typeof forwarded === 'string' ? forwarded.split(',').pop()?.trim() : undefined;
		return last || req.socket.remoteAddress || '';
	};
	const open = new Map<string, number>();
	http.emit = ((event: string, ...args: unknown[]) => {
		if (event === 'upgrade') {
			const [req, socket] = args as [IncomingMessage, Duplex];
			const address = addressOf(req);
			const held = open.get(address) ?? 0;
			if (!locate(req) || req.method !== 'GET' || held >= SOCKETS_PER_ADDRESS) {
				socket.destroy();
				return true;
			}
			open.set(address, held + 1);
			socket.once('close', () => {
				const left = (open.get(address) ?? 1) - 1;
				if (left > 0) open.set(address, left);
				else open.delete(address);
			});
		}
		if (event === 'request') {
			const [req, res] = args as [IncomingMessage, ServerResponse];
			if (!locate(req)) return refuse(req, res, 400);
			const method = req.method ?? 'GET';
			if (!SERVED.has(method)) return refuse(req, res, 405);
			if (!BODYLESS.has(method)) {
				const length = req.headers['content-length'];
				if (length === undefined) return refuse(req, res, 411);
				if (Number(length) > MAX_BODY_BYTES) return refuse(req, res, 413);
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
