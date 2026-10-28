import type {
	BetaContentBlockParam,
	BetaToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { draftPlayMessage } from '../draftReport.ts';
import type { AdapterSpec } from '../launcher.ts';
import { toolId } from '../model.ts';
import {
	ART_NOT_REPAIRED,
	REPAIR_ASSIGNABLE,
	checkSubmission,
	derivedVerified,
	leadOf,
	playVerdict,
	type PlayCounts,
	type PlayVerdict,
	type RepairSubmission,
} from '../repair.ts';
import { transition, checkpointSettings, type RunState } from '../runState.ts';
import { answerContent, cutResult } from '../toolResult.ts';
import { UNTRUSTED_OPS } from '../untrusted.ts';
import { submissionOf } from '../workerTools.ts';
import {
	compile,
	type PlayScript,
	type RepairCase,
	type RepairSet,
	type WorldAnswer,
} from './repairCase.ts';

/**
 * The scripted world a repair case runs in (ADR-0012 §6, 9G.4): the answers of every tool
 * `game-doctor` may call, from the case's canned data, in the shapes the launcher's ops return
 * (`apps/launcher-api/src/lib/server/director/ops/{gameBugs,scene,symbols,wintext,localization,
 * atlas,gamemaker,build}.ts`), and the worker tools of `workerTools.ts` over an in-memory run.
 *
 * It does what the worker does and nothing it does not:
 *  - the run state is the real `transition` (reproduce → fix → verify, `conclude`);
 *  - `run.submit_repair` goes through the real `submissionOf` and `checkSubmission`, and the stored
 *    `verified` is the real `derivedVerified` of the step's plays (`playVerdict` over each job);
 *  - an adapter answer reaches the model through the real `answerContent` (the untrusted wrapper,
 *    the image block), an error as the driver's `resultBlock`;
 *  - a play is queued and settles when the doctor ends its turn, and is then told as the worker
 *    tells it (`draftPlayMessage`); a task is not executed, it is recorded and answered the way
 *    the builder would (see `report`).
 * No bug text or screenshot reaches the model any other way than the real wrapping.
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** Apply `{ "$patch": { "a.0.b": { … } } }` over `body`: each path's object is merged into the one found there. */
export function applyPatch(body: unknown, patch: unknown): unknown {
	const out = structuredClone(body) as Record<string, unknown>;
	if (!isRecord(patch)) return out;
	for (const [path, change] of Object.entries(patch)) {
		let node: unknown = out;
		for (const key of path.split('.')) {
			node = (node as Record<string, unknown>)?.[key];
		}
		if (!isRecord(node) || !isRecord(change))
			throw new Error(`the patch path "${path}" is not an object`);
		Object.assign(node, change);
	}
	return out;
}

const answerOf = (base: WorldAnswer | undefined, given: WorldAnswer | undefined): unknown => {
	if (given === undefined) return base;
	if (isRecord(given) && '$patch' in given) return applyPatch(base, given.$patch);
	return given;
};

/** The few JSON-schema keywords the ops' input schemas use, checked as the launcher's gate does. */
export function inputProblem(
	schema: Record<string, unknown>,
	input: unknown,
	at = 'input',
): string | null {
	const type = schema.type;
	if (type === 'object') {
		if (!isRecord(input)) return `${at} must be an object`;
		const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
		for (const key of Object.keys(input)) {
			if (!(key in properties)) return `${at}.${key} is not a known field`;
		}
		for (const key of (schema.required ?? []) as string[]) {
			if (!(key in input)) return `${at}.${key} is required`;
		}
		for (const [key, value] of Object.entries(input)) {
			const problem = inputProblem(properties[key], value, `${at}.${key}`);
			if (problem) return problem;
		}
		return null;
	}
	if (type === 'string') {
		if (typeof input !== 'string') return `${at} must be a string`;
		if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(input)) {
			return `${at} does not match ${schema.pattern}`;
		}
		if (typeof schema.maxLength === 'number' && input.length > schema.maxLength) {
			return `${at} is longer than ${schema.maxLength}`;
		}
		return null;
	}
	if (type === 'array') {
		if (!Array.isArray(input)) return `${at} must be a list`;
		if (typeof schema.maxItems === 'number' && input.length > schema.maxItems) {
			return `${at} has more than ${schema.maxItems} items`;
		}
		const items = schema.items as Record<string, unknown> | undefined;
		for (const [i, item] of input.entries()) {
			const problem = items ? inputProblem(items, item, `${at}[${i}]`) : null;
			if (problem) return problem;
		}
		return null;
	}
	return null;
}

