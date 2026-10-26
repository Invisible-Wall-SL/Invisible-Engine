import { CloseCode, Protocol } from '@colyseus/core';
import type { WebSocketTransport } from '@colyseus/ws-transport';

/**
 * WHAT A ROOM'S WEBSOCKET MAY DO (`docs/design/realtime-multiplayer.md` §11), checked on every
 * frame before Colyseus decodes it.
 *
 * - **Four kinds of frame.** The runtime sends JOIN_ROOM (the join's acknowledgement), LEAVE_ROOM,
 *   PING and reliable inputs. Any other code ends the socket undecoded, because Colyseus answers or
 *   decodes them in ways a hostile device can turn on the process: `@colyseus/schema` 5.0.42's
 *   decoder for UNRELIABLE inputs loops for ever on a negative slot length; ROOM_REQUEST answers
 *   queue without limit before the join is acknowledged; ROOM_DATA reaches handlers no room needs.
 * - **A join deadline.** A socket that has not acknowledged its join within
 *   {@link JOIN_DEADLINE_MS} is ended, so it cannot sit in Colyseus' joining state.
 * - **A frame budget.** More than {@link FRAMES_PER_SECOND} frames a second ends the socket, before
 *   Colyseus' own (graceful, so still parsing) flood close.
 * - **Ending is immediate.** The guard terminates; a close started elsewhere (Colyseus' flood
 *   limit, a leave) is followed by a terminate after {@link CLOSE_GRACE_MS} and its frames are
 *   dropped meanwhile — a graceful close otherwise goes on parsing whatever the peer streams for
 *   30 s.
 * - **A reader that does not read** — whose unsent data passes {@link MAX_BUFFERED_BYTES} — is
 *   ended, so the server never buffers for it without limit.
 *
 * A socket the guard ended is remembered ({@link closedByGuard}), so its room holds no seat for it.
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
/** Above the fastest room's inputs (60 a second) with room for a reconnect's flush. */
const FRAMES_PER_SECOND = 150;
const CLOSE_GRACE_MS = 1_000;
const MAX_BUFFERED_BYTES = 256 * 1024;
const SWEEP_MS = 1_000;

type RawSocket = {
	emit(event: string | symbol, ...args: unknown[]): boolean;
	close(code?: number, reason?: string): void;
	terminate(): void;
	once(event: 'close', listener: () => void): void;
	readonly bufferedAmount: number;
};

const ended = new WeakSet<object>();

/** Whether the guard ended this raw socket (a room's `client.ref`). */
export const closedByGuard = (socket: unknown): boolean =>
	typeof socket === 'object' && socket !== null && ended.has(socket);

/**
 * Wrap every WebSocket the transport accepts. The hook is the WebSocket server's `connection`
 * event, prepended so it wraps the socket before Colyseus attaches its own message listener (a
 * reconnect is a new socket, so it is wrapped too). Colyseus leaves ws' `binaryType` at
 * `nodebuffer`, so every frame — text, binary, reassembled fragments — arrives as one Buffer.
 */
export function guardSockets(transport: WebSocketTransport): WebSocketTransport {
	const { wss } = transport as unknown as {
		wss: {
			prependListener(event: 'connection', listener: (socket: RawSocket) => void): void;
			once(event: 'close', listener: () => void): void;
		};
	};
	const live = new Set<RawSocket>();
	const end = (socket: RawSocket) => {
		ended.add(socket);
		socket.terminate();
	};
	const sweep = setInterval(() => {
		for (const socket of live) if (socket.bufferedAmount > MAX_BUFFERED_BYTES) end(socket);
	}, SWEEP_MS);
	sweep.unref();
	wss.once('close', () => clearInterval(sweep));

	wss.prependListener('connection', (socket) => {
		live.add(socket);
		let joined = false;
		let closing = false;
		let second = 0;
		let frames = 0;
		const timers: ReturnType<typeof setTimeout>[] = [
			setTimeout(() => {
				if (!joined) end(socket);
			}, JOIN_DEADLINE_MS),
		];
		socket.once('close', () => {
			live.delete(socket);
			for (const timer of timers) clearTimeout(timer);
		});
		const close = socket.close.bind(socket);
		socket.close = (code, reason) => {
			if (!closing) timers.push(setTimeout(() => socket.terminate(), CLOSE_GRACE_MS));
			closing = true;
			close(code ?? CloseCode.NORMAL_CLOSURE, reason);
		};
		const emit = socket.emit.bind(socket);
		socket.emit = (event, ...args) => {
			if (event !== 'message') return emit(event, ...args);
			if (closing || ended.has(socket)) return true;
			const now = Math.floor(Date.now() / 1000);
			if (now !== second) {
				second = now;
				frames = 0;
			}
			frames += 1;
			const data = args[0];
			const code = data instanceof Uint8Array ? data[0] & PROTOCOL_CODE : undefined;
			if (frames > FRAMES_PER_SECOND || code === undefined || !ALLOWED.has(code)) {
				end(socket);
				return true;
			}
			if (code === Protocol.JOIN_ROOM) joined = true;
			return emit(event, ...args);
		};
	});
	return transport;
}
