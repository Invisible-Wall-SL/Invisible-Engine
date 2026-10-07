/**
 * Contract check for the Live run screen's event model (PLAN 4.3; ADR-0003 "Live UI"):
 *   pnpm --filter launcher-api check:director-live
 *
 * Runs the REAL `routes/(app)/director/liveRun.ts` over event rows shaped exactly as the worker
 * writes them (`services/director-worker/src/{driver,workerTools,store}.ts`, `mockups/checkpoint.ts`,
 * the launcher's `director/store.ts` for the GPU jobs). No browser, no database.
 *
 * Pinned:
 *  - the steps rail: done / running / waiting / paused / failed / stopped / skipped from the summary,
 *    with the breakdown figures and the regions' "n of m approved";
 *  - regions: the plan's batches group them; a queued render drafts them; a finished render leaves
 *    variants to review; the art director's findings pick a variant or send a region back; the
 *    owner's batch approval approves what was to review; a failed render says so;
 *  - a payload of the wrong shape (a region name that is not one, a variant id that is not one, a
 *    key outside the project, a nested string that only looks like a key) is ignored, never thrown;
 *  - the images an event names are collected only under the run's project prefix, with no `..`;
 *  - the feed gets one entry per row bar the per-image analysis rows, with the step at the time,
 *    the tool label and the cost of a spend row; a text is clipped;
 *  - `insertEvent` keeps the rows ascending by id and drops a repeat;
 *  - the Art plan (card 8E, `routes/(app)/director/artPlan.ts` over the reference plan in
 *    `docs/director/eval/blueprints/`): recipes collapse by group and chain; a row edit applies to
 *    every region of the row and is checked with the recipe rules at the field; every chain is
 *    priced again with the measured timings; an unpriced GPU, a recipe stored unpriced or a
 *    broken edit leaves the plan unapprovable; a region past its retries is named on its row with
 *    how often it failed; the licence list and "How this was made"; and the fold's `art_plan`
 *    open / approve / refused rows and the Style pack step's "Art plan ✓".
 */
import { readFileSync } from 'node:fs';
import {
	validateRecipe,
	type Catalogue,
	type RecipeInput,
	type StoredRecipe,
} from 'director-costs/recipe';
import {
	artPlanView,
	editRow,
	licenceList,
	pruneDrafts,
	madeOf,
	pipelineOptions,
	sizeOptions,
	spentLine,
	type ArtPlanAnswer,
} from '../src/routes/(app)/director/artPlan.ts';
import type { RunEvent, RunSummary } from '../src/routes/(app)/director/director.client.ts';
import {
	foldEvents,
	insertEvent,
	isDroppable,
	isNews,
	isProjectImageKey,
	refusedIds,
	regionTitle,
	stepViews,
	toolLabel,
	trimEvents,
} from '../src/routes/(app)/director/liveRun.ts';

