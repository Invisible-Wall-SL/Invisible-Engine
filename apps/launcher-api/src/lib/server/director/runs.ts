import { createHash } from 'node:crypto';
import { DEFAULT_GAME_KIND } from 'constants-shared/gameKinds';
import {
	estimateRun,
	parseEstimateProfiles,
	type DirectorPricing,
	type RunEstimate,
} from 'director-costs';
import { PROJECT_KEY_WORDS } from '$lib/projectKey';
import { roleHasTool } from '$lib/roles';
import profilesFile from '../../../../../../services/director-worker/estimate-profiles.json';
import type { Checkpoint } from '../../../../../../services/director-worker/src/runState';
import { getDirectorRunBudget } from '../appSettings';
import { clientExists, mayCreateUnderClient } from '../clients';
import { getDirectorPricing } from '../costs/pricingConfig';
import { getRoleOverrides } from '../roleToolAccess';
import { getToolOverrides } from '../userToolAccess';
import type { DirectorRun, Project } from '../db/schema';
import { duplicateProject } from '../duplicateProject';
import { loadGameConfigDocWithEtag } from '../gameConfigStorage';
import { selectableGameKinds } from '../gameKinds';
import { listGamesOwnedByProject } from '../games';
import { UNASSIGNED_CLIENT } from '../projectPaths';
import {
	canAccessProject,
	isValidProjectKey,
	listDirectorTemplateProjects,
	projectExists,
	projectKeyTaken,
	projectName,
} from '../projects';
import { DIRECTOR_AGENTS } from './adapter';
import {
	MAX_MOCKUPS,
	loadMockupsDoc,
	ownershipRefusal,
	pendingDocOwnedBy,
	type MockupsDoc,
} from './mockups';
import {
	MAX_MESSAGE_LENGTH,
	MAX_NOTE_LENGTH,
	REQUEST_ID,
	actionRefusal,
	allowedOwnerActions,
	isOwnerAction,
	ownerEventRow,
	raisedCap,
	runStateOf,
	type OwnerAction,
	type OwnerActionRequest,
	type Stamp,
} from './ownerActions';
import {
	agentConversations,
	appendOwnerEvent,
	deleteDraftRun,
	findOwnerRequest,
	getRun,
	STALE_CLAIM_MS,
	insertDraftRun,
	lastEventId,
	latestCheckpointOpen,
	listRuns,
	runSpendTotals,
	setRunConfigEtags,
	updateDraftStartingPoint,
} from './store';
import { loadSummaryContext, summarizeProject, type ProjectSummary } from './templates';

/**
 * The owner side of an Invisible Director run (PLAN 4A; ADR-0003, ADR-0005, ADR-0006): what the
 * New-game, Mockup-breakdown and Live-run screens call. The launcher creates the run as a `draft`
 * and from then on only APPENDS the owner's rows to `director_events`; the worker moves the run.
 *
 * Creating a run creates the game first, the way Game Maker does (SPEC §1.1): the same fields and
 * validation as its `create` action, then the template copied through the duplicate path (scope
 * `full`), with the template's config ETag recorded for the math-lock check — the same work
 * `gamemaker.create_from_template` does for the worker. The run row is inserted BEFORE the copy
 * and claims the key (`project_create_started_at`), so a copy that dies half-way is finished by a
 * replayed create, never repeated over a project in use.
 *
 * Every write takes a client-supplied `requestId` and replays to the same answer: a create's run
 * id is derived from it, so the second insert finds the first; an action is claimed in
 * `director_ops` (`store.ts` `appendOwnerEvent`), and a resend is answered from that ledger BEFORE
 * any other check — the worker is woken by NOTIFY, so by the time a resend arrives the run has
 * usually moved on, and judging the resend by the new state would refuse what was recorded.
 *
 * The budget cap is the worker's to copy onto the run at start (ADR-0006), not the launcher's at
 * create; the estimate reports the cap a run started now would get.
 */

/** The estimate profiles beside `pricing.json`, validated once at load. */
export const ESTIMATE_PROFILES = parseEstimateProfiles(profilesFile);

