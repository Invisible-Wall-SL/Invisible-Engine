import type { FontRequestEntry } from '$lib/server/director/fontRequests';
import type { MockupsDoc } from '$lib/server/director/mockups';
import type {
	EstimateAnswer,
	RunCheckpoints,
	RunListEntry,
	RunPreset,
	RunSummary,
	StartingPoint,
} from '$lib/server/director/runs';
import type { ProjectSummary } from '$lib/server/director/templates';

/**
 * The browser side of Invisible Director's owner API (PLAN 4A), shared by the New-game and the
 * run screens: the answer shapes (type-only imports of the server's own, so the page and the
 * route cannot drift), one fetch that turns a refusal into `ApiRefusal`, and the request ids every
 * write carries. A request id is made ONCE per intent and kept across retries, so a resend after
 * a lost connection — and a double click — is replayed by the server to the same answer.
 */

export type { EstimateAnswer, FontRequestEntry, MockupsDoc, RunListEntry, RunSummary };

/**
 * The analyst's breakdown as the worker stores it in the `breakdown` checkpoint's payload
 * (`services/director-worker/src/mockups/analyze.ts` `Breakdown`, elements as `rules.ts`
 * `CodedElement`), named here field for field: the worker's sources import with `.ts` extensions
 * the launcher's TypeScript config does not accept, so the page cannot import the type itself.
 */
export type ElementStatus = 'matched' | 'needs_you' | 'left_out';

export interface CodedElement {
	n: number;
	/** In the pixels of the model's copy of the image (`BreakdownImage.w` × `h`). */
	box: { x: number; y: number; w: number; h: number };
	name: string;
	regions: string[];
	status: ElementStatus;
	reason: string;
	lockedItem: { id: string; label: string } | null;
}

export interface BreakdownImage {
	id: string;
	file: string;
	tag: string;
	styleOnly: boolean;
	w: number;
	h: number;
	elements: CodedElement[];
	model: string | null;
}

export interface Breakdown {
	version: 1;
	fidelity: 'match' | 'start';
	images: BreakdownImage[];
	palette: { name: string; hex: string }[];
	paletteDropped: { name: string; hex: string; nearest: string; distance: number }[];
	fontGaps: { text: string; styleNote: string; imageId: string }[];
	uncoveredRegions: string[];
	regionsTotal: number;
	regionsMatched: number;
	crops: {
		saved: { region: string; key: string; imageId: string }[];
		skipped: { region: string; imageId: string; reason: string }[];
	} | null;
}

export interface TemplatesAnswer {
	templates: ProjectSummary[];
	gameKinds: { id: string; name: string }[];
	clients: { key: string; name: string }[];
	agents: { agent: string; model: string }[];
	preset: {
		default: RunPreset;
		resolutions: readonly number[];
		maxVariantsPerRegion: number;
		gpus: string[];
	};
	checkpoints: RunCheckpoints;
	estimatePlaceholder: boolean;
}

export interface MockupsAnswer {
	doc: MockupsDoc;
	pending: boolean;
	limits: { maxBytes: number; maxFiles: number; fidelities: readonly string[] };
	startRefusal: string | null;
}

export interface ActionAnswer {
	action: string;
	eventId: number;
	replayed: boolean;
	run: RunSummary;
}

/** One frame of the run's live stream (`eventStream.ts` `frameEvent`). */
export interface RunEvent {
	id: number;
	at: string;
	agent: string;
	kind: string;
	tool: string | null;
	payload: Record<string, unknown> | null;
}

export type { RunPreset, RunCheckpoints, StartingPoint };

/** A refusal the server answered: `{ error: code, message }` at a 4xx or 5xx. */
export class ApiRefusal extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'ApiRefusal';
	}
}

/** The connection dropped before an answer: the same request id may be resent. */
export class NetworkLost extends Error {
	constructor() {
		super('The connection was lost before the server answered.');
		this.name = 'NetworkLost';
	}
}

export const isRefusal = (e: unknown, ...codes: string[]): e is ApiRefusal =>
	e instanceof ApiRefusal && (codes.length === 0 || codes.includes(e.code));

export const describe = (e: unknown): string =>
	e instanceof Error ? e.message : 'Something went wrong.';

/** `crypto.randomUUID()` is 36 characters of the shape the server accepts (8–64 of `[A-Za-z0-9_-]`). */
export const newRequestId = (): string => crypto.randomUUID();

async function readRefusal(res: Response): Promise<ApiRefusal> {
	let code = `http_${res.status}`;
	let message = res.statusText || `The server answered ${res.status}.`;
	try {
		const body = (await res.json()) as { error?: unknown; message?: unknown };
		if (typeof body.error === 'string') code = body.error;
		if (typeof body.message === 'string') message = body.message;
	} catch {
		// Not JSON: the status line is the message.
	}
	return new ApiRefusal(res.status, code, message);
}

