import {
	RUN_STEPS,
	isBreakdown,
	isRecord,
	modelLabel,
	usd,
	type Breakdown,
	type RunEvent,
	type RunSummary,
} from './director.client';
import { REGION_NAME } from 'director-costs/recipe';

/**
 * The Live run screen's view of a run (PLAN 4.3, ADR-0003 "Live UI"): the run's event rows folded
 * into the steps rail, the region groups and their galleries, the images the events name, the GPU
 * queue and the activity feed. Pure over the event rows the stream delivers (`RunEvent`, ascending
 * by id) and the summary the API answers, so a fixture drives it without a browser.
 *
 * Every payload field is read by shape, never trusted: the rows are the worker's, and a worker of
 * another version — or a model's own words inside an activity row — degrades to text, never to a
 * crash or to markup. Nothing here is rendered as HTML; the page prints the strings as text.
 */

export type RunStep = RunSummary['step'];

// ── Shape readers ─────────────────────────────────────────────────────────────

const str = (value: unknown, max = 4000): string | null =>
	typeof value === 'string' ? value.slice(0, max) : null;
const num = (value: unknown): number | null =>
	typeof value === 'number' && Number.isFinite(value) ? value : null;
const strings = (value: unknown, max = 200): string[] =>
	Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, max) : [];

const STEP_IDS: readonly string[] = RUN_STEPS.map((s) => s.id);
const isStep = (value: unknown): value is RunStep =>
	typeof value === 'string' && STEP_IDS.includes(value);

/** An atlas id as `ops/atlas.ts` `ATLAS` admits it. */
const ATLAS_ID = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,119}$/;
const VARIANT_ID = /^[0-9]{1,8}$/;
const JOB_REF = /^st_[0-9a-f]{16}$/;
/** A GPU as `pricing.json` names one ("L40S (48 GB)"); anything else is not shown. */
const GPU_NAME = /^[A-Za-z0-9][A-Za-z0-9 ()._-]{0,39}$/;
export const isGpuName = (value: unknown): value is string =>
	typeof value === 'string' && GPU_NAME.test(value);

// ── Steps ─────────────────────────────────────────────────────────────────────

export type StepState =
	'done' | 'running' | 'waiting' | 'paused' | 'failed' | 'stopped' | 'skipped' | 'todo';

export interface StepView {
	id: RunStep;
	n: number;
	label: string;
	state: StepState;
	/** One line under the label: the figures for a step, or its state in words. */
	detail: string;
	/** 0–1 for a step with measurable progress (regions approved), else null. */
	progress: number | null;
}

// ── Regions and galleries ─────────────────────────────────────────────────────

export type RegionStatus = 'queued' | 'drafting' | 'to_review' | 'approved' | 'rejected' | 'failed';

export interface VariantRef {
	atlas: string;
	region: string;
	id: string;
	slot: number | null;
}

export interface Verdict {
	verdict: string;
	note: string;
	/** The variant the verdict names, when one of the region's ids or a letter A–H is in it. */
	variant: string | null;
	at: string;
}

export interface RegionView {
	name: string;
	group: string;
	atlas: string | null;
	status: RegionStatus;
	variants: VariantRef[];
	/** The art director's latest verdict on it. */
	pick: Verdict | null;
	/** QA's latest verdict on it. */
	qa: Verdict | null;
	jobRef: string | null;
	/** The breakdown's crop for it, as an R2 key, when one was saved. */
	cropKey: string | null;
	/** Why its last render failed, when it did. */
	error: string | null;
	updatedAt: string;
	/** The id of the event that last changed it: a cache version for its crop. */
	version: number;
	/** The id of the `job_done` that last rendered it: the cache version for its variants. */
	renderVersion: number;
	/**
	 * Named by the coordinator's plan (or no plan yet). A region outside the plan — a scratch
	 * atlas's layer under ADR-0008, a name only a finding mentioned — is shown under "Other
	 * regions" but never counted toward the template's total nor approved with a batch. The hook
	 * for 8E: key regions by (atlas, region) here once scratch atlases carry template names.
	 */
	planned: boolean;
}

export interface GroupCounts {
	total: number;
	approved: number;
	toReview: number;
	drafting: number;
	queued: number;
	rejected: number;
	failed: number;
}

export interface GroupView {
	name: string;
	atlas: string | null;
	regions: RegionView[];
	counts: GroupCounts;
}

/** An image an event named by its R2 key, under the run's project. */
export interface ImageRef {
	key: string;
	/** The subtree under the project the key lives in: `director`, `atlas`, `sheets`, … */
	area: string;
	/** The file name without its extension. */
	label: string;
	eventId: number;
	at: string;
}

export interface GpuJob {
	jobRef: string;
	atlas: string | null;
	regions: string[];
	status: 'queued' | 'finished' | 'failed' | 'cancelled';
	variants: number;
	seconds: number | null;
	agent: string;
	queuedAt: string;
	doneAt: string | null;
}

// ── Feed ──────────────────────────────────────────────────────────────────────

export type FeedTone = 'plain' | 'owner' | 'error' | 'checkpoint' | 'spend' | 'job' | 'status';

export interface FeedEntry {
	id: number;
	at: string;
	agent: string;
	kind: string;
	/** The run's step when the row was written. */
	step: RunStep;
	text: string;
	/** The tool used, as a short label, when the row names one. */
	tool: string | null;
	/** What the row cost, when it is a spend row. */
	cost: string | null;
	tone: FeedTone;
}

