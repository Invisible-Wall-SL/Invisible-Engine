/**
 * WHO A DEVICE IS, for the per-address limits (`server.ts`, `socketGuard.ts`, `arcadeRoom.ts`):
 * its address's key, and what that address holds — open sockets and seats held for a dropped
 * player to rejoin, counted together under one cap, so dropping and rejoining cannot gather seats
 * beyond it — and which reconnection tokens its held seats wait for, so the one socket that
 * reclaims a seat may pass a full address's cap and no other.
 */

/**
 * The key a per-address limit counts under: an IPv4 address (an IPv4-mapped IPv6 one unwrapped),
 * or an IPv6 address's /64 — one host is routinely given a whole /64, so a full address would let
 * it count as countless devices.
 */
export function addressKey(address: string): string {
	const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
	if (v4) return v4[1];
	if (!address.includes(':')) return address;
	const [head, tail = ''] = address.split('%')[0].toLowerCase().split('::');
	const left = head ? head.split(':') : [];
	const right = address.includes('::') && tail ? tail.split(':') : [];
	const groups = address.includes('::')
		? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
		: left;
	return `${groups
		.slice(0, 4)
		.map((g) => g.replace(/^0+(?=.)/, ''))
		.join(':')}::/64`;
}

/** Open sockets plus held seats, by address key; and the held seats alone. One process holds
 *  one book. */
const holding = new Map<string, number>();
/** Held seats' reconnection tokens (the raw token a reconnecting device's URL carries) → address. */
const tokens = new Map<string, string>();

/** Where each accepted upgrade came from, for the socket it becomes. */
const requestAddress = new WeakMap<object, string>();
const socketAddress = new WeakMap<object, string>();

/** What an address holds now. */
export const heldBy = (address: string): number => holding.get(address) ?? 0;

const add = (book: Map<string, number>, address: string, by: number) => {
	const next = (book.get(address) ?? 0) + by;
	if (next > 0) book.set(address, next);
	else book.delete(address);
};

/** Count one more open socket for `address` … */
export const hold = (address: string): void => add(holding, address, 1);

/** … and one fewer. */
export const release = (address: string): void => add(holding, address, -1);

/** Count a seat held for `address`'s dropped player, waiting for `token`, until it is reclaimed or
 *  let go. */
export const holdSeat = (address: string, token: string): void => {
	add(holding, address, 1);
	tokens.set(token, address);
};

/** The held seat is reclaimed or let go. */
export const releaseSeat = (address: string, token: string): void => {
	add(holding, address, -1);
	if (tokens.get(token) === address) tokens.delete(token);
};

/** Whether `token` reclaims a seat held for `address` (and so may pass its full cap, once). */
export const reclaims = (address: string, token: string | null): boolean =>
	token !== null && tokens.get(token) === address;

/** Remember an accepted upgrade's address (`server.ts`) … */
export const noteRequest = (req: object, address: string): void => {
	requestAddress.set(req, address);
};

/** … and pass it to the socket it becomes (`socketGuard.ts`). */
export const noteSocket = (socket: object, req: object): void => {
	const address = requestAddress.get(req);
	if (address !== undefined) socketAddress.set(socket, address);
};

/** The address of a room client's raw socket (`client.ref`), if the server accepted it. */
export const addressOfSocket = (socket: unknown): string | undefined =>
	typeof socket === 'object' && socket !== null ? socketAddress.get(socket) : undefined;
