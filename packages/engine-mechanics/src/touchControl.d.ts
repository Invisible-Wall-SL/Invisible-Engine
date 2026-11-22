import type { PointerPoint } from './pointerControl.js';

export type TouchGestures = 'hold' | 'tap' | 'both';
export type TouchSteer = 'finger' | 'stick';
export type TouchAbilityPress = 'tap' | 'target' | 'secondFinger' | 'button';
export type TouchAim = 'point' | 'ahead';

export declare const TOUCH_GESTURES: readonly TouchGestures[];
export declare const TOUCH_STEERS: readonly TouchSteer[];
export declare const TOUCH_ABILITY_PRESSES: readonly TouchAbilityPress[];
export declare const TOUCH_AIMS: readonly TouchAim[];

export type TouchScheme = {
	gestures: TouchGestures;
	steer: TouchSteer;
	deadZone: number;
	tapPx: number;
	tapMs: number;
	releaseStops: boolean;
	ability: TouchAbilityPress;
	aim: TouchAim;
	targetRadius: number;
};

export declare const TOUCH_DEFAULTS: Readonly<TouchScheme>;
export declare const STALL_MS: number;
export declare const STALL_PX: number;
export declare const MAX_PRESSES: number;

export declare function resolveTouch(scheme?: Partial<TouchScheme>): TouchScheme;

export type TouchEventIn = {
	type: 'down' | 'move' | 'up' | 'cancel';
	id: number | string;
	x: number;
	y: number;
};

export type TouchStepContext = {
	self: PointerPoint | undefined;
	toField(point: PointerPoint): PointerPoint | undefined;
	now: number;
	playing: boolean;
	keys: boolean;
	still: boolean;
	pressed: boolean;
	onTarget?(at: PointerPoint): boolean;
};

export type TouchStep = {
	move?: { moveX: number; moveY: number };
	press?: { aim?: PointerPoint };
};

export type TouchControl = {
	event(e: TouchEventIn, now: number): void;
	button(): void;
	release(): void;
	held(): boolean;
	step(ctx: TouchStepContext): TouchStep;
};

export declare function createTouchControl(scheme?: Partial<TouchScheme>): TouchControl;

export type PressLatch = {
	press(code: string): void;
	lift(code: string): void;
	clear(): void;
	held(): Set<string>;
	take(): Set<string>;
};

export declare function createPressLatch(): PressLatch;
