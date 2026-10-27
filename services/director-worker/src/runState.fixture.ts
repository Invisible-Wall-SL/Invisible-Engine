/**
 * The run state machine (PLAN 3.3, ADR-0003):
 *
 *   pnpm --filter director-worker check:run-state
 *
 * Pinned:
 *  - the TABLE: every (status, step, open checkpoint) a run can be in × every event, with what it
 *    leads to or that it is refused. Every combination is listed — a new status, step or event that
 *    the table does not cover fails here rather than defaulting to anything;
 *  - "before publishing" cannot be skipped: no settings turn it off, no event sequence reaches
 *    `handed_off` without approving it, and from `build` the only way on is through it;
 *  - a repair run (ADR-0012) has its own steps and its one checkpoint, `repair_review`, always on:
 *    only the worker's `conclude` opens it, only approving it hands off, `verify` has no
 *    `step_done`, and each kind refuses the other's events and checkpoints;
 *  - optional checkpoints follow the settings, and default ON;
 *  - the launcher schema's check constraints list exactly these statuses, steps and checkpoints.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	CHECKPOINTS,
	CREATE_STEPS,
	REPAIR_OUTCOMES,
	REPAIR_STEPS,
	RUN_EVENT_TYPES,
	RUN_KINDS,
	RUN_STATUSES,
	RUN_STEPS,
	TERMINAL_STATUSES,
	checkpointSettings,
	transition,
	type Checkpoint,
	type CheckpointSettings,
	type RunEvent,
	type RunKind,
	type RunState,
	type RunStatus,
	type RunStep,
} from './runState.ts';

let failures = 0;
const check = (ok: boolean, msg: string, extra = '') => {
	if (!ok) console.log(`  ✗ ${msg}${extra}`);
	if (!ok) failures++;
	return ok;
};
let passed = 0;
const pass = (ok: boolean, msg: string, extra = '') => {
	if (check(ok, msg, extra)) passed++;
};

const ALL_ON = checkpointSettings({});
const ALL_OFF = checkpointSettings({ breakdown: false, regionBatch: false, artPlan: false });

const state = (
	status: RunStatus,
	step: RunStep,
	waitingOn: Checkpoint | null = null,
	checkpoints: CheckpointSettings = ALL_ON,
	kind: RunKind = 'create',
): RunState => ({ kind, status, step, waitingOn, checkpoints });
/** A repair run's states are keyed `repair:`; a create run's keys are unchanged. */
const key = (s: RunState) =>
	`${s.kind === 'repair' ? 'repair:' : ''}${s.status}/${s.step}${s.waitingOn ? `@${s.waitingOn}` : ''}`;
const stepsOf = (kind: RunKind): readonly RunStep[] => [
	...(kind === 'repair' ? REPAIR_STEPS : CREATE_STEPS),
	'handoff',
];

/** One sample event per type; `resolve` is expanded per checkpoint and decision below. */
const EVENTS: RunEvent[] = [
	{ type: 'start' },
	{ type: 'step_done' },
	{ type: 'batch_done' },
	{ type: 'plan_ready' },
	{ type: 'conclude' },
	...CHECKPOINTS.flatMap((checkpoint) =>
		(['approve', 'revise'] as const).map((decision): RunEvent => ({
			type: 'resolve',
			checkpoint,
			decision,
		})),
	),
	{ type: 'pause', reason: 'owner' },
	{ type: 'pause', reason: 'budget_cap' },
	{ type: 'pause', reason: 'refusal' },
	{ type: 'pause', reason: 'error' },
	{ type: 'resume' },
	{ type: 'stop' },
	{ type: 'stopped' },
	{ type: 'fail', reason: 'fixture' },
];
const eventKey = (e: RunEvent) =>
	e.type === 'resolve' ? `resolve:${e.checkpoint}:${e.decision}` : e.type;

/** Every state a run can be in: the open checkpoint is set only while waiting, and only where the
 *  machine opens it. */