export interface Folded {
	groups: GroupView[];
	regions: Map<string, RegionView>;
	images: ImageRef[];
	jobs: GpuJob[];
	/** Renders queued and not yet done. */
	gpuQueued: number;
	breakdown: { images: number; regionsMatched: number; regionsTotal: number } | null;
	plan: { summary: string; batches: { name: string; regions: string[] }[] } | null;
	/** The feed, oldest first; the page reverses and caps it. */
	feed: FeedEntry[];
	/** When each step was first entered, from the `run_status` rows. */
	stepStartedAt: Partial<Record<RunStep, string>>;
	/** Where the Art plan checkpoint stands (ADR-0008 §7): never opened, open, approved, sent back. */
	artPlan: 'none' | 'open' | 'approved' | 'revised';
	/** The id of the last row that changed a recipe: the cache version of the run's recipes. */
	recipesVersion: number;
	/** The id of the coordinator's last plan row: a new plan can take recipes' approval away. */
	planVersion: number;
	/** The GPU the run's latest render was billed on, as its spend row names it. */
	gpu: string | null;
}

// ── Labels ────────────────────────────────────────────────────────────────────

/** `atlas.queue_variants` → `Atlas Maker`, `run.post_activity` → null (the agent's own words). */
export function toolLabel(tool: string | null): string | null {
	if (!tool) return null;
	const [prefix] = tool.split('.');
	switch (prefix) {
		case 'atlas':
			return tool === 'atlas.queue_variants' ? 'ComfyUI · RunPod' : 'Atlas Maker';
		case 'comfyui':
			return 'ComfyUI';
		case 'mockups':
			return 'Mockups';
		case 'gamemaker':
			return 'Game Maker';
		case 'scene':
			return 'Scene Editor';
		case 'symbols':
			return 'Symbols SM';
		case 'wintext':
			return 'Win Text';
		case 'localization':
			return 'Localization';
		case 'fonts':
			return 'Font Maker';
		case 'rigger':
			return 'Rigger';
		case 'flipbook':
			return 'Flipbook';
		case 'build':
			return 'Build';
		case 'run':
		case 'costs':
			return null;
		default:
			return prefix.slice(0, 40);
	}
}

/** `H2_Coral_Mask` → `H2 · Coral Mask`; `BG_Base` → `BG · Base`; `Wild` → `Wild`. */
export function regionTitle(name: string): string {
	const parts = name.split(/[_\s]+/).filter(Boolean);
	if (parts.length >= 2 && /^[A-Z]{1,3}\d{0,2}$/.test(parts[0])) {
		return `${parts[0]} · ${parts.slice(1).join(' ')}`;
	}
	return parts.join(' ');
}

export const STATUS_WORDS: Record<RegionStatus, string> = {
	queued: 'Queued',
	drafting: 'Drafting',
	to_review: 'To review',
	approved: 'Approved',
	rejected: 'Redo',
	failed: 'Failed',
};

const clip = (text: string, max: number) =>
	text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** `H2_Coral_Mask`, `h2 coral mask` and `H2 · Coral mask` all compare equal. */
const normal = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

const emptyCounts = (): GroupCounts => ({
	total: 0,
	approved: 0,
	toReview: 0,
	drafting: 0,
	queued: 0,
	rejected: 0,
	failed: 0,
});

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

/**
 * Whether `key` is an image key under `prefix` the page may ask the image route for: the route
 * refuses the same shapes, so a key that fails here would only make a 404.
 */
export function isProjectImageKey(key: string, prefix: string): boolean {
	return (
		key.startsWith(`${prefix}/`) &&
		key.length <= 1024 &&
		!key.includes('..') &&
		!key.includes('//') &&
		!key.includes('\\') &&
		!/\p{Cc}/u.test(key) &&
		IMAGE_EXT.test(key)
	);
}

const AREA_LABELS: Record<string, string> = {
	director: 'Mockup crops',
	atlas: 'Atlas pages',
	sheets: 'Sheets',
	manifests: 'Atlases',
	symbols: 'Symbols',
	editor: 'Scenes',
	input: 'References',
	batch: 'Renders',
	spines: 'Spines',
	fonts: 'Fonts',
};

export const areaLabel = (area: string): string => AREA_LABELS[area] ?? area;

// ── Folding ───────────────────────────────────────────────────────────────────

interface Ctx {
	prefix: string;
	regions: Map<string, RegionView>;
	/** Batch name by the NORMALISED region name the plan wrote (`normal`). */
	groupOf: Map<string, string>;
	/** The atlases the plan's regions rendered on: a region there is the template's too. */
	planAtlases: Set<string>;
	groupOrder: string[];
	images: Map<string, ImageRef>;
	jobs: Map<string, GpuJob>;
	plan: Folded['plan'];
	breakdown: Folded['breakdown'];
	feed: FeedEntry[];
	step: RunStep;
	stepStartedAt: Partial<Record<RunStep, string>>;
	/** The regions to review when the open `region_batch` checkpoint was opened. */
	openBatch: Set<string> | null;
	/** Ids of owner rows the worker refused (`refused_request`), collected before the fold. */
	refused: Set<number>;
	artPlan: Folded['artPlan'];
	recipesVersion: number;
	planVersion: number;
	gpu: string | null;
}