/** A task the doctor gave, and whether the world carried it out. */
export interface TaskRecord {
	agent: string;
	task: string;
	turn: number;
	/** The task fit the case's fix and was made. */
	applied: boolean;
}

export interface PlayRecord {
	jobRef: string;
	/** The run's step when it was queued: a step's plays are the ones that count for it. */
	step: string;
	draftId: string;
	/** The draft was frozen after the fix was made. */
	fixedAtDraft: boolean;
	status: 'queued' | PlayScript['status'];
	verdict: PlayVerdict | null;
}

/** What the world saw the doctor do, in order: what the scorer reads. */
export interface RepairTrace {
	calls: { id: string; input: unknown; turn: number }[];
	/** Tools the doctor called that its definition does not list. */
	outsideTools: string[];
	tasks: TaskRecord[];
	/** `run.post_activity` texts and `run.ask_owner` questions: the doctor's words to the owner. */
	activity: string[];
	plays: PlayRecord[];
	/** The accepted `run.submit_repair`, `verified` as the plays derived it. */
	submission: (RepairSubmission & { step: string }) | null;
	/** Every error the world answered, for the report. */
	errors: string[];
}

export interface WorldOptions {
	set: RepairSet;
	case: RepairCase;
	/** The doctor's tools, as its definition lists them. */
	tools: readonly string[];
	/** The adapter catalog entries by id (for the `image` and `untrusted` flags). */
	specs: ReadonlyMap<string, AdapterSpec>;
	/** The run's spend so far, for `run.get_state`. */
	spentUsd: () => number;
}

const GENERIC_REPORT =
	'I could not make a change from this task: it does not say which node, string or symbol to change, or to what. Nothing was written. Tell me exactly what to change and where.';

const OWNER_REPLY =
	'I cannot answer right now. Decide from what you can see, and conclude with run.submit_repair when you have enough.';

const resultBlock = (id: string, content: string, isError = false): BetaToolResultBlockParam => ({
	type: 'tool_result',
	tool_use_id: id,
	content: cutResult(content),
	...(isError ? { is_error: true } : {}),
});

interface Answer {
	status: number;
	body: unknown;
}
const fail = (status: number, error: string, message: string): Answer => ({
	status,
	body: { error, message },
});

export class RepairWorld {
	readonly trace: RepairTrace = {
		calls: [],
		outsideTools: [],
		tasks: [],
		activity: [],
		plays: [],
		submission: null,
		errors: [],
	};
	state: RunState;
	/** A builder or animator write landed; draft requests from now on carry it. */
	fixApplied = false;
	private writes = 0;
	private drafts = new Map<string, { fixed: boolean }>();
	private pendingTasks: { agent: string; task: string; applied: boolean; report: string }[] = [];
	private unannounced: PlayRecord[] = [];
	private owed: string[] = [];
	private turn = 0;
	private jobs = new Map<string, PlayRecord & { script: PlayScript }>();

	private readonly o: WorldOptions;

	constructor(options: WorldOptions) {
		this.o = options;
		const started = transition(
			{
				kind: 'repair',
				status: 'draft',
				step: 'reproduce',
				waitingOn: null,
				checkpoints: checkpointSettings({}),
			},
			{ type: 'start' },
		);
		if (!started.ok) throw new Error(started.error);
		this.state = started.state;
	}

	get concluded(): boolean {
		return this.trace.submission !== null;
	}

	/** The turn the next calls belong to (1-based). */
	startTurn(turn: number): void {
		this.turn = turn;
	}

	/** The answer of a read tool: the base, then this case's, then what the fix changed. */
	private body(id: string): unknown {
		const { base, cases: _cases } = this.o.set;
		let answer = answerOf(base.answers[id], this.o.case.world.answers[id]);
		if (this.fixApplied) answer = answerOf(answer, this.o.case.fix?.afterFix[id]);
		return answer;
	}