const STATES: RunState[] = [];
for (const status of RUN_STATUSES) {
	for (const step of stepsOf('create')) {
		if (status === 'waiting') {
			if (step === 'breakdown') STATES.push(state(status, step, 'breakdown'));
			if (step === 'regions') STATES.push(state(status, step, 'region_batch'));
			if (step === 'style_pack' || step === 'regions') {
				STATES.push(state(status, step, 'art_plan'));
			}
			if (step === 'handoff') STATES.push(state(status, step, 'before_publish'));
		} else if (status === 'handed_off') {
			if (step === 'handoff') STATES.push(state(status, step));
		} else if (status === 'draft') {
			if (step === 'breakdown') STATES.push(state(status, step));
		} else {
			STATES.push(state(status, step));
		}
	}
	for (const step of stepsOf('repair')) {
		const at = (waitingOn: Checkpoint | null = null) =>
			STATES.push(state(status, step, waitingOn, ALL_ON, 'repair'));
		if (status === 'waiting') {
			if (step === 'handoff') at('repair_review');
		} else if (status === 'handed_off') {
			if (step === 'handoff') at();
		} else if (status === 'draft') {
			if (step === 'reproduce') at();
		} else {
			at();
		}
	}
}

/**
 * THE TABLE. `from → { event → to }`, all checkpoints on. An event a row does not list is refused.
 * The live statuses also accept `stop` and `fail`, added below rather than repeated per row.
 */
const LEGAL: Record<string, Record<string, string>> = {
	'draft/breakdown': { start: 'running/breakdown' },
	'repair:draft/reproduce': { start: 'repair:running/reproduce' },

	'running/breakdown': { step_done: 'waiting/breakdown@breakdown' },
	'running/style_pack': { step_done: 'running/regions', plan_ready: 'waiting/style_pack@art_plan' },
	'running/regions': {
		step_done: 'running/build',
		batch_done: 'waiting/regions@region_batch',
		plan_ready: 'waiting/regions@art_plan',
	},
	'running/build': { step_done: 'waiting/handoff@before_publish' },
	'running/handoff': {},

	'repair:running/reproduce': {
		step_done: 'repair:running/fix',
		conclude: 'repair:waiting/handoff@repair_review',
	},
	'repair:running/fix': {
		step_done: 'repair:running/verify',
		conclude: 'repair:waiting/handoff@repair_review',
	},
	'repair:running/verify': { conclude: 'repair:waiting/handoff@repair_review' },
	'repair:running/handoff': {},

	'waiting/breakdown@breakdown': {
		'resolve:breakdown:approve': 'running/style_pack',
		'resolve:breakdown:revise': 'running/breakdown',
	},
	'waiting/style_pack@art_plan': {
		'resolve:art_plan:approve': 'running/style_pack',
		'resolve:art_plan:revise': 'running/style_pack',
	},
	'waiting/regions@art_plan': {
		'resolve:art_plan:approve': 'running/regions',
		'resolve:art_plan:revise': 'running/regions',
	},
	'waiting/regions@region_batch': {
		'resolve:region_batch:approve': 'running/regions',
		'resolve:region_batch:revise': 'running/regions',
	},
	'waiting/handoff@before_publish': {
		'resolve:before_publish:approve': 'handed_off/handoff',
		'resolve:before_publish:revise': 'running/build',
	},
	'repair:waiting/handoff@repair_review': {
		'resolve:repair_review:approve': 'repair:handed_off/handoff',
		'resolve:repair_review:revise': 'repair:running/fix',
	},

	'stopping/breakdown': {},
	'stopping/style_pack': {},
	'stopping/regions': {},
	'stopping/build': {},
	'stopping/handoff': {},

	'stopped/breakdown': {},
	'stopped/style_pack': {},
	'stopped/regions': {},
	'stopped/build': {},
	'stopped/handoff': {},
	'failed/breakdown': {},
	'failed/style_pack': {},
	'failed/regions': {},
	'failed/build': {},
	'failed/handoff': {},
	'handed_off/handoff': {},

	'repair:stopping/reproduce': {},
	'repair:stopping/fix': {},
	'repair:stopping/verify': {},
	'repair:stopping/handoff': {},
	'repair:stopped/reproduce': {},
	'repair:stopped/fix': {},
	'repair:stopped/verify': {},
	'repair:stopped/handoff': {},
	'repair:failed/reproduce': {},
	'repair:failed/fix': {},
	'repair:failed/verify': {},
	'repair:failed/handoff': {},
	'repair:handed_off/handoff': {},
};
for (const kind of RUN_KINDS) {
	const p = kind === 'repair' ? 'repair:' : '';
	for (const step of stepsOf(kind)) {
		for (const reason of ['owner', 'budget_cap', 'refusal', 'error']) {
			LEGAL[`${p}running/${step}`][`pause:${reason}`] = `${p}paused/${step}`;
		}
		LEGAL[`${p}paused/${step}`] = { resume: `${p}running/${step}` };
		LEGAL[`${p}stopping/${step}`].stopped = `${p}stopped/${step}`;
	}
}
for (const s of STATES) {
	const k = key(s);
	if (TERMINAL_STATUSES.includes(s.status)) continue;
	LEGAL[k] ??= {};
	const p = s.kind === 'repair' ? 'repair:' : '';
	if (s.status !== 'stopping') LEGAL[k].stop = `${p}stopping/${s.step}`;
	LEGAL[k].fail = `${p}failed/${s.step}`;
}
const pauseKey = (e: RunEvent) => (e.type === 'pause' ? `pause:${e.reason}` : eventKey(e));

