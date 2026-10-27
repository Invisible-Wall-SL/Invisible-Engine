import { randomBytes } from 'node:crypto';
import { SUB } from '../projectPaths';

/**
 * QA's draft play (ADR-0010): where a run's drafts live, their ids, and the seam to the draft
 * player. The seam is empty until a fixture sets it; `draftJobs.ts` falls back to the HTTP player
 * `DRAFT_PLAYER_URL` names, and with neither a play settles at once as `no_player` (ADR-0010 §3).
 */

/** The snapshot id format, `20261027T101530Z-3fa9`, as a schema pattern. */
export const DRAFT_ID = '^\\d{8}T\\d{6}Z-[0-9a-f]{4}$';
export const DRAFT_JOB_REF = '^dp_[0-9a-f]{16}$';
export const SCENARIO = '^[A-Za-z0-9_.-]{1,64}$';

/** Drafts a run keeps: `request_draft` deletes the older ones. */
export const RETAINED_DRAFTS = 2;

export const newDraftJobRef = () => `dp_${randomBytes(8).toString('hex')}`;

/** `<client>/<project>/director/drafts/` — everything a run's drafts write sits under it. */
export const draftsPrefix = (client: string, project: string) =>
	`${SUB.director(client, project)}/drafts/`;

export const draftPrefix = (client: string, project: string, draftId: string) =>
	`${draftsPrefix(client, project)}${draftId}/`;

/** `draft.json`: what a draft is, written before `runtime.json`, which is always last. */
export interface DraftMeta {
	draftId: string;
	runId: string;
	runtime: { id: string; version: string; commit: string };
	contractHash: string;
	contract: unknown;
	projectConfigEtag: string | null;
	flow: 'absent' | 'valid' | 'invalid';
	createdAt: string;
}

/** What the launcher hands the player for one play. */
export interface DraftPlayJob {
	jobRef: string;
	runId: string;
	clientKey: string;
	projectKey: string;
	/** The project's game kind: which script the player plays. */
	gameType: string;
	draftId: string;
	scenarios: string[] | null;
}

/** What the player says of a play on `/progress`; `unknown` when it does not know the job. */
export interface DraftProgress {
	status: 'queued' | 'running' | 'finished' | 'failed' | 'unknown';
	/** The play report (ADR-0010 §4) of a finished play. */
	report?: Record<string, unknown>;
	/** Why a failed play failed. */
	error?: string;
}

/**
 * The launcher's link to the draft player. `submit` resolves once the player has taken the job.
 * `progress` feeds the fallback watch; a player without it is settled by its callback alone.
 */
export interface DraftPlayer {
	submit(job: DraftPlayJob): Promise<void>;
	progress?(jobRef: string): Promise<DraftProgress>;
	/** Best-effort: stop a play that is no longer wanted. */
	cancel?(jobRef: string): Promise<void>;
}

let player: DraftPlayer | null = null;

/** The player a fixture installed, or null. Callers use `activeDraftPlayer()`. */
export const getDraftPlayer = (): DraftPlayer | null => player;

/** Install (or clear) the player: the fixtures' seam, and where the real client will be wired. */
export function setDraftPlayer(next: DraftPlayer | null): void {
	player = next;
}

export const NO_PLAYER_RESULT = {
	reason: 'no_player',
	message: 'No draft player is deployed, so the draft was not played.',
} as const;