let checks = 0;
let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures++;
	console.error(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`);
}

const PREFIX = 'invisible_wall/sunken_temple';
let seq = 0;
const at = () => new Date(Date.UTC(2026, 9, 6, 9, seq, 0)).toISOString();
const row = (
	kind: string,
	agent: string,
	payload: Record<string, unknown> | null,
	tool: string | null = null,
): RunEvent => ({ id: ++seq, at: at(), agent, kind, tool, payload });

const status = (
	from: [string, string, string | null],
	to: [string, string, string | null],
	cause: string,
) =>
	row('run_status', 'worker', {
		from: { status: from[0], step: from[1], waitingOn: from[2] },
		to: { status: to[0], step: to[1], waitingOn: to[2] },
		cause,
	});

const breakdown = (runId: string) => ({
	version: 1,
	fidelity: 'match',
	images: [
		{
			id: 'a1b2c3d4e5f60711',
			file: 'base-game.png',
			tag: 'Base game',
			styleOnly: false,
			w: 1280,
			h: 800,
			elements: [
				{
					n: 1,
					box: { x: 1, y: 2, w: 3, h: 4 },
					name: 'Jade idol',
					regions: ['H1_Jade_Idol'],
					status: 'matched',
					reason: '',
					lockedItem: null,
				},
			],
			model: 'claude-opus-5-5',
		},
	],
	palette: [{ name: 'Teal', hex: '#1F7A6D' }],
	paletteDropped: [],
	fontGaps: [],
	uncoveredRegions: ['Win_Banner_Mega'],
	regionsTotal: 39,
	regionsMatched: 34,
	crops: {
		saved: [
			{
				region: 'H1_Jade_Idol',
				key: `${PREFIX}/director/crops/${runId}/H1_Jade_Idol.png`,
				imageId: 'a1b2c3d4e5f60711',
			},
			{ region: 'Evil', key: `other_client/game/director/crops/${runId}/Evil.png`, imageId: 'x' },
			{ region: 'Sneaky', key: `${PREFIX}/../secret/x.png`, imageId: 'x' },
		],
		skipped: [],
	},
});

const events: RunEvent[] = [
	row('owner_request', 'owner', {
		requestId: 'r1',
		by: { uid: 'o', name: 'Owner' },
		action: 'start',
	}),
	status(['draft', 'breakdown', null], ['running', 'breakdown', null], 'owner start'),
	row('activity', 'worker', {
		type: 'breakdown_pass',
		attempt: 1,
		pass: 1,
		message: 'Analysing the mockups.',
	}),
	row('activity', 'mockup-analyst', {
		type: 'breakdown_image',
		attempt: 1,
		imageId: 'a1b2c3d4e5f60711',
		message: 'Mockup analysed.',
	}),
	row('spend', 'mockup-analyst', {
		kind: 'claude',
		model: 'claude-opus-5-5',
		usd: 0.4123,
		requestId: 'msg_1',
	}),
	row('activity', 'mockup-analyst', {
		message: 'Mockup breakdown ready',
		attempt: 1,
		images: 3,
		regionsMatched: 34,
		regionsTotal: 39,
		needsYou: 2,
		leftOut: 1,
	}),
	status(
		['running', 'breakdown', null],
		['waiting', 'breakdown', 'breakdown'],
		'breakdown submitted',
	),
	row('checkpoint_open', 'mockup-analyst', {
		checkpoint: 'breakdown',
		attempt: 1,
		breakdown: breakdown('run1'),
	}),
	row('checkpoint_resolved', 'owner', {
		requestId: 'r2',
		by: { uid: 'o', name: 'Owner' },
		decision: 'approve',
		checkpoint: 'breakdown',
	}),
	status(['waiting', 'breakdown', 'breakdown'], ['running', 'style_pack', null], 'resolve approve'),
	row(
		'activity',
		'coordinator',
		{
			type: 'plan',
			summary: 'Symbols first, then backgrounds.',
			batches: [
				{ name: 'Symbols', regions: ['H1_Jade_Idol', 'H2_Coral_Mask', 'L3_Q', 'bad name!'] },
				{ name: 'Backgrounds', regions: ['BG_Base'] },
				{ name: 12, regions: ['Nope'] },
			],
		},
		'run.set_plan',
	),
	status(['running', 'style_pack', null], ['running', 'regions', null], 'coordinator: step_done'),
	row(
		'activity',
		'coordinator',
		{ type: 'assignment', to: 'atlas-artist', task: 'Render the Symbols batch.' },
		'run.assign_task',
	),
	row(
		'job_queued',
		'atlas-artist',
		{
			jobRef: 'st_0123456789abcdef',
			atlas: 'symbols',
			regions: ['H1_Jade_Idol', 'H2_Coral_Mask', 'L3_Q'],
		},
		'atlas.queue_variants',
	),
	row(
		'job_queued',
		'atlas-artist',
		{ jobRef: 'not-a-job', atlas: 'Bad Atlas', regions: ['BG_Base'] },
		'atlas.queue_variants',
	),
	row(
		'job_done',
		'atlas-artist',
		{
			jobRef: 'st_0123456789abcdef',
			atlas: 'symbols',
			regions: ['H1_Jade_Idol', 'H2_Coral_Mask', 'L3_Q'],
			status: 'finished',
			via: 'callback',
			result: {
				jobRef: 'st_0123456789abcdef',
				status: 'finished',
				variants: [
					{ region: 'H1_Jade_Idol', variant: '00001', slot: 0 },
					{ region: 'H1_Jade_Idol', variant: '00002', slot: 1 },
					{ region: 'H2_Coral_Mask', variant: '00004', slot: 0 },
					{ region: 'H2_Coral_Mask', variant: '00005', slot: 1 },
					{ region: 'H2_Coral_Mask', variant: '00006', slot: 2 },
					{ region: 'H2_Coral_Mask', variant: 'zz', slot: 3 },
					{ region: 'L3_Q', variant: '00008', slot: 0 },
					{ region: '../etc', variant: '00007', slot: 0 },
				],
				runpod: { gpu: '4090', seconds: 84, jobs: 12 },
			},
		},
		'atlas.queue_variants',
	),
	row('spend', 'atlas-artist', {
		kind: 'runpod',
		model: '4090',
		usd: 0.22,
		requestId: 'runpod:st_0123456789abcdef',
		seconds: 84,
	}),
	row(
		'activity',
		'art-director',
		{
			type: 'review',
			summary: 'Picked B for the coral mask; the Q is warped.',
			findings: [
				{
					subject: 'H2 · Coral mask',
					verdict: 'pick',
					note: 'Variant B is closest to your mockup.',
				},
				{ subject: 'L3_Q', verdict: 'reject', note: 'The letter came out warped.' },
				{ subject: 'H1_Jade_Idol', verdict: 'pick 00002', note: 'Clean silhouette.' },
				{ subject: 'Unknown thing', verdict: 'pick', note: 'x' },
				{ subject: 'A', verdict: 'pick', note: 'A clean one.' },
				{ subject: 'Mask', verdict: 'reject', note: 'A substring is not a region.' },
				'not a finding',
			],
		},
		'run.submit_review',
	),
	row(
		'activity',
		'qa',
		{
			type: 'qa',
			summary: 'One pass.',
			findings: [{ subject: 'H1_Jade_Idol', verdict: 'pass', note: '256×256, clean alpha.' }],
		},
		'run.submit_qa',
	),
	status(
		['running', 'regions', null],
		['waiting', 'regions', 'region_batch'],
		'coordinator: batch_done',
	),
	row(
		'checkpoint_open',
		'coordinator',
		{ checkpoint: 'region_batch', step: 'regions', summary: '2 regions are ready to review.' },
		'run.request_checkpoint',
	),
	row('owner_message', 'owner', {
		requestId: 'r3',
		by: { uid: 'o', name: 'Owner' },
		text: 'Do the background first.',
	}),
	row(
		'activity',
		'coordinator',
		{ type: 'note', text: 'Moved the base background to the front of the queue, as you asked.' },
		'run.post_activity',
	),
	row('error', 'worker', {
		type: 'refused_request',
		eventId: 3,
		error: 'pause is not allowed while waiting on region_batch (step regions)',
	}),
	row('checkpoint_resolved', 'owner', {
		requestId: 'r4',
		by: { uid: 'o', name: 'Owner' },
		decision: 'approve',
		checkpoint: 'region_batch',
		note: 'Use B.',
	}),
	status(['waiting', 'regions', 'region_batch'], ['running', 'regions', null], 'resolve approve'),
	row(
		'job_queued',
		'atlas-artist',
		{ jobRef: 'st_fedcba9876543210', atlas: 'backgrounds', regions: ['BG_Base'] },
		'atlas.queue_variants',
	),
	row(
		'job_done',
		'atlas-artist',
		{
			jobRef: 'st_fedcba9876543210',
			atlas: 'backgrounds',
			regions: ['BG_Base'],
			status: 'failed',
			via: 'poll',
			result: { error: 'No completion within the resume window.' },
		},
		'atlas.queue_variants',
	),
	row('activity', 'builder', { type: 'note', text: 'x'.repeat(2000) }, 'run.post_activity'),
	row(
		'activity',
		'builder',
		{ type: 'mystery', extra: { deep: { key: `${PREFIX}/editor/scenes/base.webp` } } },
		'scene.update_nodes',
	),
	row('activity', 'worker', { type: 'note', message: 'atlas-artist finished the batch.' }),
];

const summary = (over: Partial<RunSummary>): RunSummary =>
	({
		id: 'run1',
		name: 'Sunken Temple',
		projectKey: 'sunken-temple',
		clientKey: 'invisible_wall',
		templateProjectKey: 'hw-3pots-sample',
		status: 'running',
		step: 'regions',
		waitingOn: null,
		checkpoints: { breakdown: true, regionBatch: true, beforePublish: true },
		startingPoint: null,
		projectCreated: true,
		spend: { claudeUsd: 3.1, runpodUsd: 0.22, totalUsd: 3.32, capUsd: 25, remainingUsd: 21.68 },
		checkpoint: null,
		agents: [],
		allowedActions: ['pause', 'stop', 'message'],
		lastEventId: seq,
		createdAt: '2026-10-06T09:00:00.000Z',
		updatedAt: '2026-10-06T09:40:00.000Z',
		...over,
	}) as RunSummary;

console.log('folding');
const folded = foldEvents(events, PREFIX);
{
	check('the breakdown figures are read', folded.breakdown, {
		images: 1,
		regionsMatched: 34,
		regionsTotal: 39,
	});
	check(
		'the plan keeps the well-formed batches, with their names as the coordinator wrote them',
		folded.plan?.batches.map((b) => [b.name, b.regions]),
		[
			['Symbols', ['H1_Jade_Idol', 'H2_Coral_Mask', 'L3_Q', 'bad name!']],
			['Backgrounds', ['BG_Base']],
		],
	);
	check(
		'groups follow the plan, then the rest',
		folded.groups.map((g) => [g.name, g.regions.map((r) => r.name)]),
		[
			['Symbols', ['H1_Jade_Idol', 'H2_Coral_Mask', 'L3_Q']],
			['Backgrounds', ['BG_Base']],
		],
	);
	const r = (name: string) => folded.regions.get(name)!;
	check(
		'a region with variants the owner approved is approved',
		r('H1_Jade_Idol').status,
		'approved',
	);
	check(
		'…its variants are in slot order',
		r('H1_Jade_Idol').variants.map((v) => v.id),
		['00001', '00002'],
	);
	check('…the art director named its pick by id', r('H1_Jade_Idol').pick?.variant, '00002');
	check('…QA is kept', r('H1_Jade_Idol').qa?.verdict, 'pass');
	check(
		'…its crop key is read from the breakdown',
		r('H1_Jade_Idol').cropKey,
		`${PREFIX}/director/crops/run1/H1_Jade_Idol.png`,
	);
	check('a letter in the verdict names a variant', r('H2_Coral_Mask').pick?.variant, '00005');
	check('a bad variant id is dropped', r('H2_Coral_Mask').variants.length, 3);
	check('a rejected region is sent back, not approved', r('L3_Q').status, 'rejected');
	check(
		'a failed render is failed with its reason',
		[r('BG_Base').status, r('BG_Base').error],
		['failed', 'No completion within the resume window.'],
	);
	check(
		'a region name that is not one never appears',
		[folded.regions.has('bad name!'), folded.regions.has('../etc'), folded.regions.has('Nope')],
		[false, false, false],
	);
	check('the group atlas is the one its regions rendered on', folded.groups[0].atlas, 'symbols');
	check('counts', folded.groups[0].counts, {
		total: 3,
		approved: 2,
		toReview: 0,
		drafting: 0,
		queued: 0,
		rejected: 1,
		failed: 0,
	});
	check(
		'jobs: a bad jobRef is not a job',
		folded.jobs.map((j) => [j.jobRef, j.status, j.variants, j.seconds]),
		[
			['st_fedcba9876543210', 'failed', 0, null],
			['st_0123456789abcdef', 'finished', 6, 84],
		],
	);
	check('nothing is queued now', folded.gpuQueued, 0);
	check(
		'images: only keys under the project, no traversal, nested ones found',
		folded.images.map((i) => [i.key, i.area, i.label]),
		[
			[`${PREFIX}/editor/scenes/base.webp`, 'editor', 'base'],
			[`${PREFIX}/director/crops/run1/H1_Jade_Idol.png`, 'director', 'H1_Jade_Idol'],
		],
	);
	check('the feed skips the per-image rows only', folded.feed.length, events.length - 1);
	check(
		'a note with a message instead of a text still reads',
		folded.feed.at(-1)?.text,
		'atlas-artist finished the batch.',
	);
	{
		const handedOff = foldEvents(
			[
				...events,
				row(
					'job_queued',
					'atlas-artist',
					{ jobRef: 'st_00000000000000aa', atlas: 'symbols', regions: ['L3_Q'] },
					'atlas.queue_variants',
				),
				row(
					'job_done',
					'atlas-artist',
					{
						jobRef: 'st_00000000000000aa',
						atlas: 'symbols',
						regions: ['L3_Q'],
						status: 'finished',
						via: 'callback',
						result: { variants: [{ region: 'L3_Q', variant: '00009', slot: 0 }] },
					},
					'atlas.queue_variants',
				),
				row('checkpoint_resolved', 'owner', {
					requestId: 'r9',
					by: { uid: 'o', name: 'Owner' },
					decision: 'approve',
					checkpoint: 'before_publish',
				}),
			],
			PREFIX,
		);
		check(
			'approving the build accepts what was still to review',
			handedOff.regions.get('L3_Q')?.status,
			'approved',
		);
	}
	const by = (id: number) => folded.feed.find((f) => f.id === id)!;
	check(
		'the step at the time is kept',
		[by(1).step, by(14).step, by(11).step],
		['breakdown', 'regions', 'style_pack'],
	);
	check(
		'a spend row carries its cost',
		[by(5).cost, by(17).cost],
		['$0.41 · Opus 5.5', '$0.22 · RunPod 4090 · 84 s'],
	);
	check(
		'tool labels',
		[by(14).tool, by(11).tool, by(30).tool],
		['ComfyUI · RunPod', null, 'Scene Editor'],
	);
	check('an owner message is quoted', by(22).text, '“Do the background first.”');
	check(
		'a refusal reads as an error',
		[by(24).tone, by(24).text.startsWith('refused a request: pause')],
		['error', true],
	);
	check('a long text is clipped', by(29).text.length <= 1200, true);
	check('an unknown activity type falls back to its type', by(30).text, 'mystery');
	check(
		'a render row names its regions',
		by(16).text,
		'rendered 6 variants of H1 · Jade Idol, H2 · Coral Mask, L3 · Q in 84 s of GPU time.',
	);
	check('step start times come from run_status', Object.keys(folded.stepStartedAt), [
		'breakdown',
		'style_pack',
		'regions',
	]);
}

console.log('steps');
{
	const rail = stepViews(summary({}), folded, 3);
	check(
		'running at regions',
		rail.map((s) => s.state),
		['done', 'done', 'running', 'todo', 'todo'],
	);
	check('the breakdown detail', rail[0].detail, '1 mockup · 34 of 39 regions matched');
	check(
		'the regions detail and progress',
		[rail[2].detail, rail[2].progress],
		['2 of 39 approved', 2 / 39],
	);
	check(
		'waiting on a batch',
		stepViews(summary({ status: 'waiting', waitingOn: 'region_batch' }), folded, 3)[2].state,
		'waiting',
	);
	check(
		'paused at build: the later step is still to come',
		stepViews(summary({ status: 'paused', step: 'build' }), folded, 3).map((s) => s.state),
		['done', 'done', 'done', 'paused', 'todo'],
	);
	check(
		'failed at build: hand-off is skipped',
		stepViews(summary({ status: 'failed', step: 'build' }), folded, 3).map((s) => [
			s.state,
			s.detail,
		]),
		[
			['done', '1 mockup · 34 of 39 regions matched'],
			['done', 'Palette and refs taken from your mockups'],
			['done', '2 of 39 approved'],
			['failed', 'Failed · Scene Editor, Symbols SM, Win Text'],
			['skipped', 'Not reached · You publish it in Game Maker'],
		],
	);
	check(
		'stopped while stopping',
		stepViews(summary({ status: 'stopping', step: 'regions' }), folded, 3).map((s) => s.state),
		['done', 'done', 'stopped', 'skipped', 'skipped'],
	);
	check(
		'handed off: everything done',
		stepViews(summary({ status: 'handed_off', step: 'handoff' }), folded, 3).map((s) => s.state),
		['done', 'done', 'done', 'done', 'done'],
	);
	check(
		'a draft without mockups',
		stepViews(summary({ status: 'draft', step: 'breakdown' }), foldEvents([], PREFIX), 0).map(
			(s) => [s.state, s.detail],
		),
		[
			['todo', 'A style board from your notes'],
			['todo', 'Palette and refs from your notes'],
			['todo', 'Variants to review, group by group'],
			['todo', 'Scene Editor, Symbols SM, Win Text'],
			['todo', 'You publish it in Game Maker'],
		],
	);
}

console.log('refusals, matching and the baseline');
{
	// The owner's approval arrived after the run moved on: the worker refused it, so the batch is
	// still to review, and the refusal row survives trimming.
	const base = events.slice(0, 20); // up to and including the region_batch checkpoint_open
	const refusedApprove = foldEvents(
		[
			...base,
			row('checkpoint_resolved', 'owner', {
				requestId: 'rr',
				by: { uid: 'o', name: 'Owner' },
				decision: 'approve',
				checkpoint: 'region_batch',
			}),
			{
				id: seq + 1,
				at: at(),
				agent: 'worker',
				kind: 'error',
				tool: null,
				payload: {
					type: 'refused_request',
					eventId: seq,
					error: 'resolve is not allowed while running (step regions)',
				},
			},
		],
		PREFIX,
	);
	check(
		'a refused approval approves nothing',
		[
			refusedApprove.regions.get('H1_Jade_Idol')?.status,
			refusedApprove.regions.get('H2_Coral_Mask')?.status,
		],
		['to_review', 'to_review'],
	);
	check(
		'…and the feed says so on the owner row',
		refusedApprove.feed.find((f) => f.kind === 'checkpoint_resolved' && f.id === seq)?.text,
		'asked to approve the region batch — the worker refused it.',
	);
	const refusal: RunEvent = {
		id: 7,
		at: 'x',
		agent: 'worker',
		kind: 'error',
		tool: null,
		payload: { type: 'refused_request', eventId: 3, error: 'x' },
	};
	check(
		'refused ids are collected; a refusal row is never dropped',
		[
			[...refusedIds([refusal])],
			isDroppable(refusal),
			isDroppable({ ...refusal, payload: { type: 'retrying' } }),
		],
		[[3], false, true],
	);

	const r = (name: string) => folded.regions.get(name)!;
	check(
		'a bare letter does not name a variant; "Variant B" does',
		[r('H2_Coral_Mask').pick?.variant, r('H1_Jade_Idol').pick?.variant],
		['00005', '00002'],
	);
	check(
		'a one-letter subject and a substring name no region',
		[...folded.regions.values()].filter(
			(x) => x.pick?.note === 'A clean one.' || x.pick?.note === 'A substring is not a region.',
		).length,
		0,
	);

	// Regions outside the plan (a scratch atlas's layers under ADR-0008) are shown but never
	// counted toward the template's total nor approved with a batch.
	const scratch = foldEvents(
		[
			...base,
			row(
				'job_queued',
				'atlas-artist',
				{ jobRef: 'st_00000000000000cc', atlas: 'scratch', regions: ['cut_H1'] },
				'atlas.queue_variants',
			),
			row(
				'job_done',
				'atlas-artist',
				{
					jobRef: 'st_00000000000000cc',
					atlas: 'scratch',
					regions: ['cut_H1'],
					status: 'finished',
					via: 'callback',
					result: { variants: [{ region: 'cut_H1', variant: '00001', slot: 0 }] },
				},
				'atlas.queue_variants',
			),
			row('checkpoint_resolved', 'owner', {
				requestId: 'rs',
				by: { uid: 'o', name: 'Owner' },
				decision: 'approve',
				checkpoint: 'region_batch',
			}),
		],
		PREFIX,
	);
	check(
		'a region outside the plan sits under Other regions, unplanned, and is not approved with the batch',
		[
			scratch.regions.get('cut_H1')?.group,
			scratch.regions.get('cut_H1')?.planned,
			scratch.regions.get('cut_H1')?.status,
			scratch.regions.get('H1_Jade_Idol')?.status,
		],
		['Other regions', false, 'to_review', 'approved'],
	);
	check(
		'…and the rail counts the plan’s regions only',
		stepViews(summary({}), scratch, 3)[2].detail,
		'2 of 39 approved',
	);

	// The coordinator's plan spells a region its own way; the render uses the adapter's name.
	const spelled = foldEvents(
		[
			row(
				'activity',
				'coordinator',
				{
					type: 'plan',
					summary: 'x',
					batches: [{ name: 'Symbols', regions: ['H2 Coral Mask', 'l3 q'] }],
				},
				'run.set_plan',
			),
			row(
				'job_queued',
				'atlas-artist',
				{
					jobRef: 'st_00000000000000dd',
					atlas: 'symbols',
					regions: ['H2_Coral_Mask', 'L3_Q', 'Wild'],
				},
				'atlas.queue_variants',
			),
			row(
				'job_done',
				'atlas-artist',
				{
					jobRef: 'st_00000000000000dd',
					atlas: 'symbols',
					regions: ['H2_Coral_Mask', 'L3_Q', 'Wild'],
					status: 'finished',
					via: 'callback',
					result: {
						variants: [
							{ region: 'H2_Coral_Mask', variant: '00001', slot: 0 },
							{ region: 'L3_Q', variant: '00002', slot: 0 },
							{ region: 'Wild', variant: '00003', slot: 0 },
						],
					},
				},
				'atlas.queue_variants',
			),
			row(
				'job_queued',
				'atlas-artist',
				{ jobRef: 'st_00000000000000de', atlas: 'scratch', regions: ['cut_Wild'] },
				'atlas.queue_variants',
			),
			row(
				'job_done',
				'atlas-artist',
				{
					jobRef: 'st_00000000000000de',
					atlas: 'scratch',
					regions: ['cut_Wild'],
					status: 'finished',
					via: 'callback',
					result: { variants: [{ region: 'cut_Wild', variant: '00001', slot: 0 }] },
				},
				'atlas.queue_variants',
			),
			row(
				'checkpoint_open',
				'coordinator',
				{ checkpoint: 'region_batch', step: 'regions', summary: 'x' },
				'run.request_checkpoint',
			),
			row('checkpoint_resolved', 'owner', {
				requestId: 'rp',
				by: { uid: 'o', name: 'Owner' },
				decision: 'approve',
				checkpoint: 'region_batch',
			}),
		],
		PREFIX,
	);
	const sp = (name: string) => spelled.regions.get(name)!;
	check(
		'a plan name spelled differently still groups, plans and approves the rendered region',
		[
			sp('H2_Coral_Mask').group,
			sp('H2_Coral_Mask').planned,
			sp('H2_Coral_Mask').status,
			sp('L3_Q').status,
		],
		['Symbols', true, 'approved', 'approved'],
	);
	check(
		'a region the plan did not name but on a planned atlas is the template’s; a scratch atlas’s is not',
		[
			sp('Wild').group,
			sp('Wild').planned,
			sp('Wild').status,
			sp('cut_Wild').planned,
			sp('cut_Wild').status,
		],
		['Other regions', true, 'approved', false, 'to_review'],
	);
	check(
		'the plan’s free-text names make no region of their own',
		spelled.regions.has('H2 Coral Mask'),
		false,
	);
	check(
		'the render version moves on a render only',
		[r('H1_Jade_Idol').renderVersion, r('H1_Jade_Idol').version > r('H1_Jade_Idol').renderVersion],
		[16, true],
	);

	check(
		'nothing is news before the summary; everything after a run with no rows is',
		[isNews(null, 1), isNews(0, 1), isNews(5, 5), isNews(5, 6)],
		[false, true, false, true],
	);
}

console.log('helpers');
{
	const list: RunEvent[] = [];
	const e = (id: number): RunEvent => ({
		id,
		at: 'x',
		agent: 'a',
		kind: 'activity',
		tool: null,
		payload: null,
	});
	check(
		'inserts ascending',
		[
			insertEvent(list, e(5)),
			insertEvent(list, e(2)),
			insertEvent(list, e(9)),
			insertEvent(list, e(5)),
		],
		[true, true, true, false],
	);
	check(
		'…in order',
		list.map((x) => x.id),
		[2, 5, 9],
	);
	check(
		'image keys',
		[
			isProjectImageKey(`${PREFIX}/atlas/page.png`, PREFIX),
			isProjectImageKey(`${PREFIX}/atlas/page.PNG`, PREFIX),
			isProjectImageKey(`${PREFIX}/atlas/../x.png`, PREFIX),
			isProjectImageKey(`${PREFIX}//x.png`, PREFIX),
			isProjectImageKey(`${PREFIX}_other/x.png`, PREFIX),
			isProjectImageKey(`${PREFIX}/config/config.json`, PREFIX),
			isProjectImageKey(`${PREFIX}/a\u0000.png`, PREFIX),
		],
		[true, true, false, false, false, false, false],
	);
	check(
		'region titles',
		['H2_Coral_Mask', 'BG_Base', 'Wild', 'Win_Banner_Mega', 'L5_10'].map(regionTitle),
		['H2 · Coral Mask', 'BG · Base', 'Wild', 'Win Banner Mega', 'L5 · 10'],
	);
	check(
		'tool labels',
		[
			'atlas.get_region',
			'atlas.queue_variants',
			'run.post_activity',
			'wintext.update_doc',
			null,
			'weird',
		].map(toolLabel),
		['Atlas Maker', 'ComfyUI · RunPod', null, 'Win Text', null, 'weird'],
	);
	const malformed: RunEvent[] = [
		{ id: 1, at: 'x', agent: 'a', kind: 'job_done', tool: null, payload: { result: 'nope' } },
		{
			id: 2,
			at: 'x',
			agent: 'a',
			kind: 'activity',
			tool: null,
			payload: { type: 'review', findings: 'nope' },
		},
		{
			id: 3,
			at: 'x',
			agent: 'a',
			kind: 'checkpoint_open',
			tool: null,
			payload: { checkpoint: 'breakdown', breakdown: { images: 'no' } },
		},
		{
			id: 4,
			at: 'x',
			agent: 'a',
			kind: 'activity',
			tool: null,
			payload: { type: 'plan', batches: 'nope' },
		},
		{ id: 5, at: 'x', agent: 'a', kind: 'something_new', tool: null, payload: null },
		{
			id: 'six' as unknown as number,
			at: 'x',
			agent: 'a',
			kind: 'activity',
			tool: null,
			payload: null,
		},
	];
	const bad = foldEvents(malformed, PREFIX);
	check(
		'malformed rows fold to text, never throw',
		[bad.feed.length, bad.regions.size, bad.breakdown],
		[5, 0, null],
	);
}