console.log('transition table');
{
	const covered = new Set(STATES.map(key));
	const extra = Object.keys(LEGAL).filter((k) => !covered.has(k));
	pass(extra.length === 0, 'the table lists only reachable states', ` — ${extra.join()}`);
	const missing = [...covered].filter((k) => !(k in LEGAL));
	pass(missing.length === 0, 'the table lists every state', ` — ${missing.join()}`);
	pass(
		new Set(EVENTS.map((e) => e.type)).size === RUN_EVENT_TYPES.length,
		'every event type is exercised',
	);

	let legal = 0;
	let refused = 0;
	for (const from of STATES) {
		for (const event of EVENTS) {
			const expected = LEGAL[key(from)]?.[pauseKey(event)];
			const result = transition(from, event);
			const label = `${key(from)} + ${pauseKey(event)}`;
			if (expected === undefined) {
				pass(!result.ok, `${label} is refused`, ` — went to ${result.ok && key(result.state)}`);
				refused++;
			} else {
				pass(
					result.ok && key(result.state) === expected,
					`${label} → ${expected}`,
					` — got ${result.ok ? key(result.state) : result.error}`,
				);
				legal++;
			}
			if (result.ok) {
				pass(
					(result.state.status === 'waiting') === (result.state.waitingOn !== null),
					`${label}: an open checkpoint exactly while waiting`,
				);
				pass(result.state.checkpoints === from.checkpoints, `${label}: settings carried`);
			} else {
				pass(result.error.startsWith(`${event.type} is not allowed`), `${label}: says why`);
			}
		}
	}
	console.log(`  ✓ ${legal} legal and ${refused} refused transitions match the table`);
	const frozen = Object.freeze(state('running', 'build'));
	pass(transition(frozen, { type: 'step_done' }).ok, 'pure: the input state is not mutated');
}

console.log('optional checkpoints follow the settings');
{
	const off = (status: RunStatus, step: RunStep) => state(status, step, null, ALL_OFF);
	const r1 = transition(off('running', 'breakdown'), { type: 'step_done' });
	pass(r1.ok && key(r1.state) === 'running/style_pack', 'breakdown off → straight to style_pack');
	const r2 = transition(off('running', 'regions'), { type: 'batch_done' });
	pass(r2.ok && key(r2.state) === 'running/regions', 'region batch off → keep going');
	const r4 = transition(off('running', 'style_pack'), { type: 'plan_ready' });
	pass(r4.ok && key(r4.state) === 'running/style_pack', 'art plan off → keep going');
	const r5 = transition(off('running', 'regions'), { type: 'plan_ready', ownerOnly: true });
	pass(
		r5.ok && key(r5.state) === 'waiting/regions@art_plan',
		'art plan off, but a step past its retries waits: the Art plan opens for the owner',
	);
	const r6 = transition(off('paused', 'regions'), { type: 'plan_ready', ownerOnly: true });
	pass(!r6.ok, '…and only from running, like any plan_ready');
	const ownerOnly: RunEvent = { type: 'plan_ready', ownerOnly: true };
	const r7 = transition(off('running', 'build'), ownerOnly);
	pass(!r7.ok, '…never past the region step: refused from build');
	const r8 = transition(state('waiting', 'regions', 'region_batch', ALL_OFF), ownerOnly);
	pass(!r8.ok, '…refused while a region batch waits');
	const r9 = transition(off('running', 'style_pack'), ownerOnly);
	pass(
		r9.ok && key(r9.state) === 'waiting/style_pack@art_plan',
		'…and opened from the style pack step as from the region step',
	);
	const apart = STATES.filter((from) => {
		const owner = transition({ ...from, checkpoints: ALL_OFF }, ownerOnly);
		const on = transition(from, { type: 'plan_ready' });
		return owner.ok !== on.ok || (owner.ok && on.ok && key(owner.state) !== key(on.state));
	});
	pass(
		apart.length === 0,
		'with the Art plan off, ownerOnly opens it from exactly the states plan_ready does with it on',
		` — differs from ${apart.map(key).join(', ')}`,
	);
	pass(checkpointSettings({}).artPlan, 'the art plan defaults ON');
	const r3 = transition(off('running', 'build'), { type: 'step_done' });
	pass(
		r3.ok && key(r3.state) === 'waiting/handoff@before_publish',
		'with every optional checkpoint off, build still stops before publishing',
	);
	pass(
		checkpointSettings(null).breakdown && checkpointSettings({ breakdown: 'no' }).breakdown,
		'missing or malformed settings default ON',
	);
	pass(
		checkpointSettings({ beforePublish: false }).beforePublish === true &&
			checkpointSettings({ before_publish: false }).beforePublish === true,
		'before publishing cannot be turned off',
	);
}