	/** One tool call of the doctor's turn, answered as the worker would answer it. */
	call(call: { id: string; name: string; input: unknown }): BetaToolResultBlockParam {
		const id = toolId(call.name);
		this.trace.calls.push({ id, input: call.input, turn: this.turn });
		if (!this.o.tools.includes(id)) {
			this.trace.outsideTools.push(id);
			return this.error(call.id, `${id} is not one of your tools.`);
		}
		if (id.startsWith('run.') || id.startsWith('costs.'))
			return this.workerTool(call.id, id, call.input);
		const spec = this.o.specs.get(id);
		if (!spec)
			return this.error(
				call.id,
				JSON.stringify({ error: 'unknown_op', message: `The eval set does not serve ${id}.` }),
			);
		const problem = inputProblem(spec.inputSchema as Record<string, unknown>, call.input);
		const answer: Answer = problem
			? fail(400, 'invalid_input', problem)
			: this.adapter(id, call.input);
		if (answer.status !== 200) return this.error(call.id, JSON.stringify(answer.body));
		return {
			type: 'tool_result',
			tool_use_id: call.id,
			content: answerContent(
				answer.body,
				spec.image === true,
				spec.untrusted === true || UNTRUSTED_OPS.has(id),
			),
		};
	}

	private error(id: string, text: string): BetaToolResultBlockParam {
		this.trace.errors.push(text.slice(0, 200));
		return resultBlock(id, text, true);
	}

	// ── The launcher's ops ───────────────────────────────────────────────────

	private image(file: string): {
		width: number;
		height: number;
		image: { mediaType: string; base64: string };
	} {
		const shot = this.o.set.images.get(file);
		if (!shot) throw new Error(`the case names a picture the set did not load: ${file}`);
		return {
			width: shot.width,
			height: shot.height,
			image: { mediaType: shot.mediaType, base64: shot.base64 },
		};
	}

	private adapter(id: string, input: unknown): Answer {
		const c = this.o.case;
		const args = (input ?? {}) as Record<string, string | string[] | undefined>;
		switch (id) {
			case 'bugs.get_game_bug':
				return {
					status: 200,
					body: {
						...c.world.bug,
						screenshots: Object.entries(c.world.screenshots).map(([shot, file]) => ({
							id: shot,
							mediaType: 'image/png',
							bytes: Buffer.from(this.image(file).image.base64, 'base64').length,
						})),
					},
				};
			case 'bugs.get_screenshot': {
				const file = c.world.screenshots[args.id as string];
				if (!file) return fail(404, 'unknown_screenshot', 'No such screenshot on this bug.');
				return { status: 200, body: { id: args.id, ...this.image(file) } };
			}
			case 'scene.get_layout': {
				const layout = this.body(id) as { screens: { id: string }[] };
				if (args.screen === undefined) return { status: 200, body: layout };
				const screens = layout.screens.filter((s) => s.id === args.screen);
				return screens.length
					? { status: 200, body: { ...layout, screens } }
					: fail(404, 'unknown_screen', `No screen "${args.screen}" in this project.`);
			}
			case 'atlas.list_regions': {
				const all = this.body(id) as { atlases: { atlas: string }[] };
				if (args.atlas === undefined) return { status: 200, body: all };
				const atlases = all.atlases.filter((a) => a.atlas === args.atlas);
				return atlases.length
					? { status: 200, body: { atlases } }
					: fail(404, 'unknown_atlas', `No atlas "${args.atlas}" in this project.`);
			}
			case 'atlas.get_region': {
				const region = this.o.set.base.regions[`${args.atlas}/${args.region}`];
				return region
					? { status: 200, body: region }
					: fail(404, 'unknown_region', `No region "${args.region}" in atlas "${args.atlas}".`);
			}
			case 'gamemaker.get_project':
			case 'symbols.get_map':
			case 'wintext.get_doc':
			case 'localization.get_strings': {
				const body = this.body(id);
				return body === undefined
					? fail(404, 'unknown_op', `The eval set has no answer for ${id}.`)
					: { status: 200, body };
			}
			case 'build.request_draft': {
				const n = this.drafts.size + 1;
				const draftId = `20261028T0900${String(10 + n)}Z-${(0xa000 + n).toString(16)}`;
				this.drafts.set(draftId, { fixed: this.fixApplied });
				return {
					status: 200,
					body: {
						draftId,
						runtime: { id: 'shared', version: '1.42.0', commit: '3f9c2ab' },
						files: 214,
						bytes: 18_204_113,
						flow: { status: 'valid', errors: [] },
						contractHash: 'c0'.repeat(32),
					},
				};
			}
			case 'build.play_draft':
				return this.playDraft(args.draftId as string, args.scenarios as string[] | undefined);
			case 'build.get_play_shot':
				return this.playShot(args.jobRef as string, args.screen as string);
		}
		return fail(404, 'unknown_op', `The eval set does not serve ${id}.`);
	}