/** One JSON call. A non-2xx is thrown as `ApiRefusal`; a failed fetch as `NetworkLost`. */
export async function api<T>(
	url: string,
	init: { method?: 'GET' | 'POST'; json?: unknown; form?: FormData } = {},
): Promise<T> {
	let res: Response;
	try {
		res = await fetch(url, {
			method: init.method ?? (init.json !== undefined || init.form ? 'POST' : 'GET'),
			headers: init.json !== undefined ? { 'content-type': 'application/json' } : undefined,
			body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
			credentials: 'same-origin',
		});
	} catch {
		throw new NetworkLost();
	}
	if (!res.ok) throw await readRefusal(res);
	return (await res.json()) as T;
}

const RETRY_DELAYS_MS = [500, 1500, 3000];

/**
 * A write with a request id: resent, with the SAME body, when the connection drops before an
 * answer — the server replays the id to the recorded answer, so a resend never writes twice.
 */
export async function resend<T>(url: string, body: Record<string, unknown>): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await api<T>(url, { json: body });
		} catch (e) {
			if (!(e instanceof NetworkLost) || attempt >= RETRY_DELAYS_MS.length) throw e;
			await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
		}
	}
}

/** The project query of a Director request: the key, and the client while the project is pending. */
export function projectQuery(projectKey: string, clientKey: string | null): string {
	const q = new URLSearchParams({ project: projectKey });
	if (clientKey) q.set('client', clientKey);
	return q.toString();
}

export const mockupImageUrl = (projectKey: string, clientKey: string | null, id: string) =>
	`/api/director/mockups/image?${projectQuery(projectKey, clientKey)}&id=${encodeURIComponent(id)}`;

/** `version` changes with the breakdown (its checkpoint event id), so a revise is not served stale. */
export const cropUrl = (runId: string, region: string, version: number) =>
	`/api/director/runs/${encodeURIComponent(runId)}/crop?region=${encodeURIComponent(region)}&v=${version}`;

/** The agents' short descriptions beside their names; the model comes from the server. */
export const AGENT_BLURBS: Record<string, { name: string; does: string }> = {
	coordinator: { name: 'Coordinator', does: 'Plans the run and talks to you' },
	'mockup-analyst': {
		name: 'Mockup analyst',
		does: 'Reads your mockups and maps each element to the template',
	},
	'art-director': { name: 'Art director', does: 'Reviews every variant before you see it' },
	'atlas-artist': { name: 'Atlas artist', does: 'Atlas Maker · ComfyUI' },
	animator: { name: 'Animator', does: 'Rigger · Flipbook · Symbols SM' },
	builder: { name: 'Builder', does: 'Scene Editor · Win Text · Localization' },
	qa: { name: 'QA', does: 'Sizes, alpha, sheet budget, plays the build' },
};

/** `claude-opus-5-5` → `Opus 5.5`, `claude-haiku-4-5-20251001` → `Haiku 4.5`. */
export function modelLabel(model: string): string {
	const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(model);
	if (!m) return model;
	return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`;
}

/** `$6`, `$12.5`, `$0.40`: whole dollars stay whole, cents show only below $10. */
export const usd = (n: number): string => {
	if (n >= 100) return `$${Math.round(n)}`;
	if (Number.isInteger(n)) return `$${n}`;
	return n >= 10 ? `$${n.toFixed(1)}` : `$${n.toFixed(2)}`;
};

export const usdRange = (r: { low: number; high: number }): string =>
	`~${usd(r.low)}–${usd(r.high).slice(1)}`;

export const RUN_STEPS: { id: RunSummary['step']; n: number; label: string }[] = [
	{ id: 'breakdown', n: 1, label: 'Mockup breakdown' },
	{ id: 'style_pack', n: 2, label: 'Style pack' },
	{ id: 'regions', n: 3, label: 'Regions' },
	{ id: 'build', n: 4, label: 'Build' },
	{ id: 'handoff', n: 5, label: 'Hand-off' },
];

export const stepNumber = (step: RunSummary['step']): number =>
	RUN_STEPS.find((s) => s.id === step)?.n ?? 1;

/** The status pill's words. */
export function statusLabel(run: Pick<RunSummary, 'status' | 'step' | 'waitingOn'>): string {
	const at = `step ${stepNumber(run.step)} of ${RUN_STEPS.length}`;
	switch (run.status) {
		case 'draft':
			return 'Not started';
		case 'running':
			return `Agents working · ${at}`;
		case 'waiting':
			return `Waiting for you · ${at}`;
		case 'paused':
			return `Paused · ${at}`;
		case 'stopping':
			return 'Stopping';
		case 'stopped':
			return 'Stopped';
		case 'failed':
			return 'Failed';
		case 'handed_off':
			return 'Handed off';
	}
}

export function elapsed(fromIso: string, now: number): string {
	const mins = Math.max(0, Math.floor((now - Date.parse(fromIso)) / 60_000));
	if (mins < 60) return `${mins} min`;
	const hours = Math.floor(mins / 60);
	if (hours < 48) return `${hours} h ${mins % 60} min`;
	return `${Math.floor(hours / 24)} d`;
}
