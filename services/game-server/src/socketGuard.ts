import { CloseCode, Protocol } from '@colyseus/core';
import type { WebSocketTransport } from '@colyseus/ws-transport';

/**
 * WHAT A ROOM'S WEBSOCKET MAY CARRY (`docs/design/realtime-multiplayer.md` §11), checked on every
 * frame before Colyseus decodes it.
 *
 * The runtime sends four kinds of frame: JOIN_ROOM (the join's acknowledgement), LEAVE_ROOM, PING
 * and reliable inputs. Every other code is closed undecoded, because Colyseus answers or decodes
 * them in ways a hostile device can turn on the process: `@colyseus/schema` 5.0.42's decoder for
 * UNRELIABLE inputs loops for ever on a negative slot length; ROOM_REQUEST is answered even before
 * the join is acknowledged, and those answers queue without limit; ROOM_DATA reaches handlers the
 * rooms do not need. A socket that has not acknowledged its join within {@link JOIN_DEADLINE_MS}
 * is closed too, so it cannot sit in Colyseus' joining state holding a seat and a queue.
 *
 * A socket closed here is remembered ({@link closedByGuard}), so its room holds no seat for it.
 */

/** The protocol code of a frame: its first byte's low five bits (the rest are flags). */
const PROTOCOL_CODE = 0b11111;

const ALLOWED = new Set<number>([
	Protocol.JOIN_ROOM,
	Protocol.LEAVE_ROOM,
	Protocol.PING,
	Protocol.ROOM_INPUT_RELIABLE,
]);

const JOIN_DEADLINE_MS = 5_000;

type RawSocket = {
	emit(event: string | symbol, ...args: unknown[]): boolean;
	close(code: number): void;
	once(event: 'close', listener: () => void): void;
};

const closed = new WeakSet<object>();

/** Whether the guard closed this raw socket (a room's `client.ref`). */
export const closedByGuard = (socket: unknown): boolean =>
	typeof socket === 'object' && socket !== null && closed.has(socket);

/** A frame's first byte. Colyseus leaves ws' `binaryType` at `nodebuffer`, so every frame — text,
 *  binary, reassembled fragments — arrives as one Buffer; the other shapes are read for safety. */
const firstByte = (data: unknown): number | undefined => {
	const chunk = Array.isArray(data) ? data[0] : data;
	if (chunk instanceof Uint8Array) return chunk[0];
	if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk)[0];
	return undefined;
};

/**
 * Wrap every WebSocket the transport accepts. The hook is the WebSocket server's `connection`
 * event, prepended so it wraps the socket before Colyseus attaches its own message listener (a
 * reconnect is a new socket, so it is wrapped too).
 */
export function guardSockets(transport: WebSocketTransport): WebSocketTransport {
	const { wss } = transport as unknown as {
		wss: { prependListener(event: 'connection', listener: (socket: RawSocket) => void): void };
	};
	wss.prependListener('connection', (socket) => {
		const shut = () => {
			closed.add(socket);
			socket.close(CloseCode.WITH_ERROR);
		};
		let joined = false;
		const deadline = setTimeout(() => {
			if (!joined) shut();
		}, JOIN_DEADLINE_MS);
		socket.once('close', () => clearTimeout(deadline));
		const emit = socket.emit.bind(socket);
		socket.emit = (event, ...args) => {
			if (event !== 'message') return emit(event, ...args);
			if (closed.has(socket)) return true;
			const byte = firstByte(args[0]);
			const code = byte === undefined ? undefined : byte & PROTOCOL_CODE;
			if (code === undefined || !ALLOWED.has(code)) {
				shut();
				return true;
			}
			if (code === Protocol.JOIN_ROOM) joined = true;
			return emit(event, ...args);
		};
	});
	return transport;
}
