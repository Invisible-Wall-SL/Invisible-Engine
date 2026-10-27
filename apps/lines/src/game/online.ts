import type { Room } from 'engine-rooms';
import { BUTTONS, MOVE_SCALE, clampInput, createFixedStep, type FixedStep } from 'engine-mechanics';
import { spawnStore } from 'engine-layout/svelte';
import { normalizeGameConfigDoc, onlineGameOf, type OnlineGame } from 'game-config';

import { bakedGameConfig, refuseOnlineBoot } from '../editor-scenes';
import { typingInto } from './flowKeys';

/**
 * THE RUNTIME'S ONLINE BRANCH (`docs/design/realtime-multiplayer.md` §10; P10.14) — for an arcade
 * game whose config has `arcade.online` (`ARCADE_ONLINE_MECHANIC`).
 *
 * The boot joins a room on the game server ({@link joinOnlineRoom}, from `+layout.ts`) before the
 * game mounts; `<ArcadeStage />` then ticks {@link tickOnline}: one input a fixed step, read from
 * the keyboard and clamped exactly as the server clamps it, and every player of the room drawn
 * where the server last put it, as a spawned instance of its character's component in the play
 * field's spawn layer. Nothing is predicted or smoothed yet (P10.15), and the device never decides
 * a place: it sends inputs only.
 *
 * Launch parameters: `?rooms_url=` the game server (`wss://rooms.invisiblewall.org`), the game
 * key `?rooms_game=` (else `?project=`), and optionally `?rooms_name=` / `?rooms_character=`.
 * `engine-rooms` (`@colyseus/sdk`) is imported only here, on this path, so an offline game never
 * loads it.
 */

/** The game server's room type (`services/game-server/src/server.ts` `ROOM_NAME`). */
const ROOM_NAME = 'arcade';

/** Colyseus' close code for a leave the device asked for. */
const CONSENTED = 4000;

type PlayerState = {
	character: string;
	x: number;
	y: number;
	connected: boolean;
};
type RoomState = { step: number; players: Map<string, PlayerState> };

type Session = {
	room: Room;
	game: OnlineGame;
	clock: FixedStep;
	seq: number;
	/** Room player id → the instance it is drawn as. */
	drawn: Map<string, string>;
	refused: Set<string>;
};

let session: Session | undefined;

const MOVE_KEYS: Record<string, [number, number]> = {
	ArrowLeft: [-1, 0],
	KeyA: [-1, 0],
	ArrowRight: [1, 0],
	KeyD: [1, 0],
	ArrowUp: [0, -1],
	KeyW: [0, -1],
	ArrowDown: [0, 1],
	KeyS: [0, 1],
};
const held = new Set<string>();

const onKey = (event: KeyboardEvent) => {
	if (!(event.code in MOVE_KEYS) && event.code !== 'Space') return;
	if (event.type === 'keydown' && typingInto(event.target)) return;
	// The arrows and Space would otherwise scroll a page the game sits in.
	event.preventDefault();
	if (event.type === 'keydown') held.add(event.code);
	else held.delete(event.code);
};
const releaseAll = () => held.clear();

/** The input the held keys make, before the clamp. */
const keyInput = (seq: number) => {
	let x = 0;
	let y = 0;
	for (const code of held) {
		const move = MOVE_KEYS[code];
		if (move) {
			x += move[0];
			y += move[1];
		}
	}
	return {
		seq,
		moveX: Math.sign(x) * MOVE_SCALE,
		moveY: Math.sign(y) * MOVE_SCALE,
		buttons: held.has('Space') ? BUTTONS.jump : 0,
		aimX: 0,
		aimY: 0,
	};
};

/**
 * Join a room of this game, or stop the boot on the error screen saying why: the config cannot be
 * played online, the launch names no server or game, or the server cannot be reached or refused
 * the join (full, unknown character).
 */
