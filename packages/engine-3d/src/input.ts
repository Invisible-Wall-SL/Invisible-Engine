import { BUTTON_JUMP, BUTTON_SPRINT } from 'engine-mechanics/src/motion3d.js';

/** The keys held now, as camera-relative stick axes and button bits. */
export type Keys3d = {
	read(): { right: number; forward: number; buttons: number };
	release(): void;
};

const RIGHT = new Set(['ArrowRight', 'KeyD']);
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const JUMP = new Set(['Space']);
const SPRINT = new Set(['ShiftLeft', 'ShiftRight']);
const GAME_KEYS = [RIGHT, LEFT, UP, DOWN, JUMP, SPRINT];

/**
 * Keyboard play for the 3D field: arrows or WASD move relative to the camera, Space jumps, Shift
 * sprints. Keys are read by `code`, so the layout of the player's keyboard does not move them. A
 * focused text field keeps its keys; a lost window focus lets go of everything.
 */
export function listenKeys3d(target: Window): Keys3d {
	const held = new Set<string>();
	const typing = (event: KeyboardEvent) => {
		const el = event.target as HTMLElement | null;
		return !!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
	};
	const down = (event: KeyboardEvent) => {
		if (typing(event) || !GAME_KEYS.some((set) => set.has(event.code))) return;
		held.add(event.code);
		event.preventDefault();
	};
	const up = (event: KeyboardEvent) => {
		held.delete(event.code);
	};
	const clear = () => held.clear();
	target.addEventListener('keydown', down);
	target.addEventListener('keyup', up);
	target.addEventListener('blur', clear);
	const any = (set: Set<string>) => [...set].some((code) => held.has(code));
	return {
		read: () => ({
			right: (any(RIGHT) ? 1 : 0) - (any(LEFT) ? 1 : 0),
			forward: (any(UP) ? 1 : 0) - (any(DOWN) ? 1 : 0),
			buttons: (any(JUMP) ? BUTTON_JUMP : 0) | (any(SPRINT) ? BUTTON_SPRINT : 0),
		}),
		release: () => {
			target.removeEventListener('keydown', down);
			target.removeEventListener('keyup', up);
			target.removeEventListener('blur', clear);
			held.clear();
		},
	};
}
