export type PointerMouseMode = 'hover' | 'press';

export declare const POINTER_MOUSE_MODES: readonly PointerMouseMode[];

export declare const POINTER_DEFAULTS: Readonly<{
	mouse: PointerMouseMode;
	deadZone: number;
	tapPx: number;
}>;

export type PointerEventIn = {
	type: 'down' | 'move' | 'up' | 'cancel';
	id: number | string;
	kind: 'mouse' | 'touch' | 'pen' | string;
	x: number;
	y: number;
	button?: number;
};

export type PointerPoint = { x: number; y: number };

export type PointerTracker = {
	event(e: PointerEventIn): void;
	target(): PointerPoint | undefined;
	takeTap(): PointerPoint | undefined;
	release(): void;
};

export declare function createPointerTracker(options?: {
	mouse?: PointerMouseMode;
	tapPx?: number;
}): PointerTracker;

export declare function pointerMove(
	self: PointerPoint | undefined,
	target: PointerPoint | undefined,
	deadZone?: number,
): { moveX: number; moveY: number };
