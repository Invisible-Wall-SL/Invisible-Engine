/**
 * What a section of `check:characters-tool` kept in its own file is handed: the gate's own
 * counters. `check` counts one verdict; `same` compares two values as JSON with sorted keys.
 */
export interface Harness {
	check: (name: string, ok: boolean, detail?: string) => void;
	same: (name: string, actual: unknown, expected: unknown) => void;
}

export type Section = (t: Harness) => void | Promise<void>;