const OTHER_GROUP = 'Other regions';

/**
 * With a plan, a region is the template's when the plan names it — however the coordinator
 * spelled it: `H2 Coral Mask` and `H2_Coral_Mask` are one name — or when it rendered on an atlas
 * the plan's regions render on. Before a plan, every region is. What is left is the scratch-atlas
 * case: a layer on an atlas no planned region uses.
 */
const isPlanned = (ctx: Ctx, region: Pick<RegionView, 'name' | 'atlas'>) =>
	ctx.plan === null ||
	ctx.groupOf.has(normal(region.name)) ||
	(region.atlas !== null && ctx.planAtlases.has(region.atlas));

/** A region's atlas became known: a planned region's atlas plans every region on it. */
function noteAtlas(ctx: Ctx, region: RegionView, atlas: string) {
	region.atlas = atlas;
	if (ctx.groupOf.has(normal(region.name))) ctx.planAtlases.add(atlas);
	for (const other of ctx.regions.values()) other.planned = isPlanned(ctx, other);
}

/** A `refused_request` error row: the worker could not apply the owner row it names. */
export function isRefusedRequest(
	event: RunEvent,
): event is RunEvent & { payload: { eventId: number } } {
	return (
		event.kind === 'error' &&
		isRecord(event.payload) &&
		event.payload.type === 'refused_request' &&
		typeof event.payload.eventId === 'number'
	);
}

/** The ids of the owner rows the run's `refused_request` rows name. */
export function refusedIds(events: readonly RunEvent[]): Set<number> {
	const ids = new Set<number>();
	for (const event of events) if (isRefusedRequest(event)) ids.add(event.payload.eventId);
	return ids;
}

/**
 * Whether a row is news to the page: newer than the summary it opened with. Before that summary
 * (`baseline` null) nothing is; a run with no rows yet has baseline 0, and everything after is.
 */
export const isNews = (baseline: number | null, id: number): boolean =>
	baseline !== null && id > baseline;

function regionOf(ctx: Ctx, name: string, at: string, version: number): RegionView | null {
	if (!REGION_NAME.test(name)) return null;
	let region = ctx.regions.get(name);
	if (!region) {
		region = {
			name,
			group: ctx.groupOf.get(normal(name)) ?? OTHER_GROUP,
			atlas: null,
			status: 'queued',
			variants: [],
			pick: null,
			qa: null,
			jobRef: null,
			cropKey: null,
			error: null,
			updatedAt: at,
			version,
			renderVersion: 0,
			planned: true,
		};
		region.planned = isPlanned(ctx, region);
		ctx.regions.set(name, region);
	}
	return region;
}

function touch(region: RegionView, at: string, version: number) {
	region.updatedAt = at;
	region.version = version;
}

/** Every image key the payload names, at any depth the worker writes (crops are three deep). */
function collectImageKeys(value: unknown, ctx: Ctx, event: RunEvent, depth = 0) {
	if (depth > 6) return;
	if (typeof value === 'string') {
		if (isProjectImageKey(value, ctx.prefix)) {
			const rest = value.slice(ctx.prefix.length + 1);
			const area = rest.split('/')[0] ?? '';
			const file = rest.split('/').pop() ?? rest;
			ctx.images.set(value, {
				key: value,
				area,
				label: file.replace(IMAGE_EXT, ''),
				eventId: event.id,
				at: event.at,
			});
		}
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value.slice(0, 500)) collectImageKeys(item, ctx, event, depth + 1);
	} else if (isRecord(value)) {
		for (const item of Object.values(value)) collectImageKeys(item, ctx, event, depth + 1);
	}
}

/** `H2 · Coral mask` → `h2 coral mask`, as whole tokens. */
const tokens = (text: string) =>
	text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);

/**
 * The region a finding is about: its subject IS a region name (however punctuated), or every
 * token of a region's name appears as a whole token of the subject, the longest such name
 * winning. A one-word subject under three characters names nothing: "A" is a letter, not a
 * region, and no substring ever matches.
 */
function findRegion(ctx: Ctx, subject: string): RegionView | null {
	const wanted = normal(subject);
	if (wanted.length < 3) return null;
	const words = new Set(tokens(subject));
	let best: RegionView | null = null;
	for (const region of ctx.regions.values()) {
		if (normal(region.name) === wanted) return region;
		const parts = tokens(region.name);
		if (parts.length && parts.every((part) => words.has(part))) {
			if (!best || parts.length > tokens(best.name).length) best = region;
		}
	}
	return best;
}

const LETTERS = 'ABCDEFGH';

/**
 * The variant a verdict names: one of the region's ids, or "variant B" / "option C" in render
 * order. A bare letter is never one: a sentence starting with "A" names nothing.
 */
function variantNamed(region: RegionView, text: string): string | null {
	for (const v of region.variants) {
		if (new RegExp(`(^|[^0-9])${v.id}([^0-9]|$)`).test(text)) return v.id;
	}
	const letter = /\b(?:variant|option)\s+([A-H])\b/i.exec(text)?.[1]?.toUpperCase();
	if (letter) {
		const index = LETTERS.indexOf(letter);
		const sorted = [...region.variants].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
		return sorted[index]?.id ?? null;
	}
	return null;
}