	private playDraft(draftId: string, scenarios: string[] | undefined): Answer {
		const draft = this.drafts.get(draftId);
		if (!draft) return fail(404, 'unknown_draft', `This run has no complete draft ${draftId}.`);
		const open = [...this.jobs.values()].find((j) => j.status === 'queued');
		if (open)
			return { status: 200, body: { jobRef: open.jobRef, status: 'queued', queued: false } };
		const script = draft.fixed
			? this.o.case.world.plays.afterFix
			: this.o.case.world.plays.beforeFix;
		const jobRef = `dp_${(this.jobs.size + 1).toString(16).padStart(16, '0')}`;
		const settled = script.status !== 'finished';
		const record: PlayRecord & { script: PlayScript } = {
			jobRef,
			step: this.state.step,
			draftId,
			fixedAtDraft: draft.fixed,
			status: settled ? script.status : 'queued',
			verdict: null,
			script: this.reported(script, jobRef, draftId, scenarios),
		};
		this.jobs.set(jobRef, record);
		this.trace.plays.push(record);
		this.unannounced.push(record);
		if (settled) {
			record.verdict = playVerdict(record.status, record.script.result);
			return {
				status: 200,
				body: { jobRef, status: record.status, queued: true, result: record.script.result },
			};
		}
		return { status: 200, body: { jobRef, status: 'queued', queued: true } };
	}

	/** The job's report as the player uploads it: shots are R2 keys of this play, not the case's files. */
	private reported(
		script: PlayScript,
		jobRef: string,
		draftId: string,
		only: string[] | undefined,
	): PlayScript {
		const result = script.result as { scenarios?: Record<string, unknown>[] } | null;
		if (!isRecord(result) || !Array.isArray(result.scenarios)) return script;
		const keep = result.scenarios.filter((sc) => !only || only.includes(sc.id as string));
		return {
			status: script.status,
			result: {
				...result,
				draftId,
				scenarios: keep.map((sc) => ({
					...sc,
					shots: Object.fromEntries(
						Object.keys(sc.shots as Record<string, string>).map((screen) => [
							screen,
							`drafts/${draftId}/plays/${jobRef}/${String(sc.id)}-${screen}.png`,
						]),
					),
					__files: sc.shots,
				})),
			},
		};
	}

	private playShot(jobRef: string, screen: string): Answer {
		const job = this.jobs.get(jobRef);
		if (!job) return fail(404, 'unknown_play', `This run has no play ${jobRef}.`);
		if (job.status !== 'finished') {
			return fail(404, 'no_report', `Play ${jobRef} did not finish, so it has no screenshots.`);
		}
		const scenarios = (
			job.script.result as { scenarios: { id: string; __files: Record<string, string> }[] }
		).scenarios;
		const reached = scenarios.find((sc) => Object.hasOwn(sc.__files, screen));
		if (!reached)
			return fail(404, 'unknown_screen', `Play ${jobRef} reached no screen "${screen}".`);
		return {
			status: 200,
			body: { jobRef, scenario: reached.id, screen, ...this.image(reached.__files[screen]) },
		};
	}

	// ── The worker's tools ───────────────────────────────────────────────────

	private ok(id: string, value: unknown): BetaToolResultBlockParam {
		return resultBlock(id, JSON.stringify(value));
	}

	/** The step's plays, counted as `playsOfStep` counts a run's `director_draft_jobs`. */
	playCounts(step: string): PlayCounts {
		const counts: PlayCounts = { open: 0, requested: 0, passed: 0, failed: 0, unplayed: 0 };
		for (const play of this.trace.plays.filter((p) => p.step === step)) {
			if (play.status === 'queued') {
				counts.open++;
				continue;
			}
			if (play.verdict === null) continue;
			counts.requested++;
			counts[play.verdict]++;
		}
		return counts;
	}

	private workerTool(callId: string, id: string, raw: unknown): BetaToolResultBlockParam {
		const input = (raw ?? {}) as Record<string, unknown>;
		const text = (key: string) => String(input[key] ?? '');
		switch (id) {
			case 'run.get_state': {
				const { status, step, waitingOn } = this.state;
				return this.ok(callId, {
					budgetCapUsd: this.o.set.base.run.budgetCapUsd,
					spentUsd: this.o.spentUsd(),
					status,
					step,
					waitingOn,
				});
			}
			case 'run.post_activity':
				this.trace.activity.push(text('text'));
				return this.ok(callId, { posted: true });
			case 'run.ask_owner':
				this.trace.activity.push(text('question'));
				this.owed.push(this.o.case.world.ownerReply ?? OWNER_REPLY);
				return this.ok(callId, {
					asked: true,
					note: 'The answer arrives as an owner message in a later turn.',
				});
			case 'run.assign_task':
				return this.assignTask(callId, text('agent'), text('task'));
			case 'run.request_checkpoint': {
				if (input.kind !== 'step_done') {
					return this.error(
						callId,
						'Refused: a repair run has no region batches. Say a step is done (step_done), or conclude with run.submit_repair.',
					);
				}
				const moved = transition(this.state, { type: 'step_done' });
				if (!moved.ok) return this.error(callId, `Refused: ${moved.error}.`);
				this.state = moved.state;
				return this.ok(callId, {
					step: moved.state.step,
					note: 'No checkpoint is set here; the run moved on.',
				});
			}
			case 'run.submit_repair':
				return this.submitRepair(callId, input);
		}
		return this.error(callId, `${id} is not served by the eval world.`);
	}

