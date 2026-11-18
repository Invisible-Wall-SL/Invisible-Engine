/** Types for a Crash room's Flow signals and server values (`crashFlow.js`). */

export declare const CRASH_FLOW_EVENTS: Readonly<Record<string, string>>;

export type CrashFlowSignal = { name: string; payload: Record<string, unknown> };

export declare function crashFlowSignalsOf(
	events: readonly { type: string; [key: string]: unknown }[],
	me: string,
	team?: number,
): CrashFlowSignal[];

export type CrashRoomState = {
	step?: number;
	phase?: string;
	round?: number;
	endsAt?: number;
	winner?: string;
	scores?: ArrayLike<number>;
	players?: { get(id: string): { team?: number; status?: number } | undefined };
};

export declare function crashServerValuesOf(
	state: CrashRoomState,
	me: string,
	tickHz: number,
): {
	score: number;
	status: 'free' | 'dead';
	round: number;
	phase: string;
	secondsLeft: number;
	winner: string;
	won: boolean;
};