const PICK = /\b(pick|picked|approve|approved|accept|accepted|pass|passed|choose|chose|chosen)\b/i;
const REJECT = /\b(reject|rejected|fail|failed|redo|retry|again)\b/i;

function applyFindings(
	ctx: Ctx,
	event: RunEvent,
	findings: unknown,
	field: 'pick' | 'qa',
): { subjects: number } {
	if (!Array.isArray(findings)) return { subjects: 0 };
	let subjects = 0;
	for (const finding of findings.slice(0, 200)) {
		if (!isRecord(finding)) continue;
		const subject = str(finding.subject, 200);
		const verdict = str(finding.verdict, 40) ?? '';
		const note = str(finding.note, 2000) ?? '';
		if (!subject) continue;
		subjects++;
		const region = findRegion(ctx, subject);
		if (!region) continue;
		const named = variantNamed(region, `${verdict} ${note}`);
		region[field] = { verdict, note, variant: named, at: event.at };
		if (field === 'pick') {
			if (REJECT.test(verdict) && !PICK.test(verdict)) {
				if (region.status === 'to_review') region.status = 'rejected';
			}
		}
		touch(region, event.at, event.id);
	}
	return { subjects };
}

const costOf = (payload: Record<string, unknown>): string | null => {
	const amount = num(payload.usd);
	if (amount === null) return null;
	const model = str(payload.model, 60);
	if (payload.kind === 'runpod') {
		const seconds = num(payload.seconds);
		const gpu = model ? `RunPod ${model}` : 'RunPod';
		const est = payload.estimated === true ? ' (estimated)' : '';
		return `${usd(amount)} · ${gpu}${seconds !== null ? ` · ${Math.round(seconds)} s` : ''}${est}`;
	}
	return `${usd(amount)}${model ? ` · ${modelLabel(model)}` : ''}`;
};

function push(ctx: Ctx, event: RunEvent, text: string, tone: FeedTone, cost: string | null = null) {
	ctx.feed.push({
		id: event.id,
		at: event.at,
		agent: event.agent,
		kind: event.kind,
		step: ctx.step,
		text: clip(text, 1200),
		tool: toolLabel(event.tool),
		cost,
		tone,
	});
}

const list = (names: string[]) =>
	names.length <= 3
		? names.map(regionTitle).join(', ')
		: `${names.slice(0, 2).map(regionTitle).join(', ')} and ${names.length - 2} more`;

function foldActivity(ctx: Ctx, event: RunEvent, p: Record<string, unknown>) {
	switch (p.type) {
		case 'note':
			return push(ctx, event, str(p.text) ?? str(p.message) ?? '', 'plain');
		case 'question':
			return push(ctx, event, `asks you: ${str(p.question) ?? ''}`, 'checkpoint');
		case 'plan': {
			const summary = str(p.summary) ?? '';
			const batches: { name: string; regions: string[] }[] = [];
			if (Array.isArray(p.batches)) {
				for (const b of p.batches.slice(0, 64)) {
					if (!isRecord(b)) continue;
					const name = str(b.name, 120);
					if (!name) continue;
					// The plan's names are the coordinator's words (`run.set_plan` only bounds them), so
					// they are kept as written for grouping and matched normalised; a name that is also
					// a region name as the adapter admits it stands for the region itself.
					batches.push({ name, regions: strings(b.regions, 200) });
				}
			}
			ctx.plan = { summary, batches };
			ctx.planVersion = event.id;
			ctx.groupOf.clear();
			ctx.planAtlases.clear();
			ctx.groupOrder = [];
			for (const b of batches) {
				if (!ctx.groupOrder.includes(b.name)) ctx.groupOrder.push(b.name);
				for (const name of b.regions) {
					if (!normal(name)) continue;
					ctx.groupOf.set(normal(name), b.name);
					if (REGION_NAME.test(name)) regionOf(ctx, name, event.at, event.id);
				}
			}
			for (const region of ctx.regions.values()) {
				region.group = ctx.groupOf.get(normal(region.name)) ?? OTHER_GROUP;
				if (region.atlas && ctx.groupOf.has(normal(region.name))) ctx.planAtlases.add(region.atlas);
			}
			for (const region of ctx.regions.values()) region.planned = isPlanned(ctx, region);
			return push(
				ctx,
				event,
				`set the plan: ${summary}${batches.length ? ` (${batches.length} batches)` : ''}`,
				'plain',
			);
		}
		case 'assignment':
			return push(
				ctx,
				event,
				`gave ${str(p.to, 40) ?? 'an agent'} a task: ${clip(str(p.task) ?? '', 240)}`,
				'plain',
			);
		case 'pipeline_change_request':
			return push(
				ctx,
				event,
				`asks for a pipeline change: ${str(p.what) ?? ''}${p.reason ? ` — ${str(p.reason)}` : ''}`,
				'checkpoint',
			);
		case 'review': {
			const { subjects } = applyFindings(ctx, event, p.findings, 'pick');
			return push(
				ctx,
				event,
				`reviewed ${subjects} region${subjects === 1 ? '' : 's'}: ${str(p.summary) ?? ''}`,
				'plain',
			);
		}
		case 'qa': {
			const { subjects } = applyFindings(ctx, event, p.findings, 'qa');
			return push(
				ctx,
				event,
				`QA on ${subjects} item${subjects === 1 ? '' : 's'}: ${str(p.summary) ?? ''}`,
				'plain',
			);
		}
		case 'breakdown_image':
			// One per mockup per pass, each carrying the model's full answer: noise in the feed.
			return;
		case 'recipe_step':
			// A pick or a committed tile, recorded on the recipe ("How this was made").
			ctx.recipesVersion = event.id;
			return push(ctx, event, str(p.text, 400) ?? 'recorded a step of a recipe', 'plain');
		case 'recipe': {
			ctx.recipesVersion = event.id;
			const region = str(p.region, 120) ?? 'a region';
			const chain = str(p.chain, 400) ?? '';
			const rev = num(p.rev);
			const by = str(p.editedBy, 120) ? 'stored your edit of' : 'planned';
			return push(
				ctx,
				event,
				`${by} ${regionTitle(region)}${rev !== null && rev > 1 ? ` (revision ${rev})` : ''}: ${chain}`,
				'plain',
			);
		}
		default: {
			if (isBreakdown(p.breakdown)) readBreakdown(ctx, event, p.breakdown);
			const images = num(p.images);
			const matched = num(p.regionsMatched);
			const total = num(p.regionsTotal);
			if (images !== null && matched !== null && total !== null) {
				ctx.breakdown = { images, regionsMatched: matched, regionsTotal: total };
			}
			const text = str(p.message) ?? str(p.text) ?? str(p.summary);
			return push(ctx, event, text ?? `${str(p.type, 40) ?? 'activity'}`, 'plain');
		}
	}
}