	private assignTask(callId: string, agent: string, task: string): BetaToolResultBlockParam {
		const lead = leadOf('repair');
		if (agent === lead || agent === leadOf('create'))
			return this.error(callId, 'Assign to another agent.');
		if (!REPAIR_ASSIGNABLE.includes(agent)) {
			return this.error(
				callId,
				`Refused: ${ART_NOT_REPAIRED}. In a repair run only ${REPAIR_ASSIGNABLE.join(' and ')} take tasks.`,
			);
		}
		const fix = this.o.case.fix;
		const applied =
			fix !== null &&
			fix.agents.includes(agent) &&
			fix.mustMention.every((group) =>
				group.some((source) => compile(source, 'fix.mustMention').test(task)),
			);
		this.trace.tasks.push({ agent, task, turn: this.turn, applied });
		this.pendingTasks.push({
			agent,
			task,
			applied,
			report: applied ? fix!.report : GENERIC_REPORT,
		});
		return this.ok(callId, { assigned: agent });
	}

	private submitRepair(callId: string, input: Record<string, unknown>): BetaToolResultBlockParam {
		if (this.state.kind !== 'repair')
			return this.error(callId, 'Refused: this is not a repair run.');
		const claimed = submissionOf(input);
		if (typeof claimed === 'string') return this.error(callId, `Refused: ${claimed}`);
		const plays = this.playCounts(this.state.step);
		const why = checkSubmission(claimed, { step: this.state.step, fixWrites: this.writes, plays });
		if (why) return this.error(callId, `Refused: ${why}`);
		const concluded = transition(this.state, { type: 'conclude' });
		if (!concluded.ok) return this.error(callId, `Refused: ${concluded.error}.`);
		const step = this.state.step;
		this.state = concluded.state;
		this.trace.submission = { ...claimed, verified: derivedVerified(plays), step };
		return this.ok(callId, {
			checkpoint: 'repair_review',
			note: 'The owner reviews it now. End your turn.',
		});
	}

	// ── Everything that arrives while the doctor is not speaking ─────────────

	/**
	 * What the worker tells the doctor once it has ended its turn: the reports of the tasks it gave
	 * (a builder's last words, as the driver forwards them), the plays that settled and the owner's
	 * answer to a question. Null when nothing is on its way: the doctor is waiting for nothing.
	 */
	deliver(): BetaContentBlockParam[] | null {
		const out: BetaContentBlockParam[] = [];
		const say = (text: string) => out.push({ type: 'text', text });
		for (const play of this.unannounced) {
			if (play.status === 'queued') {
				const job = this.jobs.get(play.jobRef)!;
				play.status = job.script.status;
				play.verdict = playVerdict(play.status, job.script.result);
			}
			const { script } = this.jobs.get(play.jobRef)!;
			const report = publicReport(script.result);
			say(
				draftPlayMessage({
					jobRef: play.jobRef,
					status: play.status,
					draftId: play.draftId,
					result: report,
				}),
			);
		}
		this.unannounced = [];
		for (const task of this.pendingTasks) {
			if (task.applied) {
				this.fixApplied = true;
				this.writes++;
			}
			say(`Report from ${task.agent}:\n\n${task.report}`);
		}
		this.pendingTasks = [];
		if (out.length === 0 && this.owed.length > 0) say(`Owner: ${this.owed.shift()}`);
		return out.length ? out : null;
	}
}

/** The report the doctor is told: the player's own fields, not the world's file bookkeeping. */
function publicReport(result: unknown): unknown {
	if (!isRecord(result) || !Array.isArray(result.scenarios)) return result;
	return {
		...result,
		scenarios: result.scenarios.map((sc: Record<string, unknown>) => {
			const { __files: _files, ...rest } = sc;
			return rest;
		}),
	};
}