console.log('batches, atlases and trimming');
{
	// Two batches: the first waits for the owner while the second renders; approving the first
	// must not approve the second. Atlas ids are the Atlas Maker's own (`S_Gem`, `Derived`).
	const two: RunEvent[] = [
		row(
			'activity',
			'coordinator',
			{
				type: 'plan',
				summary: 'x',
				batches: [
					{ name: 'A', regions: ['R1', 'R2'] },
					{ name: 'B', regions: ['R3'] },
				],
			},
			'run.set_plan',
		),
		row(
			'job_queued',
			'atlas-artist',
			{ jobRef: 'st_00000000000000b1', atlas: 'S_Gem', regions: ['R1', 'R2'] },
			'atlas.queue_variants',
		),
		row(
			'job_done',
			'atlas-artist',
			{
				jobRef: 'st_00000000000000b1',
				atlas: 'S_Gem',
				regions: ['R1', 'R2'],
				status: 'finished',
				via: 'callback',
				result: {
					variants: [
						{ region: 'R1', variant: '00001', slot: 0 },
						{ region: 'R1', variant: '00001', slot: 0 },
						{ region: 'R2', variant: '00002', slot: 0 },
					],
				},
			},
			'atlas.queue_variants',
		),
		row(
			'checkpoint_open',
			'coordinator',
			{ checkpoint: 'region_batch', step: 'regions', summary: 'A is ready.' },
			'run.request_checkpoint',
		),
		row(
			'job_queued',
			'atlas-artist',
			{ jobRef: 'st_00000000000000b2', atlas: 'Derived', regions: ['R3'] },
			'atlas.queue_variants',
		),
		row(
			'job_done',
			'atlas-artist',
			{
				jobRef: 'st_00000000000000b2',
				atlas: 'Derived',
				regions: ['R3'],
				status: 'finished',
				via: 'callback',
				result: { variants: [{ region: 'R3', variant: '00001', slot: 0 }] },
			},
			'atlas.queue_variants',
		),
		row('checkpoint_resolved', 'owner', {
			requestId: 'rb',
			by: { uid: 'o', name: 'Owner' },
			decision: 'approve',
			checkpoint: 'region_batch',
		}),
	];
	const f = foldEvents(two, PREFIX);
	check(
		'the Atlas Maker’s own atlas ids are accepted',
		[f.regions.get('R1')?.atlas, f.regions.get('R3')?.atlas],
		['S_Gem', 'Derived'],
	);
	check('a variant listed twice is one variant', f.regions.get('R1')?.variants.length, 1);
	check(
		'approving the batch approves its regions only',
		[f.regions.get('R1')?.status, f.regions.get('R2')?.status, f.regions.get('R3')?.status],
		['approved', 'approved', 'to_review'],
	);

	const rows: RunEvent[] = [];
	for (let i = 1; i <= 10; i++) {
		rows.push({
			id: i,
			at: 'x',
			agent: 'a',
			kind: i % 2 ? 'spend' : 'job_queued',
			tool: null,
			payload: null,
		});
	}
	trimEvents(rows, 7);
	check(
		'trimming drops the oldest droppable rows first',
		rows.map((r) => `${r.id}${r.kind === 'spend' ? 's' : 'j'}`),
		['2j', '4j', '6j', '7s', '8j', '9s', '10j'],
	);
	trimEvents(rows, 3);
	check(
		'…and structural rows only when nothing else is left',
		rows.map((r) => r.id),
		[6, 8, 10],
	);
	const few: RunEvent[] = [
		{ id: 1, at: 'x', agent: 'a', kind: 'spend', tool: null, payload: null },
	];
	trimEvents(few, 5);
	check('under the cap nothing is dropped', few.length, 1);
}