function readBreakdown(ctx: Ctx, event: RunEvent, breakdown: Breakdown) {
	ctx.breakdown = {
		images: breakdown.images.length,
		regionsMatched: breakdown.regionsMatched,
		regionsTotal: breakdown.regionsTotal,
	};
	for (const crop of breakdown.crops?.saved ?? []) {
		if (!isProjectImageKey(crop.key, ctx.prefix)) continue;
		const region = regionOf(ctx, crop.region, event.at, event.id);
		if (region) region.cropKey = crop.key;
	}
}

function foldCheckpoint(ctx: Ctx, event: RunEvent, p: Record<string, unknown>) {
	const checkpoint = str(p.checkpoint, 40) ?? 'checkpoint';
	const summary = str(p.summary) ?? str(p.message) ?? '';
	if (checkpoint === 'breakdown') {
		if (isBreakdown(p.breakdown)) readBreakdown(ctx, event, p.breakdown);
		return push(ctx, event, 'opened the mockup breakdown for your review.', 'checkpoint');
	}
	if (checkpoint === 'region_batch') {
		// The batch the owner is asked about is what waits for them now; a batch rendered while
		// they review is the next one, not this one.
		ctx.openBatch = new Set(
			[...ctx.regions.values()].filter((r) => r.status === 'to_review').map((r) => r.name),
		);
		return push(ctx, event, `asks you to review a region batch. ${summary}`, 'checkpoint');
	}
	if (checkpoint === 'art_plan') {
		ctx.artPlan = 'open';
		const ask =
			str(p.reason, 40) === 'retries_spent'
				? 'asks you to approve again a render that kept failing.'
				: 'asks you to review the Art plan before anything renders.';
		return push(ctx, event, `${ask}${summary ? ` ${summary}` : ''}`, 'checkpoint');
	}
	if (checkpoint === 'before_publish') {
		return push(
			ctx,
			event,
			`asks you to review the build before hand-off. ${summary}`,
			'checkpoint',
		);
	}
	if (checkpoint === 'budget') {
		const spent = num(p.spentUsd);
		const cap = num(p.capUsd);
		const figures = spent !== null && cap !== null ? ` ${usd(spent)} of ${usd(cap)} spent.` : '';
		return push(ctx, event, `${summary}${figures}`, 'error');
	}
	return push(ctx, event, `opened the ${checkpoint} checkpoint. ${summary}`, 'checkpoint');
}

function foldResolved(ctx: Ctx, event: RunEvent, p: Record<string, unknown>) {
	const decision = str(p.decision, 20) ?? 'resolved';
	const checkpoint = str(p.checkpoint, 40) ?? 'checkpoint';
	const note = str(p.note);
	// A row the worker refused (the run had moved on) resolved nothing: its `refused_request`
	// error row says so in the feed, and the regions stay as they were.
	const refused = ctx.refused.has(event.id);
	// Approving a batch approves what was waiting in it when it opened; approving the build
	// accepts whatever is still to review. Only the plan's regions: see `RegionView.planned`.
	if (
		!refused &&
		(checkpoint === 'region_batch' || checkpoint === 'before_publish') &&
		decision === 'approve'
	) {
		const batch = checkpoint === 'region_batch' && ctx.openBatch?.size ? ctx.openBatch : null;
		for (const region of ctx.regions.values()) {
			if (region.status !== 'to_review' || !region.planned) continue;
			if (batch && !batch.has(region.name)) continue;
			region.status = 'approved';
			touch(region, event.at, event.id);
		}
		ctx.openBatch = null;
	}
	if (!refused && checkpoint === 'art_plan') {
		ctx.artPlan = decision === 'approve' ? 'approved' : 'revised';
	}
	const verb = refused
		? `asked to ${decision}`
		: decision === 'approve'
			? 'approved'
			: decision === 'revise'
				? 'sent back'
				: decision;
	const what =
		checkpoint === 'breakdown'
			? 'the mockup breakdown'
			: checkpoint === 'art_plan'
				? 'the Art plan'
				: checkpoint === 'region_batch'
					? 'the region batch'
					: checkpoint === 'before_publish'
						? 'the build'
						: `the ${checkpoint} checkpoint`;
	push(
		ctx,
		event,
		`${verb} ${what}${note ? `: “${note}”` : ''}${refused ? ' — the worker refused it.' : note ? '' : '.'}`,
		'owner',
	);
}