export async function joinOnlineRoom(): Promise<void> {
	const resolved = onlineGameOf(normalizeGameConfigDoc(bakedGameConfig()) ?? null);
	if (!resolved) return refuseOnlineBoot('the config is not an online game');
	if ('refused' in resolved) return refuseOnlineBoot(resolved.refused);
	const params = new URLSearchParams(window.location.search);
	const url = params.get('rooms_url');
	const game = params.get('rooms_game') || params.get('project');
	if (!url) return refuseOnlineBoot('the launch names no game server (?rooms_url=)');
	if (!game) return refuseOnlineBoot('the launch names no game (?rooms_game=)');
	let room: Room;
	try {
		const { Client } = await import('engine-rooms');
		room = await new Client(url).joinOrCreate(ROOM_NAME, {
			game,
			name: params.get('rooms_name') ?? undefined,
			character: params.get('rooms_character') ?? undefined,
		});
	} catch (error) {
		return refuseOnlineBoot(
			`the game server did not let it in (${error instanceof Error ? error.message : String(error)})`,
		);
	}
	// A room that is gone for good (disposed, a kick, a reconnect that ran out) leaves nothing to
	// play: say so on the same screen rather than freeze on the last state.
	room.onLeave((code: number) => {
		session = undefined;
		if (code !== CONSENTED) void refuseOnlineBoot(`the room closed (code ${code})`, true);
	});
	session = {
		room,
		game: resolved,
		clock: createFixedStep({ hz: resolved.online.tickHz }),
		seq: 0,
		drawn: new Map(),
		refused: new Set(),
	};
}

/** Start reading the keyboard; returns the stop. */
export function listenOnline(): () => void {
	window.addEventListener('keydown', onKey);
	window.addEventListener('keyup', onKey);
	window.addEventListener('blur', releaseAll);
	return () => {
		window.removeEventListener('keydown', onKey);
		window.removeEventListener('keyup', onKey);
		window.removeEventListener('blur', releaseAll);
		releaseAll();
	};
}

/** The room's synced state, in the shape `services/game-server/src/schema.ts` declares. */
const stateOf = (room: Room): Partial<RoomState> => room.state as Partial<RoomState>;

/** Put every player of the room where the server last placed it. */
function draw(current: Session) {
	const live = spawnStore();
	const { layer } = current.game.online;
	const players = stateOf(current.room).players;
	if (!players) return;
	for (const [id, instance] of current.drawn) {
		if (!players.has(id)) {
			live.despawn(instance);
			current.drawn.delete(id);
		}
	}
	const moves: { id: string; x: number; y: number }[] = [];
	players.forEach((player, id) => {
		const instance = current.drawn.get(id);
		if (instance) {
			moves.push({ id: instance, x: player.x, y: player.y });
			return;
		}
		const character = current.game.online.characters.find((c) => c.id === player.character);
		if (!character) return;
		const spawned = live.spawn(layer, character.body, { x: player.x, y: player.y });
		if (spawned.ok) current.drawn.set(id, spawned.instance.id);
		else if (!current.refused.has(character.body)) {
			current.refused.add(character.body);
			console.warn(
				`[online] cannot draw "${character.body}" in the layer "${layer}" (${spawned.reason})`,
			);
		}
	});
	live.move(moves);
}

/** One frame: the inputs its fixed steps hold, then the room as the server last sent it. */
export function tickOnline(dtMs: number) {
	const current = session;
	if (!current) return;
	current.clock.advance(dtMs, () => {
		current.seq += 1;
		const handle = current.room.input();
		Object.assign(handle.data, clampInput(keyInput(current.seq), current.game.field));
		handle.send();
	});
	draw(current);
}

/** The room as the determinism probe reads it: the server's step and the bodies drawn. */
export function onlineProbe() {
	const players = session ? stateOf(session.room).players : undefined;
	const bodies: { id: string; x: number; y: number; vx: number; vy: number; tags: string[] }[] = [];
	players?.forEach((p, id) => bodies.push({ id, x: p.x, y: p.y, vx: 0, vy: 0, tags: [] }));
	return { steps: (session && stateOf(session.room).step) || 0, bodies };
}
