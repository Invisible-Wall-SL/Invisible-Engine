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
 *  - optional checkpoints follow the settings, and default ON;
 *  - the launcher schema's check constraints list exactly these statuses, steps and checkpoints.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	CHECKPOINTS,
	RUN_EVENT_TYPES,
	RUN_STATUSES,
	RUN_STEPS,
	TERMINAL_STATUSES,
	checkpointSettings,
	transition,
	type Checkpoint,
	type CheckpointSettings,
	type RunEvent,
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
): RunState => ({ status, step, waitingOn, checkpoints });
const key = (s: RunState) => `${s.status}/${s.step}${s.waitingOn ? `@${s.waitingOn}` : ''}`;

/** One sample event per type; `resolve` is expanded per checkpoint and decision below. */
const EVENTS: RunEvent[] = [
	{ type: 'start' },
	{ type: 'step_done' },
	{ type: 'batch_done' },
	{ type: 'plan_ready' },
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
	for (const step of RUN_STEPS) {
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
}

/**
 * THE TABLE. `from → { event → to }`, all checkpoints on. An event a row does not list is refused.
 * The live statuses also accept `stop` and `fail`, added below rather than repeated per row.
 */
const LEGAL: Record<string, Record<string, string>> = {
	'draft/breakdown': { start: 'running/breakdown' },

	'running/breakdown': { step_done: 'waiting/breakdown@breakdown' },
	'running/style_pack': { step_done: 'running/regions', plan_ready: 'waiting/style_pack@art_plan' },
	'running/regions': {
		step_done: 'running/build',
		batch_done: 'waiting/regions@region_batch',
		plan_ready: 'waiting/regions@art_plan',
	},
	'running/build': { step_done: 'waiting/handoff@before_publish' },
	'running/handoff': {},

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
};
for (const step of RUN_STEPS) {
	LEGAL[`running/${step}`]['pause:owner'] = `paused/${step}`;
	LEGAL[`running/${step}`]['pause:budget_cap'] = `paused/${step}`;
	LEGAL[`running/${step}`]['pause:refusal'] = `paused/${step}`;
	LEGAL[`running/${step}`]['pause:error'] = `paused/${step}`;
	LEGAL[`paused/${step}`] = { resume: `running/${step}` };
	LEGAL[`stopping/${step}`].stopped = `stopped/${step}`;
}
for (const s of STATES) {
	const k = key(s);
	if (TERMINAL_STATUSES.includes(s.status)) continue;
	LEGAL[k] ??= {};
	if (s.status !== 'stopping') LEGAL[k].stop = `stopping/${s.step}`;
	LEGAL[k].fail = `failed/${s.step}`;
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