// ── The Art plan (card 8E) ────────────────────────────────────────────────────
{
	const EVAL = new URL('../../../docs/director/eval/blueprints/', import.meta.url);
	const catalogue = JSON.parse(readFileSync(new URL('catalogue.json', EVAL), 'utf8')) as Catalogue;
	const expected = JSON.parse(readFileSync(new URL('expected-art-plan.json', EVAL), 'utf8')) as {
		plan: { batches: { name: string; regions: string[] }[] };
		recipes: RecipeInput[];
	};
	const plan = expected.plan.batches.flatMap((b) =>
		b.regions.map((region) => ({ region, group: b.name })),
	);
	const planSet = new Set(plan.map((p) => p.region));
	const USD = 0.00053;
	/** The worker's floor at pricing.json's prices: a guessed card is priced at the seed. */
	const FLOOR = { seedSecondsPerImage: 600, delaySecondsPerJob: 15 };
	const stored: StoredRecipe[] = [];
	for (const recipe of expected.recipes) {
		const result = validateRecipe(recipe, {
			catalogue,
			planRegions: planSet,
			others: stored,
			usdPerSecond: USD,
			floor: FLOOR,
		});
		if (!result.ok) throw new Error(`fixture: ${recipe.region} ${result.errors.join('; ')}`);
		stored.push({
			...recipe,
			rev: 1,
			plannedBy: 'atlas-technician',
			approved: null,
			steps: result.steps,
			projected: result.projected,
		});
	}
	const answer: ArtPlanAnswer = {
		recipes: stored.map((r) => ({ ...r, planned: true })),
		plan,
		catalogue: { ...catalogue, usdPerSecond: USD },
		catalogueError: null,
		timings: [],
		floor: FLOOR,
	};
	const view = artPlanView(answer);
	check(
		'the plan collapses each group by identical chain',
		view.groups.reduce((n, g) => n + g.rows.reduce((m, r) => m + r.regions.length, 0), 0),
		stored.length,
	);
	check(
		'a group with one chain for every region is one row',
		view.groups.find((g) => g.group === expected.plan.batches[0].name)?.rows.length,
		1,
	);
	check('every recipe waits for the owner', view.pending, stored.length);
	check(
		'the approval names every revision seen',
		Object.keys(view.recipeRevs).length,
		stored.length,
	);
	check(
		'the projection is the sum of the recipes',
		view.gpuUsd,
		Math.round(stored.reduce((n, r) => n + (r.projected.gpuUsd ?? 0), 0) * 10000) / 10000,
	);
	check('nothing to send before an edit', [view.edits.length, view.editsValid], [0, true]);

	const row = view.groups[0].rows[0];
	const first = row.steps[0];
	const drafts = editRow(answer, new Map(), row.regions, first.n, { variants: 2 });
	const edited = artPlanView(answer, drafts);
	check('a row edit applies to every region of the row', edited.edits.length, row.regions.length);
	check('…and passes the rules', edited.editsValid, true);
	check('…fewer variants cost less', (edited.gpuUsd ?? Infinity) < (view.gpuUsd ?? 0), true);
	const tooMany = artPlanView(
		answer,
		editRow(answer, new Map(), row.regions, first.n, { variants: 99 }),
	);
	check(
		'an edit outside the card is refused at the field, with the reason',
		[tooMany.editsValid, tooMany.groups[0].rows[0].errors.some((e) => e.includes('at most'))],
		[false, true],
	);
	check('…and leaves the plan unpriced, so it cannot be approved', tooMany.gpuUsd, null);
	const same = artPlanView(
		answer,
		editRow(answer, new Map(), row.regions, first.n, { variants: first.variants }),
	);
	check('an edit back to the plan sends nothing', same.edits.length, 0);
	check(
		'a generate step is offered only pipelines that take a prompt',
		pipelineOptions(answer, first).every(
			(id) => catalogue.blueprints.find((b) => b.id === id)?.card.inputs.prompt !== 'none',
		),
		true,
	);
	check(
		'…and never a credit-billed one',
		pipelineOptions(answer, first).includes('gpt_image'),
		false,
	);
	check(
		'sizes stay within the card',
		sizeOptions(catalogue.blueprints.find((b) => b.id === 'sdxl')?.card, 1024).includes(1024),
		true,
	);
	const removed = artPlanView(answer, editRow(answer, new Map(), row.regions, 2, { remove: true }));
	check(
		'removing a step shortens the chain',
		removed.groups[0].rows[0].steps.length,
		row.steps.length - 1,
	);

	const noGpu = artPlanView({
		...answer,
		catalogue: { ...answer.catalogue!, usdPerSecond: null },
	});
	check(
		'an unpriced GPU leaves the plan unpriced, in one line for every region',
		[
			noGpu.gpuUsd,
			noGpu.unpriced.length,
			noGpu.unpriced[0]?.includes(`and ${stored.length - 3} more`),
		],
		[null, 1, true],
	);
	const storedUnpriced = artPlanView({
		...answer,
		recipes: answer.recipes.map((r, i) =>
			i === 0
				? {
						...r,
						projected: {
							...r.projected,
							gpuUsd: null,
							unpriced: ["the endpoint's GPU has no price"],
						},
					}
				: r,
		),
	});
	check(
		'a recipe stored unpriced shows the price it has now (the approval prices it again too)',
		[storedUnpriced.gpuUsd === null, storedUnpriced.unpriced],
		[false, []],
	);
	check(
		'edits name the revision they were made on',
		edited.edits.every((e) => e.rev === 1),
		true,
	);
	check(
		'a draft is kept while its recipe still has the revision it was made on',
		pruneDrafts(answer, drafts).size,
		row.regions.length,
	);
	check(
		'…and retired once the recipe moved on (the edit stored, or a revision since)',
		pruneDrafts({ ...answer, recipes: answer.recipes.map((r) => ({ ...r, rev: 2 })) }, drafts).size,
		0,
	);
	check(
		'every chain is priced again with the measured timings (a measurement above the seed raises a guessed card), edited or not',
		(artPlanView({
			...answer,
			timings: [
				{ pipeline: 'sdxl', genPx: 1024, jobs: 9, meanExecSeconds: 900, meanDelaySeconds: 20 },
			],
		}).gpuUsd ?? 0) > (view.gpuUsd ?? 0),
		true,
	);
	check(
		'…so fewer variants cost less under the same timings',
		(() => {
			const timings = [
				{ pipeline: 'sdxl', genPx: 1024, jobs: 9, meanExecSeconds: 900, meanDelaySeconds: 20 },
			];
			const measured = { ...answer, timings };
			return (
				(artPlanView(measured, drafts).gpuUsd ?? Infinity) < (artPlanView(measured).gpuUsd ?? 0)
			);
		})(),
		true,
	);
	check(
		'an edit that breaks a rule counts as invalid, not as unpriced',
		[tooMany.invalid, tooMany.unpriced],
		[row.regions.length, []],
	);
	const dropped = artPlanView({
		...answer,
		recipes: answer.recipes.map((r, i) => (i === 0 ? { ...r, planned: false } : r)),
	});
	check(
		'a recipe the plan dropped is listed apart, and its region as unplanned',
		[dropped.outside, dropped.missing],
		[[stored[0].region], [stored[0].region]],
	);
	const failing = artPlanView({
		...answer,
		recipes: answer.recipes.map((r) =>
			r.region === 'H1'
				? { ...r, failures: { 1: 3 } }
				: r.region === 'H2'
					? { ...r, failures: { 1: 2 } }
					: r,
		),
	});
	const spentRows = failing.groups.flatMap((g) => g.rows).filter((r) => r.spent.length);
	check(
		'a region past its retries is named on its row with how often it failed; one within them is not',
		[spentRows.map((r) => r.spent), spentRows.map(spentLine)],
		[[[{ region: 'H1', times: 3 }]], ['H1 failed 3 times: approving lets it try 3 more times.']],
	);
	check(
		'…each of them, on a row with more than one',
		spentLine({
			spent: [
				{ region: 'H1', times: 3 },
				{ region: 'H2', times: 4 },
			],
		}),
		'H1 failed 3 times; H2 failed 4 times: approving lets each try 3 more times.',
	);
	check('…and a row with none says nothing', spentLine({ spent: [] }), '');

	const flags = licenceList(answer);
	check(
		'before publishing: every blocked or conditional step is listed, grouped by blueprint',
		[
			flags.every((f) => f.licence === 'blocked' || f.licence === 'conditional'),
			flags.reduce((n, f) => n + f.steps.length, 0),
			flags[0]?.licence,
		],
		[
			true,
			stored.reduce(
				(n, r) =>
					n + r.steps.filter((s) => s.licence === 'blocked' || s.licence === 'conditional').length,
				0,
			),
			'blocked',
		],
	);
	check(
		'…each naming its regions and steps',
		flags.find((f) => f.pipeline === 'birefnet')?.steps.includes('H1 (step 2)'),
		true,
	);
	const droppedButRendered = licenceList({
		...answer,
		recipes: answer.recipes.map((r) =>
			r.region === 'H1'
				? {
						...r,
						planned: false,
						steps: r.steps.map((st) =>
							st.n === 1 ? { ...st, status: 'chosen' as const, chosen: '3' } : st,
						),
					}
				: r,
		),
	});
	check(
		'a region a later plan dropped still lists the art it made; what it never ran, it does not',
		[
			droppedButRendered.some((g) => g.steps.includes('H1 (step 1)')),
			droppedButRendered.some((g) => g.steps.includes('H1 (step 2)')),
		],
		[true, false],
	);
	const staleCard = licenceList({
		...answer,
		catalogue: {
			...answer.catalogue!,
			blueprints: answer.catalogue!.blueprints.filter((b) => b.id !== 'birefnet'),
		},
		recipes: answer.recipes.map((r) => ({
			...r,
			steps: r.steps.map((st) => ({ ...st, licence: 'ok' as const })),
		})),
	});
	check(
		'a step whose card is no longer reviewed is listed as conditional, whatever it was planned with',
		staleCard.find((g) => g.pipeline === 'birefnet')?.licence,
		'conditional',
	);

	// How the region was made, as the worker advanced its steps.
	const h1 = stored.find((r) => r.region === 'H1')!;
	const progressed = {
		...h1,
		steps: h1.steps.map((st) =>
			st.kind === 'generate'
				? { ...st, status: 'chosen' as const, rendered: ['7', '8', '9'], chosen: '8' }
				: st.kind === 'process'
					? { ...st, status: 'done' as const, rendered: ['2'] }
					: {
							...st,
							status: 'done' as const,
							chosen: `${st.atlas === h1.atlas ? h1.steps[1].atlas : st.atlas}/${h1.steps[1].region}/2`,
						},
		),
	};
	const made = madeOf({ ...answer, recipes: [{ ...progressed, planned: true }] }, 'H1')!;
	check(
		'how it was made: each step with the image it left',
		made.steps.map((st) => st.image?.id ?? null),
		['8', '2', '2'],
	);
	check('…and the finished tile', made.tile, {
		atlas: h1.steps[1].atlas,
		region: h1.steps[1].region,
		id: '2',
	});
	check('…each step says what its card is for', made.steps[0].purpose.length > 0, true);
	check('a region with no recipe has no story', madeOf(answer, 'Nope'), null);

	// The fold: the checkpoint opens, the plan's rows are news, approval ticks the step.
	const rows: RunEvent[] = [
		{
			id: 1,
			at: 'a',
			agent: 'atlas-technician',
			kind: 'activity',
			tool: 'run.set_recipe',
			payload: {
				type: 'recipe',
				region: 'H1',
				group: 'Symbols',
				rev: 1,
				chain: 'sdxl 1024 ×3 → birefnet → finish',
			},
		},
		{
			id: 2,
			at: 'b',
			agent: 'worker',
			kind: 'checkpoint_open',
			tool: null,
			payload: {
				checkpoint: 'art_plan',
				step: 'style_pack',
				summary: '1 × Symbols: sdxl 1024 ×3 → birefnet → finish',
			},
		},
	];
	const opened = foldEvents(rows, PREFIX);
	check('a recipe row is the recipes version', opened.recipesVersion, 1);
	check('the Art plan opens', opened.artPlan, 'open');
	check(
		'the feed says what was planned and that the plan waits',
		opened.feed.map((f) => f.tone),
		['plain', 'checkpoint'],
	);
	rows.push({
		id: 3,
		at: 'c',
		agent: 'owner',
		kind: 'checkpoint_resolved',
		tool: null,
		payload: { checkpoint: 'art_plan', decision: 'approve', recipeRevs: { H1: 1 } },
	});
	const done = foldEvents(rows, PREFIX);
	check('approving the plan approves it', done.artPlan, 'approved');
	check('no render billed yet: no GPU named by the run', done.gpu, null);
	const billed = foldEvents(
		[
			...rows,
			{
				id: 5,
				at: 'e',
				agent: 'atlas-technician',
				kind: 'spend',
				tool: null,
				payload: { kind: 'runpod', model: 'L40S (48 GB)', usd: 0.1, seconds: 180 },
			},
			{
				id: 6,
				at: 'f',
				agent: 'atlas-technician',
				kind: 'spend',
				tool: null,
				payload: { kind: 'runpod', model: '<b>x</b>', usd: 0.1 },
			},
		],
		PREFIX,
	);
	check(
		'the meter names the GPU the latest render billed on, never markup',
		billed.gpu,
		'L40S (48 GB)',
	);
	check('…in the owner’s words', done.feed.at(-1)?.text, 'approved the Art plan.');
	const again = foldEvents(
		[
			...rows,
			{
				id: 7,
				at: 'g',
				agent: 'worker',
				kind: 'checkpoint_open',
				tool: null,
				payload: {
					checkpoint: 'art_plan',
					step: 'regions',
					reason: 'retries_spent',
					summary:
						'1 × Symbols: sdxl 1024 ×3 → birefnet → finish\nH1 step 1 failed again after 2 retries. Approve to let it try 3 more times.',
					regions: ['H1'],
				},
			},
		],
		PREFIX,
	);
	check(
		'a plan re-opened for a render that kept failing says so, and waits on the owner',
		[again.artPlan, again.feed.at(-1)?.text.startsWith('asks you to approve again a render')],
		['open', true],
	);
	const summary = {
		status: 'running',
		step: 'regions',
	} as RunSummary;
	check(
		'the Style pack step reads Art plan ✓',
		stepViews(summary, done, 0)
			.find((st) => st.id === 'style_pack')
			?.detail.includes('Art plan ✓'),
		true,
	);
	const refusedRows = [
		...rows,
		{
			id: 4,
			at: 'd',
			agent: 'worker',
			kind: 'error',
			tool: null,
			payload: { type: 'refused_request', eventId: 3, error: 'changed' },
		},
	];
	check('a refused approval approves nothing', foldEvents(refusedRows, PREFIX).artPlan, 'open');
}

console.log(`\n${checks} checks, ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