console.log('before publishing cannot be skipped');
{
	// Breadth-first over every state reachable from a draft, under every settings combination: the
	// only edge into handed_off is approving before_publish, and every path from build crosses it.
	for (const settings of [ALL_ON, ALL_OFF]) {
		const seen = new Map<string, RunState>();
		const queue = [state('draft', 'breakdown', null, settings)];
		const intoHandedOff: string[] = [];
		while (queue.length > 0) {
			const from = queue.shift()!;
			if (seen.has(key(from))) continue;
			seen.set(key(from), from);
			for (const event of EVENTS) {
				const result = transition(from, event);
				if (!result.ok) continue;
				if (result.state.status === 'handed_off')
					intoHandedOff.push(`${key(from)} + ${eventKey(event)}`);
				queue.push(result.state);
			}
		}
		pass(
			intoHandedOff.length === 1 &&
				intoHandedOff[0] === 'waiting/handoff@before_publish + resolve:before_publish:approve',
			`only approving before_publish hands off (${settings.breakdown ? 'all on' : 'all off'})`,
			` — ${intoHandedOff.join('; ')}`,
		);
		pass(seen.has('handed_off/handoff'), 'a run can be handed off');
	}
	const wrong = transition(state('waiting', 'regions', 'region_batch'), {
		type: 'resolve',
		checkpoint: 'before_publish',
		decision: 'approve',
	});
	pass(!wrong.ok, 'approving before_publish while another checkpoint is open is refused');
}