function foldJobQueued(ctx: Ctx, event: RunEvent, p: Record<string, unknown>) {
	const jobRef = str(p.jobRef, 40) ?? '';
	const atlas = str(p.atlas, 64);
	const regions = strings(p.regions, 64).filter((r) => REGION_NAME.test(r));
	if (JOB_REF.test(jobRef)) {
		ctx.jobs.set(jobRef, {
			jobRef,
			atlas: ATLAS_ID.test(atlas ?? '') ? atlas : null,
			regions,
			status: 'queued',
			variants: 0,
			seconds: null,
			agent: event.agent,
			queuedAt: event.at,
			doneAt: null,
		});
	}
	for (const name of regions) {
		const region = regionOf(ctx, name, event.at, event.id);
		if (!region) continue;
		region.status = 'drafting';
		region.jobRef = JOB_REF.test(jobRef) ? jobRef : null;
		region.error = null;
		if (atlas && ATLAS_ID.test(atlas)) noteAtlas(ctx, region, atlas);
		touch(region, event.at, event.id);
	}
	push(
		ctx,
		event,
		`queued a render of ${regions.length} region${regions.length === 1 ? '' : 's'}${atlas ? ` on ${atlas}` : ''}: ${list(regions)}.`,
		'job',
	);
}

function foldJobDone(ctx: Ctx, event: RunEvent, p: Record<string, unknown>) {
	const jobRef = str(p.jobRef, 40) ?? '';
	const atlas = str(p.atlas, 64);
	const regions = strings(p.regions, 64).filter((r) => REGION_NAME.test(r));
	const status = p.status === 'finished' || p.status === 'cancelled' ? p.status : 'failed';
	const result = isRecord(p.result) ? p.result : {};
	const rendered = new Map<string, VariantRef[]>();
	if (Array.isArray(result.variants)) {
		for (const v of result.variants.slice(0, 512)) {
			if (!isRecord(v)) continue;
			const region = str(v.region, 120);
			const id = str(v.variant, 8) ?? str(v.id, 8);
			if (!region || !id || !REGION_NAME.test(region) || !VARIANT_ID.test(id)) continue;
			if (!atlas || !ATLAS_ID.test(atlas)) continue;
			const refs = rendered.get(region) ?? [];
			// A callback is delivered at least once; a variant listed twice is one variant.
			if (!refs.some((ref) => ref.id === id)) refs.push({ atlas, region, id, slot: num(v.slot) });
			rendered.set(region, refs);
		}
	}
	const error = str(result.error, 400);
	const runpod = isRecord(result.runpod) ? result.runpod : {};
	const seconds = num(runpod.seconds);
	const job = ctx.jobs.get(jobRef);
	let variants = 0;
	for (const refs of rendered.values()) variants += refs.length;
	if (job) {
		job.status = status;
		job.variants = variants;
		job.seconds = seconds;
		job.doneAt = event.at;
	}
	for (const name of new Set([...regions, ...rendered.keys()])) {
		const region = regionOf(ctx, name, event.at, event.id);
		if (!region) continue;
		const refs = rendered.get(name) ?? [];
		if (refs.length) {
			// A new render replaces the last: the owner judges what is there now.
			region.variants = [...refs].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
			region.renderVersion = event.id;
			region.status = 'to_review';
			region.pick = null;
			region.qa = null;
			region.error = null;
		} else if (status !== 'finished' || regions.includes(name)) {
			region.status = region.variants.length ? 'to_review' : 'failed';
			region.error =
				error ??
				(status === 'cancelled' ? 'The render was cancelled.' : 'The render produced nothing.');
		}
		if (atlas && ATLAS_ID.test(atlas)) noteAtlas(ctx, region, atlas);
		touch(region, event.at, event.id);
	}
	const text =
		status === 'finished'
			? `rendered ${variants} variant${variants === 1 ? '' : 's'} of ${list([...rendered.keys()])}${seconds !== null ? ` in ${Math.round(seconds)} s of GPU time` : ''}.`
			: `render ${jobRef || ''} ${status}${error ? `: ${error}` : '.'}`;
	push(ctx, event, text, status === 'finished' ? 'job' : 'error');
}

function foldStatus(ctx: Ctx, event: RunEvent, p: Record<string, unknown>) {
	const to = isRecord(p.to) ? p.to : {};
	const status = str(to.status, 20) ?? '';
	const cause = str(p.cause, 200);
	if (isStep(to.step)) {
		ctx.stepStartedAt[to.step] ??= event.at;
		ctx.step = to.step;
	}
	const stepLabel = RUN_STEPS.find((s) => s.id === to.step)?.label ?? '';
	const waitingOn = str(to.waitingOn, 40);
	const words =
		status === 'waiting'
			? `the run waits for you${waitingOn ? ` at the ${waitingOn.replace('_', ' ')} checkpoint` : ''}`
			: status === 'running'
				? `the run is working on ${stepLabel || 'the next step'}`
				: status === 'paused'
					? 'the run paused'
					: status === 'handed_off'
						? 'the run is handed off: the draft is yours to publish'
						: status === 'failed'
							? 'the run failed'
							: status === 'stopped'
								? 'the run stopped'
								: status === 'stopping'
									? 'the run is stopping'
									: `the run is ${status}`;
	push(ctx, event, `${words}${cause ? ` (${cause})` : ''}.`, 'status');
}