export class RunError extends Error {
	constructor(
		readonly status: 400 | 403 | 404 | 409 | 413 | 502,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'RunError';
	}
}

type User = NonNullable<App.Locals['user']>;

// ── Preset and checkpoints ────────────────────────────────────────────────────

/** Render sizes a preset may name, in pixels on the side. */
export const RESOLUTIONS = [512, 768, 1024, 1536, 2048] as const;
export const MAX_VARIANTS_PER_REGION = 8;
const BLUEPRINT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** The art agents' settings (SPEC §1.1 "Preset"), stored on the run as `preset_json`. */
export interface RunPreset {
	/** An Atlas Maker blueprint id (`_shared/blueprints/<id>`). */
	blueprint: string;
	draftPx: number;
	finalPx: number;
	variantsPerRegion: number;
	/** A GPU named in `pricing.json`, so the estimate and the cap can price its renders. */
	gpu: string;
}

/** The built-in blueprint every run can start from; the GPU is pricing.json's first. */
export const DEFAULT_PRESET: Omit<RunPreset, 'gpu'> = {
	blueprint: 'sdxl',
	draftPx: 512,
	finalPx: 1024,
	variantsPerRegion: 3,
};

export const pricedGpus = (pricing: DirectorPricing): string[] =>
	Object.keys(pricing.runpod.perSecondByGpu);

export function defaultPreset(pricing: DirectorPricing): RunPreset {
	return { ...DEFAULT_PRESET, gpu: pricedGpus(pricing)[0] ?? '' };
}

const bad = (code: string, message: string) => new RunError(400, code, message);