console.log('a repair run (ADR-0012)');
{
	const repair = (status: RunStatus, step: RunStep, waitingOn: Checkpoint | null = null) =>
		state(status, step, waitingOn, ALL_ON, 'repair');
	const verify = transition(repair('running', 'verify'), { type: 'step_done' });
	pass(
		!verify.ok && verify.error.includes('run.submit_repair'),
		'step_done in verify is refused and says to conclude with run.submit_repair',
	);
	pass(
		(['reproduce', 'fix', 'verify'] as const).every((step) => {
			const r = transition(repair('running', step), { type: 'conclude' });
			return r.ok && key(r.state) === 'repair:waiting/handoff@repair_review';
		}),
		'conclude opens repair_review from each repair step, on the handoff step',
	);
	pass(
		!transition(state('running', 'build'), { type: 'conclude' }).ok &&
			!transition(state('running', 'regions'), { type: 'conclude' }).ok,
		'conclude is refused in a create run',
	);
	pass(
		(['batch_done', 'plan_ready'] as const).every(
			(type) => !transition(repair('running', 'fix'), { type }).ok,
		),
		'batch_done and plan_ready are refused in a repair run',
	);
	for (const checkpoint of ['breakdown', 'art_plan', 'region_batch', 'before_publish'] as const) {
		pass(
			!transition(repair('waiting', 'handoff', 'repair_review'), {
				type: 'resolve',
				checkpoint,
				decision: 'approve',
			}).ok,
			`resolving ${checkpoint} is refused in a repair run`,
		);
	}
	for (const decision of ['approve', 'revise'] as const) {
		pass(
			!transition(state('waiting', 'handoff', 'before_publish'), {
				type: 'resolve',
				checkpoint: 'repair_review',
				decision,
			}).ok,
			`repair_review (${decision}) is refused in a create run`,
		);
	}
	const draft = transition(repair('draft', 'reproduce'), { type: 'start' });
	pass(
		draft.ok && key(draft.state) === 'repair:running/reproduce',
		'a repair run starts in reproduce',
	);
	const stale = transition(repair('draft', 'breakdown'), { type: 'start' });
	pass(
		stale.ok && key(stale.state) === 'repair:running/reproduce',
		'…whatever step its draft row carries',
	);

	// Every state reachable from a repair draft: the one way into handed_off is approving
	// repair_review, before_publish never opens, and no create step is ever entered.
	const seen = new Map<string, RunState>();
	const queue = [repair('draft', 'reproduce')];
	const intoHandedOff: string[] = [];
	while (queue.length > 0) {
		const from = queue.shift()!;
		if (seen.has(key(from))) continue;
		seen.set(key(from), from);
		for (const event of EVENTS) {
			const result = transition(from, event);
			if (!result.ok) continue;
			if (result.state.status === 'handed_off')
				intoHandedOff.push(`${key(from)} + ${eventKey(event)}`);
			queue.push(result.state);
		}
	}
	pass(
		intoHandedOff.length === 1 &&
			intoHandedOff[0] === 'repair:waiting/handoff@repair_review + resolve:repair_review:approve',
		'only approving repair_review hands a repair run off',
		` — ${intoHandedOff.join('; ')}`,
	);
	pass(
		[...seen.values()].every((s) => s.waitingOn === null || s.waitingOn === 'repair_review') &&
			[...seen.values()].every(
				(s) => (REPAIR_STEPS as readonly string[]).includes(s.step) || s.step === 'handoff',
			),
		'a repair run opens no checkpoint but repair_review and enters no create step',
	);
	const revised = transition(repair('waiting', 'handoff', 'repair_review'), {
		type: 'resolve',
		checkpoint: 'repair_review',
		decision: 'revise',
	});
	pass(revised.ok && key(revised.state) === 'repair:running/fix', 'revise goes back to fix');
	pass(
		[...seen.keys()].some((k) => k === 'repair:handed_off/handoff'),
		'a repair run can be handed off',
	);
	pass(
		(['reproduce', 'fix', 'verify'] as const).every(
			(step) =>
				transition(state('running', step, null, ALL_OFF, 'repair'), { type: 'conclude' }).ok,
		),
		'repair_review does not follow the optional checkpoint settings',
	);
}

console.log('the launcher schema agrees');
{
	const schema = readFileSync(
		fileURLToPath(
			new URL('../../../apps/launcher-api/src/lib/server/db/schema.ts', import.meta.url),
		),
		'utf8',
	);
	const listIn = (constraint: string, column: string) => {
		const m = new RegExp(
			`'${constraint}',\\s*sql\`[^\`]*\\$\\{table\\.${column}\\} in \\(([^)]*)\\)`,
		).exec(schema);
		return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : [];
	};
	const same = (a: readonly string[], b: readonly string[]) =>
		[...a].sort().join() === [...b].sort().join();
	pass(
		same(listIn('director_runs_status_check', 'status'), RUN_STATUSES),
		'status check constraint',
	);
	pass(same(listIn('director_runs_step_check', 'step'), RUN_STEPS), 'step check constraint');
	pass(same(listIn('director_runs_kind_check', 'kind'), RUN_KINDS), 'kind check constraint');
	const outcomes =
		/'director_runs_repair_outcome_check',[\s\S]*?in \(([^)]*)\)\)`/.exec(schema)?.[1] ?? '';
	pass(
		same(
			[...outcomes.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]),
			REPAIR_OUTCOMES,
		),
		'repair_outcome check constraint',
	);
	const waiting =
		/'director_runs_waiting_on_check',[\s\S]*?in \(([^)]*)\)\)`/.exec(schema)?.[1] ?? '';
	pass(
		same(
			[...waiting.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]),
			CHECKPOINTS,
		),
		'waiting_on check constraint',
	);
}

if (failures > 0) {
	console.log(`\n${failures} check(s) failed.`);
	process.exit(1);
}
console.log(`\n${passed} checks: the run state machine matches ADR-0003.`);