function foldOwnerRequest(ctx: Ctx, event: RunEvent, p: Record<string, unknown>) {
	const action = str(p.action, 20) ?? 'request';
	const cap = num(p.budgetCapUsd);
	const words =
		action === 'start'
			? 'started the agents'
			: action === 'pause'
				? 'asked the run to pause'
				: action === 'resume'
					? `resumed the run${cap !== null ? `, cap raised to ${usd(cap)}` : ''}`
					: action === 'stop'
						? 'asked the run to stop'
						: `asked to ${action}`;
	push(ctx, event, `${words}.`, 'owner');
}

function foldError(ctx: Ctx, event: RunEvent, p: Record<string, unknown>) {
	const type = str(p.type, 40) ?? 'error';
	const message = str(p.message) ?? str(p.error) ?? type;
	if (type === 'refused_request') {
		return push(ctx, event, `refused a request: ${message}`, 'error');
	}
	push(ctx, event, message, 'error');
}

/**
 * Fold the run's rows, oldest first, into the screen's views. `prefix` is the run's project
 * prefix in R2 (`<client>/<project>`), the only place an image the events name may live.
 */
export function foldEvents(events: readonly RunEvent[], prefix: string): Folded {
	const ctx: Ctx = {
		prefix,
		regions: new Map(),
		groupOf: new Map(),
		planAtlases: new Set(),
		groupOrder: [],
		images: new Map(),
		jobs: new Map(),
		plan: null,
		breakdown: null,
		feed: [],
		step: 'breakdown',
		stepStartedAt: {},
		openBatch: null,
		refused: refusedIds(events),
		artPlan: 'none',
		recipesVersion: 0,
		planVersion: 0,
		gpu: null,
	};
	for (const event of events) {
		if (typeof event.id !== 'number' || typeof event.at !== 'string') continue;
		const p = isRecord(event.payload) ? event.payload : {};
		collectImageKeys(p, ctx, event);
		switch (event.kind) {
			case 'activity':
				foldActivity(ctx, event, p);
				break;
			case 'owner_message':
				push(ctx, event, `“${str(p.text) ?? ''}”`, 'owner');
				break;
			case 'owner_request':
				foldOwnerRequest(ctx, event, p);
				break;
			case 'checkpoint_open':
				foldCheckpoint(ctx, event, p);
				break;
			case 'checkpoint_resolved':
				foldResolved(ctx, event, p);
				break;
			case 'job_queued':
				foldJobQueued(ctx, event, p);
				break;
			case 'job_done':
				foldJobDone(ctx, event, p);
				break;
			case 'spend':
				if (p.kind === 'runpod' && isGpuName(p.model)) ctx.gpu = p.model;
				push(
					ctx,
					event,
					p.kind === 'runpod' ? 'GPU time billed' : 'model call billed',
					'spend',
					costOf(p),
				);
				break;
			case 'run_status':
				foldStatus(ctx, event, p);
				break;
			case 'error':
				foldError(ctx, event, p);
				break;
			case 'region_status': {
				const name = str(p.region, 120);
				const region = name ? regionOf(ctx, name, event.at, event.id) : null;
				const status = str(p.status, 20);
				if (region && status && status in STATUS_WORDS) {
					region.status = status as RegionStatus;
					touch(region, event.at, event.id);
				}
				push(
					ctx,
					event,
					`${name ? regionTitle(name) : 'a region'} is ${status ?? 'updated'}.`,
					'plain',
				);
				break;
			}
			default:
				push(ctx, event, str(p.message) ?? str(p.text) ?? event.kind, 'plain');
		}
	}

	// Groups: the plan's batches in order, then any other group a region landed in.
	const order = [...ctx.groupOrder];
	for (const region of ctx.regions.values()) {
		if (!order.includes(region.group)) order.push(region.group);
	}
	const groups: GroupView[] = order.map((name) => {
		const regions = [...ctx.regions.values()].filter((r) => r.group === name);
		const planned = (ctx.plan?.batches.find((b) => b.name === name)?.regions ?? []).map(normal);
		regions.sort((a, b) => {
			const ia = planned.indexOf(normal(a.name));
			const ib = planned.indexOf(normal(b.name));
			if (ia !== -1 || ib !== -1) return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
			return a.name.localeCompare(b.name);
		});
		const counts = emptyCounts();
		for (const r of regions) {
			counts.total++;
			if (r.status === 'approved') counts.approved++;
			else if (r.status === 'to_review') counts.toReview++;
			else if (r.status === 'drafting') counts.drafting++;
			else if (r.status === 'queued') counts.queued++;
			else if (r.status === 'rejected') counts.rejected++;
			else counts.failed++;
		}
		const atlases = new Set(regions.map((r) => r.atlas).filter((a): a is string => a !== null));
		return { name, atlas: atlases.size === 1 ? [...atlases][0] : null, regions, counts };
	});

	const jobs = [...ctx.jobs.values()].sort((a, b) => b.queuedAt.localeCompare(a.queuedAt));
	return {
		groups,
		regions: ctx.regions,
		images: [...ctx.images.values()].sort((a, b) => b.eventId - a.eventId),
		jobs,
		gpuQueued: jobs.filter((j) => j.status === 'queued').length,
		breakdown: ctx.breakdown,
		plan: ctx.plan,
		feed: ctx.feed,
		stepStartedAt: ctx.stepStartedAt,
		artPlan: ctx.artPlan,
		recipesVersion: ctx.recipesVersion,
		planVersion: ctx.planVersion,
		gpu: ctx.gpu,
	};
}

