/**
 * The `saved_by` stamp a doc carries to name who saved it last — the field the Python writers
 * already stamp (`services/_shared/iw_common/docsave.py`) and Invisible Director stamps on every
 * doc it writes (`tool: 'director'`, the agent and the run).
 *
 * The stamp names the LAST save only. A save that passes none (a person saving from the tool's
 * own page) drops a stamp it would otherwise carry over, so a Director stamp never outlives the
 * write it describes.
 */
export interface SavedByStamp {
	uid: string;
	name: string;
	tool: string;
	at: string;
	rev: string;
	agent?: string;
	runId?: string;
}

/** `doc` with its `saved_by` replaced by `savedBy`, or removed when there is none. */
export function stampSavedBy<T extends object>(
	doc: T,
	savedBy: SavedByStamp | undefined,
): T & { saved_by?: SavedByStamp } {
	const out = { ...doc } as Record<string, unknown>;
	delete out.saved_by;
	if (savedBy) out.saved_by = savedBy;
	return out as T & { saved_by?: SavedByStamp };
}