function record(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function resolution(value: unknown, field: string, fallback: number): number {
	if (value === undefined) return fallback;
	if (!(RESOLUTIONS as readonly unknown[]).includes(value)) {
		throw bad('bad_preset', `${field} is one of ${RESOLUTIONS.join(', ')} px.`);
	}
	return value as number;
}

/** A preset from the request, every field defaulting to `defaultPreset`. */
export function parsePreset(raw: unknown, pricing: DirectorPricing): RunPreset {
	const r = record(raw);
	const base = defaultPreset(pricing);
	const blueprint = r.blueprint === undefined ? base.blueprint : r.blueprint;
	if (typeof blueprint !== 'string' || !BLUEPRINT_ID.test(blueprint)) {
		throw bad('bad_preset', 'The blueprint is an Atlas Maker blueprint id.');
	}
	const variants = r.variantsPerRegion === undefined ? base.variantsPerRegion : r.variantsPerRegion;
	if (
		typeof variants !== 'number' ||
		!Number.isInteger(variants) ||
		variants < 1 ||
		variants > MAX_VARIANTS_PER_REGION
	) {
		throw bad(
			'bad_preset',
			`Variants per region is a whole number from 1 to ${MAX_VARIANTS_PER_REGION}.`,
		);
	}
	const gpu = r.gpu === undefined ? base.gpu : r.gpu;
	if (typeof gpu !== 'string' || !pricedGpus(pricing).includes(gpu)) {
		throw bad('bad_preset', `The GPU is one of ${pricedGpus(pricing).join(', ')}.`);
	}
	return {
		blueprint,
		draftPx: resolution(r.draftPx, 'draftPx', base.draftPx),
		finalPx: resolution(r.finalPx, 'finalPx', base.finalPx),
		variantsPerRegion: variants,
		gpu,
	};
}

/** The owner's checkpoint settings as stored (`checkpoints_json`); `before_publish` is never off. */
export interface RunCheckpoints {
	breakdown: boolean;
	regionBatch: boolean;
}

export const DEFAULT_CHECKPOINTS: RunCheckpoints = { breakdown: true, regionBatch: true };

export function parseCheckpoints(raw: unknown): RunCheckpoints {
	const r = record(raw);
	const flag = (field: 'breakdown' | 'regionBatch'): boolean => {
		const value = r[field];
		if (value === undefined) return DEFAULT_CHECKPOINTS[field];
		if (typeof value !== 'boolean') throw bad('bad_checkpoints', `${field} is true or false.`);
		return value;
	};
	return { breakdown: flag('breakdown'), regionBatch: flag('regionBatch') };
}

// ── Starting point ────────────────────────────────────────────────────────────

/** Mockups, fidelity, notes and the ownership check, as stored on the run (`starting_point_json`). */
export interface StartingPoint {
	notes: string;
	fidelity: MockupsDoc['fidelity'];
	mockups: { id: string; tag: string; styleOnly: boolean }[];
	/** Copied from `mockups.json` (ADR-0005 "Ownership"); the run header shows it. */
	ownershipConfirmed: MockupsDoc['ownershipConfirmed'];
}

export const MAX_NOTES_LENGTH = 8000;

export function startingPointOf(doc: MockupsDoc, notes: string): StartingPoint {
	return {
		notes,
		fidelity: doc.fidelity,
		mockups: doc.images.map(({ id, tag, styleOnly }) => ({ id, tag, styleOnly })),
		ownershipConfirmed: doc.ownershipConfirmed,
	};
}

function parseNotes(raw: unknown): string {
	const notes = typeof raw === 'string' ? raw.trim() : '';
	if (notes.length > MAX_NOTES_LENGTH) {
		throw bad('notes_too_long', `Notes are at most ${MAX_NOTES_LENGTH} characters.`);
	}
	return notes;
}

/**
 * The project's mockups as a run may start from them: the ownership check is required whenever
 * there are mockups (SPEC §1.1), and notes are required when there are none — a style board needs
 * something to go on. At a create the project is still PENDING, so its mockups must be the
 * creator's own (`pendingDocOwnedBy`, the rule every pending-scope request passes): another
 * person's uploads under a free key are theirs, and the create is refused like an inaccessible
 * project. At a start the project exists and its own access rule has applied.
 */
async function startingPointFor(
	clientKey: string | null,
	projectKey: string,
	notes: string,
	creator: User | null,
): Promise<StartingPoint> {
	const { doc } = await loadMockupsDoc(clientKey ?? UNASSIGNED_CLIENT, projectKey);
	if (creator && !pendingDocOwnedBy(doc, creator.id)) {
		throw new RunError(
			403,
			'project_forbidden',
			`You do not have access to the project "${projectKey}".`,
		);
	}
	const refusal = ownershipRefusal(doc);
	if (refusal) throw new RunError(409, 'ownership_required', refusal);
	if (doc.images.length === 0 && !notes) {
		throw bad('notes_required', 'Describe the style in the notes, or upload mockups.');
	}
	return startingPointOf(doc, notes);
}

// ── Templates ─────────────────────────────────────────────────────────────────

/** A template is a published project an admin marked for Director (Q1) that `user` can open. */
async function usableTemplates(user: User): Promise<Project[]> {
	const out: Project[] = [];
	for (const p of await listDirectorTemplateProjects()) {
		if (!(await canAccessProject(user.id, user.role, p.key))) continue;
		if ((await listGamesOwnedByProject(p.key)).length === 0) continue;
		out.push(p);
	}
	return out;
}

/** The templates the New-game screen offers, for one game kind or all of them. */
export async function listTemplates(
	user: User,
	gameType: string | null,
): Promise<ProjectSummary[]> {
	const usable = (await usableTemplates(user)).filter(
		(p) => gameType === null || (p.gameType || DEFAULT_GAME_KIND) === gameType,
	);
	const ctx = await loadSummaryContext();
	return Promise.all(usable.map((p) => summarizeProject(p, ctx)));
}

async function requireTemplate(user: User, key: string): Promise<Project> {
	const template = (await usableTemplates(user)).find((p) => p.key === key);
	if (!template)
		throw new RunError(404, 'unknown_template', `"${key}" is not a Director template.`);
	return template;
}

// ── Create ────────────────────────────────────────────────────────────────────

export interface CreateRunInput {
	requestId: unknown;
	key: unknown;
	name: unknown;
	clientKey: unknown;
	gameType: unknown;
	template: unknown;
	notes: unknown;
	preset: unknown;
	checkpoints: unknown;
}

export interface CreatedRun {
	run: DirectorRun;
	/** True when this request id had already created the run. */
	replayed: boolean;
}

/** A run id from who asks and their request id, so the same request makes the same run once. */
export const runIdFor = (ownerUserId: string, requestId: string): string =>
	createHash('sha256')
		.update(`director-run|${ownerUserId}|${requestId}`)
		.digest('hex')
		.slice(0, 32);

function parseRequestId(raw: unknown): string {
	if (typeof raw !== 'string' || !REQUEST_ID.test(raw)) {
		throw bad('bad_request_id', 'requestId is 8 to 64 letters, digits, _ or -.');
	}
	return raw;
}

/**
 * Copy the template into the run's project, as `gamemaker.create_from_template` does: through
 * Game Maker's duplicate path, recording the template's config ETag before and after so the
 * math-lock QA can tell a copy nobody chose (null when the template moved meanwhile). Always a
 * copy: a project that exists by now is another request's (409 `project_exists`), never this
 * run's to adopt. A replayed create resumes only by calling this while its project is missing.
 */
async function copyTemplate(
	user: User,
	run: Pick<DirectorRun, 'id' | 'projectKey' | 'clientKey' | 'templateProjectKey'>,
	template: Project,
	name: string,
): Promise<void> {
	const templateClient = template.clientKey ?? UNASSIGNED_CLIENT;
	const before = await loadGameConfigDocWithEtag(templateClient, template.key);
	const made = await duplicateProject(user, {
		source: template.key,
		key: run.projectKey,
		name,
		clientKey: run.clientKey,
		scope: 'full',
	});
	if (!made.ok) {
		throw new RunError(
			made.status,
			made.status === 409 ? 'project_exists' : 'create_failed',
			made.error,
		);
	}
	const [after, copy] = await Promise.all([
		loadGameConfigDocWithEtag(templateClient, template.key),
		loadGameConfigDocWithEtag(run.clientKey ?? UNASSIGNED_CLIENT, run.projectKey),
	]);
	const templateConfigEtag = before.etag === after.etag ? before.etag : null;
	await setRunConfigEtags(run.id, { template: templateConfigEtag, project: copy.etag });
}

/** Creating a game is Game Maker's to allow: the duplicate path assumes its caller holds it. */
async function holdsGameMaker(user: User): Promise<boolean> {
	return roleHasTool(
		user.role,
		'gameMaker',
		await getRoleOverrides(user.role),
		await getToolOverrides(user.id),
	);
}

export async function createRun(user: User, input: CreateRunInput): Promise<CreatedRun> {
	const requestId = parseRequestId(input.requestId);
	if (!(await holdsGameMaker(user))) {
		throw new RunError(403, 'game_maker_required', 'Creating a game needs Invisible Game Maker.');
	}
	const key = String(input.key ?? '')
		.toLowerCase()
		.trim();
	const name = String(input.name ?? '').trim();
	const rawClient = String(input.clientKey ?? '').trim();
	const clientKey = rawClient === '' ? null : rawClient;
	const gameType = String(input.gameType ?? '').trim();
	const templateKey = String(input.template ?? '').trim();

	// The same checks, in the same words, as Game Maker's `create` action.
	if (!isValidProjectKey(key)) throw bad('bad_key', PROJECT_KEY_WORDS);
	if (!name) throw bad('name_required', 'Name is required.');
	if (gameType !== '' && !(await selectableGameKinds()).some((k) => k.id === gameType)) {
		throw bad('unknown_game_kind', 'Unknown game kind.');
	}
	const template = await requireTemplate(user, templateKey);
	const templateType = template.gameType || DEFAULT_GAME_KIND;
	if (gameType !== '' && templateType !== gameType) {
		throw bad('template_kind', `"${template.key}" is a ${templateType} game, not ${gameType}.`);
	}
	if (clientKey !== null && !(await clientExists(clientKey))) {
		throw bad('unknown_client', 'Unknown client.');
	}
	if (!(await mayCreateUnderClient(user.id, user.role, clientKey))) {
		throw new RunError(403, 'client_forbidden', 'You do not have access to that client.');
	}

	const runId = runIdFor(user.id, requestId);
	const existing = await getRun(runId);
	if (existing) {
		// The same request again — and it must be the same request: another key, client or
		// template under this id is a client bug, refused like a reused opId.
		const same =
			existing.projectKey === key &&
			(existing.clientKey ?? null) === clientKey &&
			existing.templateProjectKey === template.key;
		if (!same) {
			throw new RunError(409, 'request_id_reused', `${requestId} already created another run.`);
		}
		// Its project is finished if the first attempt died mid-copy — once that attempt can no
		// longer be running: a resend while the first call is still copying would copy too, and
		// whichever lost would delete a draft the other's project needs.
		if (existing.status === 'draft' && !(await projectExists(existing.projectKey))) {
			const startedAt = existing.projectCreateStartedAt?.getTime() ?? 0;
			if (startedAt > Date.now() - STALE_CLAIM_MS) {
				throw new RunError(409, 'in_progress', 'This request is still being created.');
			}
			await copyTemplate(user, existing, template, name);
		}
		return { run: existing, replayed: true };
	}

	if (await projectExists(key)) throw bad('key_exists', 'A project with that key exists.');
	if (await projectKeyTaken(key)) {
		throw bad(
			'key_deleted',
			`"${key}" is a deleted project. An admin can restore or purge it in /admin.`,
		);
	}

	const notes = parseNotes(input.notes);
	const pricing = (await getDirectorPricing()).pricing;
	const preset = parsePreset(input.preset, pricing);
	const checkpoints = parseCheckpoints(input.checkpoints);
	const startingPoint = await startingPointFor(clientKey, key, notes, user);

	const row = {
		id: runId,
		projectKey: key,
		clientKey,
		templateProjectKey: template.key,
		ownerUserId: user.id,
		presetJson: preset,
		startingPointJson: startingPoint,
		checkpointsJson: checkpoints,
	};
	if (!(await insertDraftRun(row))) {
		// Lost a race with the same request id; that call made the run.
		const made = await getRun(runId);
		if (!made) throw new RunError(409, 'in_progress', 'This request is still being created.');
		return { run: made, replayed: true };
	}
	try {
		await copyTemplate(user, row, template, name);
	} catch (e) {
		// A draft with no project is nothing to come back to; the next create starts clean.
		await deleteDraftRun(runId);
		throw e;
	}
	const run = await getRun(runId);
	if (!run) throw new RunError(502, 'create_failed', 'The run was not stored.');
	return { run, replayed: false };
}

// ── Owner actions ─────────────────────────────────────────────────────────────

export interface OwnerActionOutcome {
	action: OwnerAction;
	eventId: number;
	replayed: boolean;
}

const CHECKPOINT_IDS: readonly string[] = ['breakdown', 'region_batch', 'before_publish'];

function parseAction(raw: unknown): OwnerActionRequest {
	const r = record(raw);
	if (!isOwnerAction(r.action)) throw bad('bad_action', 'Unknown action.');
	const req: OwnerActionRequest = { action: r.action, requestId: parseRequestId(r.requestId) };
	if (r.checkpoint !== undefined) {
		if (typeof r.checkpoint !== 'string' || !CHECKPOINT_IDS.includes(r.checkpoint)) {
			throw bad('bad_checkpoint', `The checkpoint is one of ${CHECKPOINT_IDS.join(', ')}.`);
		}
		req.checkpoint = r.checkpoint as Checkpoint;
	}
	if (r.note !== undefined) {
		if (typeof r.note !== 'string' || r.note.length > MAX_NOTE_LENGTH) {
			throw bad('bad_note', `A note is text of at most ${MAX_NOTE_LENGTH} characters.`);
		}
		if (r.note.trim()) req.note = r.note.trim();
	}
	if (req.action === 'message') {
		const text = typeof r.text === 'string' ? r.text.trim() : '';
		if (!text) throw bad('text_required', 'Write the message.');
		if (text.length > MAX_MESSAGE_LENGTH) {
			throw bad('bad_text', `A message is at most ${MAX_MESSAGE_LENGTH} characters.`);
		}
		req.text = text;
	}
	if (r.budgetCapUsd !== undefined) {
		if (req.action !== 'resume') throw bad('bad_cap', 'Only a resume can raise the cap.');
		if (typeof r.budgetCapUsd !== 'number' || !Number.isFinite(r.budgetCapUsd)) {
			throw bad('bad_cap', 'budgetCapUsd is a number.');
		}
		req.budgetCapUsd = r.budgetCapUsd;
	}
	return req;
}

/**
 * Append the owner's action to the run: one `director_events` row the worker consumes, refused
 * up front with the worker's own reason when the run's state does not allow it (409
 * `not_allowed`). A start also needs the project to exist and the mockups' ownership confirmed
 * — the New-game form may have added mockups after the run was created — and refreshes the
 * run's starting point from the project's doc before the row goes in.
 *
 * A resend is answered first, from the ledger, whatever the run's state by now: the same
 * `requestId` with the same body (hashed as SENT, before the defaults and the clamp below) gets
 * the recorded event id with `replayed: true`; with another body it is `request_id_reused`.
 */
export async function performOwnerAction(
	user: User,
	run: DirectorRun,
	raw: unknown,
): Promise<OwnerActionOutcome> {
	const req = parseAction(raw);
	const { requestId, ...sent } = req;
	const inputHash = createHash('sha256').update(JSON.stringify(sent)).digest('hex');
	// A claim a crash left `pending` blocks its id only for the stale window: the event and its
	// record are one transaction, so nothing was written, and `appendOwnerEvent` reclaims it then.
	const prior = await findOwnerRequest(run.id, requestId);
	const live =
		prior && (prior.status === 'done' || prior.createdAt.getTime() > Date.now() - STALE_CLAIM_MS);
	if (prior && live) {
		if (prior.op !== `owner.${req.action}` || prior.inputHash !== inputHash) {
			throw new RunError(
				409,
				'request_id_reused',
				`${requestId} was already used for another action.`,
			);
		}
		if (prior.status !== 'done') {
			throw new RunError(409, 'in_progress', `${requestId} is still being written.`);
		}
		const { eventId } = prior.result as { eventId: number };
		return { action: req.action, eventId, replayed: true };
	}

	const state = runStateOf(run);
	const refusal = actionRefusal(state, req.action, req.checkpoint ?? state.waitingOn);
	if (refusal) throw new RunError(409, 'not_allowed', `Refused: ${refusal}.`);
	if (req.action === 'approve' || req.action === 'revise') req.checkpoint ??= state.waitingOn!;

	if (req.action === 'resume' && req.budgetCapUsd !== undefined) {
		const raised = raisedCap(run.budgetCapUsd, req.budgetCapUsd);
		if (raised === null) {
			throw bad('cap_not_raised', 'The cap can only be raised, within the bounds Settings allows.');
		}
		req.budgetCapUsd = raised;
	}

	if (req.action === 'start') {
		if (!(await projectExists(run.projectKey))) {
			throw new RunError(
				409,
				'project_missing',
				'The project was not created. Create the run again with the same request id.',
			);
		}
		const notes = (run.startingPointJson as Partial<StartingPoint> | null)?.notes ?? '';
		await updateDraftStartingPoint(
			run.id,
			await startingPointFor(run.clientKey, run.projectKey, notes, null),
		);
	}

	const by: Stamp = { uid: user.id, name: user.name ?? user.email };
	const row = ownerEventRow(req, by);
	const outcome = await appendOwnerEvent({
		runId: run.id,
		requestId,
		action: req.action,
		inputHash,
		kind: row.kind,
		payload: row.payload,
	});
	if ('conflict' in outcome) {
		throw new RunError(
			409,
			outcome.conflict === 'reused' ? 'request_id_reused' : 'in_progress',
			outcome.conflict === 'reused'
				? `${requestId} was already used for another action.`
				: `${requestId} is still being written.`,
		);
	}
	return { action: req.action, eventId: outcome.eventId, replayed: outcome.replayed };
}

// ── Summaries ─────────────────────────────────────────────────────────────────

export type AgentStatus = 'not_started' | 'queued' | 'working' | 'idle';

export interface RunSummary {
	id: string;
	name: string | null;
	projectKey: string;
	clientKey: string | null;
	templateProjectKey: string;
	status: DirectorRun['status'];
	step: DirectorRun['step'];
	waitingOn: DirectorRun['waitingOn'];
	checkpoints: RunCheckpoints & { beforePublish: true };
	preset: unknown;
	startingPoint: unknown;
	/** False until the template copy made the project (a draft whose create died mid-way). */
	projectCreated: boolean;
	spend: {
		claudeUsd: number;
		runpodUsd: number;
		totalUsd: number;
		capUsd: number | null;
		remainingUsd: number | null;
	};
	/** The open checkpoint while the run waits on the owner (or the budget one while paused). */
	checkpoint: {
		id: number;
		at: string;
		agent: string;
		checkpoint: string;
		payload: unknown;
	} | null;
	agents: { agent: string; status: AgentStatus; at: string | null }[];
	allowedActions: OwnerAction[];
	/** Where the live stream picks up (`Last-Event-ID`). */
	lastEventId: number;
	createdAt: string;
	updatedAt: string;
}

const AGENTS = DIRECTOR_AGENTS.filter((a) => a !== 'worker');

/**
 * The agents a run is priced for, each at the model its definition names (the fixture pins the
 * profiles to the definitions), in registry order: what the New-game panel lists under "Agents".
 */
export function agentProfiles(): { agent: string; model: string }[] {
	const models = new Map<string, string>();
	for (const profiles of Object.values(ESTIMATE_PROFILES.claude)) {
		for (const profile of profiles) models.set(profile.agent, profile.model);
	}
	return AGENTS.filter((agent) => models.has(agent)).map((agent) => ({
		agent,
		model: models.get(agent)!,
	}));
}

const round = (usd: number) => Math.round(usd * 10000) / 10000;

export async function summarizeRun(run: DirectorRun): Promise<RunSummary> {
	const [name, created, spendByRun, latest, conversations, lastId] = await Promise.all([
		projectName(run.projectKey),
		projectExists(run.projectKey),
		runSpendTotals([run.id]),
		latestCheckpointOpen(run.id),
		agentConversations(run.id),
		lastEventId(run.id),
	]);
	const spend = spendByRun.get(run.id) ?? { claudeUsd: 0, runpodUsd: 0 };
	const totalUsd = spend.claudeUsd + spend.runpodUsd;
	const state = runStateOf(run);

	const opened = latest ? (latest.payloadJson as { checkpoint?: unknown }).checkpoint : undefined;
	const checkpointOpen =
		latest !== null &&
		((run.status === 'waiting' && opened === run.waitingOn) ||
			(run.status === 'paused' && opened === 'budget'));

	const byAgent = new Map(conversations.map((c) => [c.agent, c]));
	const agents = AGENTS.map((agent) => {
		const c = byAgent.get(agent);
		const status: AgentStatus = !c
			? 'not_started'
			: c.lastRole === 'user'
				? 'queued'
				: c.hasToolUse
					? 'working'
					: 'idle';
		return { agent, status, at: c ? c.at.toISOString() : null };
	});

	return {
		id: run.id,
		name,
		projectKey: run.projectKey,
		clientKey: run.clientKey,
		templateProjectKey: run.templateProjectKey,
		status: run.status,
		step: run.step,
		waitingOn: run.waitingOn,
		checkpoints: { ...state.checkpoints },
		preset: run.presetJson,
		startingPoint: run.startingPointJson,
		projectCreated: created,
		spend: {
			claudeUsd: round(spend.claudeUsd),
			runpodUsd: round(spend.runpodUsd),
			totalUsd: round(totalUsd),
			capUsd: run.budgetCapUsd,
			remainingUsd: run.budgetCapUsd === null ? null : round(run.budgetCapUsd - totalUsd),
		},
		checkpoint:
			checkpointOpen && latest
				? {
						id: latest.id,
						at: latest.at.toISOString(),
						agent: latest.agent,
						checkpoint: String(opened),
						payload: latest.payloadJson,
					}
				: null,
		agents,
		allowedActions: allowedOwnerActions(state),
		lastEventId: lastId,
		createdAt: run.createdAt.toISOString(),
		updatedAt: run.updatedAt.toISOString(),
	};
}

export interface RunListEntry {
	id: string;
	name: string | null;
	projectKey: string;
	clientKey: string | null;
	templateProjectKey: string;
	status: DirectorRun['status'];
	step: DirectorRun['step'];
	waitingOn: DirectorRun['waitingOn'];
	budgetCapUsd: number | null;
	spentUsd: number;
	createdAt: string;
	updatedAt: string;
}

/** The caller's runs, newest first — inside `projectKey` when given. */
export async function listRunSummaries(
	user: User,
	projectKey: string | undefined,
): Promise<RunListEntry[]> {
	const runs = await listRuns({ ownerUserId: user.id, projectKey });
	const spend = await runSpendTotals(runs.map((r) => r.id));
	const names = new Map<string, string | null>();
	for (const key of new Set(runs.map((r) => r.projectKey))) {
		names.set(key, await projectName(key));
	}
	return runs.map((run) => {
		const s = spend.get(run.id) ?? { claudeUsd: 0, runpodUsd: 0 };
		return {
			id: run.id,
			name: names.get(run.projectKey) ?? null,
			projectKey: run.projectKey,
			clientKey: run.clientKey,
			templateProjectKey: run.templateProjectKey,
			status: run.status,
			step: run.step,
			waitingOn: run.waitingOn,
			budgetCapUsd: run.budgetCapUsd,
			spentUsd: round(s.claudeUsd + s.runpodUsd),
			createdAt: run.createdAt.toISOString(),
			updatedAt: run.updatedAt.toISOString(),
		};
	});
}

// ── Estimate ──────────────────────────────────────────────────────────────────

export interface EstimateRequest {
	template: unknown;
	/** Mockups the analyst will read (style references excluded). */
	mockups: unknown;
	preset: unknown;
	checkpoints: unknown;
}

export interface EstimateAnswer {
	estimate: RunEstimate;
	/** The cap a run started now would get (Settings), for the panel to show the estimate against. */
	budgetCapUsd: number;
	template: {
		key: string;
		name: string;
		regions: number;
		regionGroups: ProjectSummary['regionGroups'];
	};
	preset: RunPreset;
	checkpoints: RunCheckpoints;
}

/**
 * The New-game panel's estimate (ADR-0006 "Estimate"): the template's region counts, the mockup
 * count, the preset and the checkpoints through the estimate profiles at the current prices. Reads
 * the template's manifests from R2 and nothing else — no RunPod call, no model call.
 */
export async function estimateForTemplate(
	user: User,
	raw: EstimateRequest,
): Promise<EstimateAnswer> {
	const template = await requireTemplate(user, String(raw.template ?? '').trim());
	const mockups = raw.mockups === undefined ? 0 : raw.mockups;
	if (typeof mockups !== 'number' || !Number.isInteger(mockups) || mockups < 0) {
		throw bad('bad_mockups', 'mockups is a count.');
	}
	const budgetCapUsd = await getDirectorRunBudget();
	const pricing = (await getDirectorPricing()).pricing;
	const preset = parsePreset(raw.preset, pricing);
	const checkpoints = parseCheckpoints(raw.checkpoints);
	const summary = await summarizeProject(template, await loadSummaryContext());
	const regions = summary.regionGroups.reduce((n, g) => n + g.regions, 0);
	return {
		estimate: estimateRun(
			{
				regions,
				// No more can be uploaded, so no more can be analysed.
				mockups: Math.min(mockups, MAX_MOCKUPS),
				variantsPerRegion: preset.variantsPerRegion,
				draftPx: preset.draftPx,
				finalPx: preset.finalPx,
				gpu: preset.gpu,
				checkpoints,
			},
			ESTIMATE_PROFILES,
			pricing,
		),
		budgetCapUsd,
		template: {
			key: template.key,
			name: template.name,
			regions,
			regionGroups: summary.regionGroups,
		},
		preset,
		checkpoints,
	};
}
