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
import { addressKey, hold, heldBy, noteRequest, release } from './addresses.ts';
import { guardSockets } from './socketGuard.ts';
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

/** What one address may hold — open WebSockets plus seats held for its dropped players to rejoin
 *  (`addresses.ts`): a household or a few players behind one address, not a process's worth of
 *  sockets or rooms — and the WebSockets it may open per window. */
const SOCKETS_PER_ADDRESS = 16;
const UPGRADES_PER_WINDOW = 60;

/** The only WebSocket the server serves: a seat in a room, `…/<process>/<room>?sessionId=…` (the
 *  path's end, as Colyseus matches it, so a server behind a path prefix still serves).
 *  Colyseus' latency utility (any other path) answers every frame and is never used. */
const ROOM_SOCKET = /\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;

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
 * past `perWindow` ({@link MATCHMAKE_PER_WINDOW}) in a window (429; counted by method, so no
 * spelling of the path escapes it); and a method it does not serve (405). `trustProxy`: the address is the last `x-forwarded-for` entry,
 * the one the platform's proxy added (Railway); otherwise the socket's. The WebSocket upgrade is
 * served only for a room seat ({@link ROOM_SOCKET} with a `sessionId`); one address holds at most
 * {@link SOCKETS_PER_ADDRESS} WebSockets and held seats together and opens at most
 * {@link UPGRADES_PER_WINDOW} WebSockets a window.
 */
function guardedHttpServer(trustProxy: boolean, perWindow: number) {
	const http = createServer({
		requestTimeout: REQUEST_TIMEOUT_MS,
		headersTimeout: REQUEST_TIMEOUT_MS,
	});
	http.maxConnections = MAX_CONNECTIONS;
	const emit = http.emit.bind(http);
	let window = 0;
	const posts = new Map<string, number>();
	const upgrades = new Map<string, number>();
	/** Count one more for `address` in this window; whether that passes `limit`. */
	const over = (counts: Map<string, number>, address: string, limit: number) => {
		const now = Math.floor(Date.now() / MATCHMAKE_WINDOW_MS);
		if (now !== window) {
			window = now;
			posts.clear();
			upgrades.clear();
		}
		const count = (counts.get(address) ?? 0) + 1;
		counts.set(address, count);
		return count > limit;
	};
	const addressOf = (req: IncomingMessage) => {
		const forwarded = trustProxy ? req.headers['x-forwarded-for'] : undefined;
		const last = typeof forwarded === 'string' ? forwarded.split(',').pop()?.trim() : undefined;
		return addressKey(last || req.socket.remoteAddress || '');
	};
	http.emit = ((event: string, ...args: unknown[]) => {
		if (event === 'upgrade') {
			const [req, socket] = args as [IncomingMessage, Duplex];
			const url = locate(req);
			const address = addressOf(req);
			const held = heldBy(address);
			// Every attempt counts, refused or not, so opening and dropping cannot loop.
			const spent = over(upgrades, address, UPGRADES_PER_WINDOW);
			if (
				spent ||
				!url ||
				req.method !== 'GET' ||
				!ROOM_SOCKET.test(url.pathname) ||
				!url.searchParams.get('sessionId') ||
				held >= SOCKETS_PER_ADDRESS
			) {
				socket.destroy();
				return true;
			}
			hold(address);
			noteRequest(req, address);
			socket.once('close', () => release(address));
		}
		if (event === 'request') {
			const [req, res] = args as [IncomingMessage, ServerResponse];
			if (!locate(req)) return refuse(req, res, 400);
			const method = req.method ?? 'GET';
			if (!SERVED.has(method)) {
				res.setHeader('allow', [...SERVED].join(', '));
				return refuse(req, res, 405);
			}
			if (!BODYLESS.has(method)) {
				const length = req.headers['content-length'];
				if (length === undefined) return refuse(req, res, 411);
				if (Number(length) > MAX_BODY_BYTES) return refuse(req, res, 413);
				if (over(posts, addressOf(req), perWindow)) return refuse(req, res, 429);
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
		transport: guardSockets(
			new WebSocketTransport({
				// A client's ping is never answered: the guard counts it against the frame budget.
				autoPong: false,
				server: guardedHttpServer(
					options.trustProxy ?? false,
					options.matchmakePerWindow ?? MATCHMAKE_PER_WINDOW,
				),
				maxPayload: MAX_PAYLOAD_BYTES,
			}),
		),
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