// ── The steps rail ────────────────────────────────────────────────────────────

const TERMINAL: readonly RunSummary['status'][] = ['stopped', 'failed', 'handed_off'];

export function stepViews(run: RunSummary, folded: Folded, mockupCount: number): StepView[] {
	const current = RUN_STEPS.find((s) => s.id === run.step)?.n ?? 1;
	const planned = [...folded.regions.values()].filter((r) => r.planned);
	const approved = planned.filter((r) => r.status === 'approved').length;
	const regionsTotal = folded.breakdown?.regionsTotal ?? planned.length;
	return RUN_STEPS.map((step) => {
		let state: StepState;
		if (run.status === 'handed_off') state = 'done';
		else if (step.n < current) state = 'done';
		else if (step.n > current) {
			state = TERMINAL.includes(run.status) || run.status === 'stopping' ? 'skipped' : 'todo';
		} else {
			switch (run.status) {
				case 'running':
					state = 'running';
					break;
				case 'waiting':
					state = 'waiting';
					break;
				case 'paused':
					state = 'paused';
					break;
				case 'failed':
					state = 'failed';
					break;
				case 'stopped':
				case 'stopping':
					state = 'stopped';
					break;
				default:
					state = 'todo';
			}
		}
		let detail: string;
		let progress: number | null = null;
		switch (step.id) {
			case 'breakdown':
				detail = folded.breakdown
					? `${folded.breakdown.images} mockup${folded.breakdown.images === 1 ? '' : 's'} · ${folded.breakdown.regionsMatched} of ${folded.breakdown.regionsTotal} regions matched`
					: mockupCount
						? `${mockupCount} mockup${mockupCount === 1 ? '' : 's'} to read`
						: 'A style board from your notes';
				break;
			case 'style_pack': {
				detail = mockupCount
					? 'Palette and refs taken from your mockups'
					: 'Palette and refs from your notes';
				// The Art plan is a checkpoint inside this step (ADR-0008 §7).
				const plan =
					folded.artPlan === 'approved'
						? 'Art plan ✓'
						: folded.artPlan === 'open'
							? 'Art plan waiting'
							: folded.artPlan === 'revised'
								? 'Art plan being revised'
								: '';
				if (plan) detail = `${detail} · ${plan}`;
				break;
			}
			case 'regions':
				detail = regionsTotal
					? `${approved} of ${regionsTotal} approved`
					: 'Variants to review, group by group';
				if (regionsTotal) progress = Math.min(1, approved / regionsTotal);
				break;
			case 'build':
				detail = 'Scene Editor, Symbols SM, Win Text';
				break;
			default:
				detail = 'You publish it in Game Maker';
		}
		const stateWord: Partial<Record<StepState, string>> = {
			waiting: 'Waiting for you',
			paused: 'Paused',
			failed: 'Failed',
			stopped: 'Stopped',
			skipped: 'Not reached',
		};
		const word = stateWord[state];
		return {
			id: step.id,
			n: step.n,
			label: step.label,
			state,
			detail: word && step.id !== 'regions' ? `${word} · ${detail}` : detail,
			progress,
		};
	});
}

/** Insert `event` into `events` (ascending by id) unless its id is already there. */
export function insertEvent(events: RunEvent[], event: RunEvent): boolean {
	let lo = 0;
	let hi = events.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (events[mid].id < event.id) lo = mid + 1;
		else hi = mid;
	}
	if (events[lo]?.id === event.id) return false;
	events.splice(lo, 0, event);
	return true;
}

/** Rows the fold can do without: billing, the per-image analysis, notes and errors. */
const DROPPABLE_ACTIVITY = new Set(['breakdown_image', 'note', 'question', 'assignment']);
export function isDroppable(event: RunEvent): boolean {
	if (event.kind === 'spend') return true;
	// A refusal is structural: without it a refused approval would read as an approval.
	if (event.kind === 'error') return !isRefusedRequest(event);
	if (event.kind !== 'activity') return false;
	const type = isRecord(event.payload) ? event.payload.type : undefined;
	return typeof type === 'string' && DROPPABLE_ACTIVITY.has(type);
}

/**
 * Keep `events` within `max` rows by dropping the oldest droppable rows first: the plan, the
 * renders, the checkpoints and the status rows are what the galleries and the rail are built
 * from, so they go last, and only when the run has more structural rows than the cap.
 */
export function trimEvents(events: RunEvent[], max: number): void {
	let over = events.length - max;
	if (over <= 0) return;
	for (let i = 0; i < events.length && over > 0;) {
		if (isDroppable(events[i])) {
			events.splice(i, 1);
			over--;
		} else {
			i++;
		}
	}
	if (over > 0) events.splice(0, over);
}
