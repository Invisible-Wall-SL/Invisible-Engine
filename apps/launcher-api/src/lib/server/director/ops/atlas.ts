import { SUB, projectPrefix } from '../../projectPaths';
import { getObjectTextWithEtag, listAllKeys } from '../../r2';
import { AdapterError, defineOp, type AdapterContext, type ObjectSchema } from '../adapter';
import {
	atlasFetch,
	manifestDocId,
	manifestFile,
	writtenVersions,
	type DocBase,
} from '../atlasClient';
import { JOB_REF, callbackFor, readJobView, runpodUsageOf, startAtlasJobWatch } from '../atlasJobs';
import { doneOpResults, getAtlasJob, insertAtlasJob, projectOpResults, runRecipes } from '../store';

/**
 * Atlas Maker adapters (PLAN 2.4). Reads come straight from the project's manifests in R2, the
 * same keys `templates.ts` counts regions from. Everything that changes the atlas goes through
 * atlas-tool's own routes (`/save`, `/render`, `/createatlas`), so each manifest write is its
 * compare-and-swap (`doc_sync`) and carries `saved_by.tool = 'director'` with the agent. Nothing
 * here deploys an atlas, publishes, or writes Game Config.
 */

export const ATLAS = '^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,119}$';
// No space: atlas-tool's variant routes take the region from the raw, undecoded path.
export const REGION = '^[A-Za-z0-9_][A-Za-z0-9_.()-]{0,119}$';
export const VARIANT_ID = '^[0-9]{1,8}$';
/** atlas-tool's variant tiles: a JPEG thumb, or the full PNG. */
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export const atlasProp = {
	type: 'string',
	description: 'The atlas id (its manifest stem).',
	pattern: ATLAS,
} as const;
export const regionProp = {
	type: 'string',
	description: 'The region name.',
	pattern: REGION,
} as const;
export const baseProp = {
	type: 'object',
	description:
		"The manifest version a write is based on, as atlas.get_region returned it. A person's save since then makes the write a conflict; omit it to base the write on the version read now.",
	properties: {
		etag: { type: 'string', maxLength: 200 },
		rev: { type: 'string', maxLength: 64 },
	},
	required: ['etag', 'rev'],
	additionalProperties: false,
} as const satisfies ObjectSchema;

export interface ManifestRegion {
	name: string;
	prompt?: string;
	gpt_prompt?: string;
	negative?: string;
	negative_replace?: boolean;
	positive_replace?: boolean;
	seed?: number;
	lock?: boolean;
	variant?: string;
	variant_at?: string;
	skip_unless_explicit?: boolean;
	mode?: string;
	layer_of?: string;
	pipeline?: string;
	style_ref?: string;
	shape_ref?: string;
	fit_mode?: string;
	output_override?: string;
	x?: number;
	y?: number;
	w?: number;
	h?: number;
	rotated?: boolean;
}

export interface Manifest {
	atlas?: {
		width?: number;
		height?: number;
		layout?: string;
		atlas_file?: string;
		source_image_path?: string;
	};
	regions?: ManifestRegion[];
	rotated_regions?: ManifestRegion[];
	/** Per-atlas settings; `pipeline` only on an atlas a Director run configured (8B). */
	settings?: Record<string, unknown> & {
		pipeline?: string;
		gen_width?: unknown;
		gen_height?: unknown;
	};
	deploy_path?: string;
	saved_by?: { rev?: string; tool?: string; name?: string; agent?: string; at?: string };
}

export interface LoadedManifest {
	atlas: string;
	key: string;
	doc: Manifest;
	base: DocBase;
	regions: (ManifestRegion & { rotated: boolean })[];
}

export const manifestKey = (scope: NonNullable<AdapterContext['scope']>, atlas: string) =>
	`${SUB.manifests(scope.clientKey, scope.projectKey)}/${manifestFile(atlas)}`;

export async function loadManifest(ctx: AdapterContext, atlas: string): Promise<LoadedManifest> {
	const key = manifestKey(ctx.scope!, atlas);
	const got = await getObjectTextWithEtag(key);
	if (!got) throw new AdapterError(404, 'unknown_atlas', `No atlas "${atlas}" in this project.`);
	let doc: Manifest;
	try {
		doc = JSON.parse(got.text) as Manifest;
	} catch {
		throw new AdapterError(502, 'bad_manifest', `The manifest of "${atlas}" is not valid JSON.`);
	}
	const regions = [
		...(doc.regions ?? []).map((r) => ({ ...r, rotated: false })),
		...(doc.rotated_regions ?? []).map((r) => ({ ...r, rotated: true })),
	].filter((r) => typeof r.name === 'string' && r.name);
	return { atlas, key, doc, base: { etag: got.etag ?? '', rev: doc.saved_by?.rev ?? '' }, regions };
}

export function requireRegion(m: LoadedManifest, region: string) {
	const found = m.regions.find((r) => r.name === region);
	if (!found) {
		throw new AdapterError(404, 'unknown_region', `No region "${region}" in atlas "${m.atlas}".`);
	}
	return found;
}

const regionSummary = (r: LoadedManifest['regions'][number]) => ({
	name: r.name,
	prompt: r.prompt ?? '',
	chosenVariant: r.variant ?? null,
	locked: Boolean(r.lock),
	skipped: Boolean(r.skip_unless_explicit),
	mode: r.mode ?? null,
	layerOf: r.layer_of ?? null,
	size: typeof r.w === 'number' && typeof r.h === 'number' ? { w: r.w, h: r.h } : null,
	rotated: r.rotated,
});

/**
 * One region's card as atlas-tool's `/save` takes it. `/save` posts a WHOLE card and clears what
 * it omits (`apply_region_edits`), so a change is the region's stored values with one field moved.
 */
function cardOf(
	r: ManifestRegion,
	change: Partial<{
		prompt: string;
		negative: string;
		gptPrompt: string;
		variant: string;
		lock: boolean;
		seed: number | null;
	}>,
) {
	// `batch_atlas.region_locked`: a manifest written before the explicit flag is locked by a
	// stored seed or pick, and a card that said otherwise would unpin it and drop the seed.
	const stored = 'lock' in r ? Boolean(r.lock) : r.seed !== undefined || Boolean(r.variant?.trim());
	const locked = change.lock ?? stored;
	const seed = change.seed !== undefined ? change.seed : (r.seed ?? null);
	return {
		name: r.name,
		prompt: change.prompt ?? r.prompt ?? '',
		gpt_prompt: change.gptPrompt ?? r.gpt_prompt ?? '',
		negative: change.negative ?? r.negative ?? '',
		negative_replace: Boolean(r.negative_replace),
		positive_replace: Boolean(r.positive_replace),
		variant: change.variant ?? r.variant ?? '',
		selected: !r.skip_unless_explicit,
		lock: locked,
		seed: locked && seed !== null ? String(seed) : '',
	};
}

async function saveCard(
	ctx: AdapterContext,
	m: LoadedManifest,
	card: ReturnType<typeof cardOf>,
	base: DocBase | undefined,
) {
	const answer = await atlasFetch(ctx, {
		method: 'POST',
		path: '/save',
		atlas: m.atlas,
		body: [card],
		bases: { [manifestDocId(m.atlas)]: base ?? m.base },
	});
	const message = answer.text();
	if (!message.startsWith('Saved')) {
		throw new AdapterError(502, 'atlas_refused', message.slice(0, 300));
	}
	return { message, version: writtenVersions(answer)[manifestDocId(m.atlas)] ?? null };
}

/** The manifest key an atlas write lands on — what the gate's write-target guard checks. */
export const writesManifest = (
	input: { atlas: string },
	scope: { clientKey: string; projectKey: string },
) => [manifestKey(scope, input.atlas)];

/** The atlases this run made with `atlas.duplicate_atlas`: its scratch atlases (ADR-0008 §5). */
export async function scratchAtlases(
	ctx: AdapterContext,
	of: 'run' | 'project' = 'run',
): Promise<Set<string>> {
	const results =
		of === 'run'
			? await doneOpResults(ctx.run.id, 'atlas.duplicate_atlas')
			: await projectOpResults(ctx.run.projectKey, 'atlas.duplicate_atlas');
	return new Set(
		results
			.map((r) => (r as { atlas?: unknown } | null)?.atlas)
			.filter((a): a is string => typeof a === 'string'),
	);
}

interface RecipeStep {
	n: number;
	kind: string;
	pipeline: string;
	atlas: string;
	region: string;
	genPx: number;
	variants: number;
	settings?: { key: string; value: string }[];
	status?: string;
}
interface RecipeRow {
	region: string;
	atlas: string;
	rev: number;
	approved: { rev: number } | null;
	steps: RecipeStep[];
}

/**
 * The queue gate (ADR-0008 §3, §5): a render runs only for an approved recipe step. Every region
 * must have one on this atlas with these variants, the pipeline the region renders with (its own
 * override, else the atlas's, which a Director run always sets) and the atlas's generation size;
 * `step` must name one of them. While the Art plan is open nothing is approved, so nothing renders.
 */
async function requireApprovedSteps(
	ctx: AdapterContext,
	m: LoadedManifest,
	regions: string[],
	variants: number,
	step: string,
): Promise<{ recipe: string; n: number; region: string }[]> {
	if (ctx.run.waitingOn === 'art_plan') {
		throw new AdapterError(
			409,
			'art_plan_open',
			'The Art plan is with the owner: nothing renders until it is approved.',
		);
	}
	const atlasPipe = String(m.doc.settings?.pipeline ?? '').toLowerCase();
	const genW = Number(m.doc.settings?.gen_width);
	const genH = Number(m.doc.settings?.gen_height);
	if (!atlasPipe || !Number.isFinite(genW) || genW !== genH) {
		throw new AdapterError(
			409,
			'atlas_not_configured',
			`Set "${m.atlas}"'s pipeline and size with atlas.set_atlas_pipeline before rendering.`,
		);
	}
	const recipes = (await runRecipes(ctx.run.id)) as RecipeRow[];
	const scratch = await scratchAtlases(ctx);
	// A step renders its recipe's own template region, or a region of a scratch atlas this run made;
	// a step that names any other atlas is never a licence to render it.
	const approvedSteps = recipes
		.filter((r) => r.approved && r.approved.rev === r.rev)
		.flatMap((r) =>
			r.steps
				.filter((s) => (s.atlas === r.atlas ? s.region === r.region : scratch.has(s.atlas)))
				.map((s) => ({ ...s, recipe: r.region })),
		)
		// Rendered once: an approved region is never re-sampled (§5); a redo is a new revision.
		.filter((s) => !s.status || s.status === 'planned' || s.status === 'failed');
	const settings = (m.doc.settings ?? {}) as Record<string, unknown>;
	const bpParams = (settings.bpParams ?? {}) as Record<string, Record<string, unknown>>;
	/** The step's settings as the atlas and region now hold them. */
	const settingsHold = (s: RecipeStep, r: ManifestRegion) =>
		(s.settings ?? []).every(({ key, value }) => {
			const atlasValue = bpParams[s.pipeline]?.[key] ?? settings[key];
			const regionValue = (r as unknown as Record<string, unknown>)[key];
			return [atlasValue, regionValue].some((v) => v !== undefined && String(v) === value);
		});
	const [stepRegion, stepN] = step.split('#');
	if (!regions.includes(stepRegion)) {
		throw new AdapterError(
			400,
			'invalid_input',
			`step ${step} names a region this call does not render.`,
		);
	}
	const problems: string[] = [];
	const matched: { recipe: string; n: number; region: string }[] = [];
	for (const name of regions) {
		const r = requireRegion(m, name);
		const pipeline = r.pipeline?.trim().toLowerCase() || atlasPipe;
		const match = approvedSteps.find(
			(s) =>
				s.kind !== 'finish' &&
				s.atlas === m.atlas &&
				s.region === name &&
				s.pipeline === pipeline &&
				s.genPx === genW &&
				s.variants === variants &&
				settingsHold(s, r) &&
				(name !== stepRegion || String(s.n) === stepN),
		);
		if (!match) {
			problems.push(`${name} (${pipeline} ${genW} px ×${variants})`);
		} else {
			matched.push({ recipe: match.recipe, n: match.n, region: name });
		}
	}
	if (problems.length) {
		throw new AdapterError(
			409,
			'no_approved_step',
			`No approved, not yet rendered recipe step renders ${problems.join(', ')} on "${m.atlas}" with the settings it now holds. Check the atlas setup against the approved recipe, or revise the recipe (run.set_recipe) for the owner.`,
		);
	}
	return matched;
}

export const listRegions = defineOp<
	{ atlas?: string },
	{
		atlases: {
			atlas: string;
			boundToAtlasFile: boolean;
			regions: ReturnType<typeof regionSummary>[];
		}[];
	}
>({
	tool: 'atlas',
	name: 'list_regions',
	description:
		"The regions of one Atlas Maker atlas, or of every atlas in the run's project when no atlas is named: name, prompt, chosen variant, lock, size. An atlas `boundToAtlasFile` lists only the regions that already have a manifest entry.",
	inputSchema: {
		type: 'object',
		properties: { atlas: atlasProp },
		additionalProperties: false,
	},
	agents: ['atlas-artist', 'atlas-technician', 'mockup-analyst'],
	scope: 'project',
	write: false,
	handler: async (ctx, { atlas }) => {
		const ids = atlas
			? [atlas]
			: (await listAllKeys(`${SUB.manifests(ctx.scope!.clientKey, ctx.scope!.projectKey)}/`))
					.map((k) => /\/atlas_manifest_([^/]+)\.json$/.exec(k)?.[1])
					.filter((id): id is string => Boolean(id))
					.sort();
		const atlases = [];
		for (const id of ids) {
			const m = await loadManifest(ctx, id);
			atlases.push({
				atlas: id,
				boundToAtlasFile: Boolean(m.doc.atlas?.atlas_file),
				regions: m.regions.map(regionSummary),
			});
		}
		return { atlases };
	},
});

export const getRegion = defineOp<{ atlas: string; region: string }, Record<string, unknown>>({
	tool: 'atlas',
	name: 'get_region',
	description:
		"One region in full: prompt, negative, chosen variant, lock and seed, mode, layer base, its pipeline override and the atlas's own pipeline and size, style and shape refs, fit mode, committed tile (outputOverride), geometry, and the manifest version (`base`) to hand back to a write.",
	inputSchema: {
		type: 'object',
		properties: { atlas: atlasProp, region: regionProp },
		required: ['atlas', 'region'],
		additionalProperties: false,
	},
	agents: ['atlas-artist', 'atlas-technician', 'art-director'],
	scope: 'project',
	write: false,
	handler: async (ctx, { atlas, region }) => {
		const m = await loadManifest(ctx, atlas);
		const r = requireRegion(m, region);
		return {
			...regionSummary(r),
			negative: r.negative ?? '',
			gptPrompt: r.gpt_prompt ?? '',
			seed: r.seed ?? null,
			pipeline: r.pipeline ?? null,
			atlasPipeline: m.doc.settings?.pipeline ?? null,
			genPx: m.doc.settings?.gen_width ?? null,
			styleRef: r.style_ref ?? null,
			shapeRef: r.shape_ref ?? null,
			fitMode: r.fit_mode ?? null,
			outputOverride: r.output_override ?? null,
			position: typeof r.x === 'number' && typeof r.y === 'number' ? { x: r.x, y: r.y } : null,
			savedBy: m.doc.saved_by ?? null,
			base: m.base,
		};
	},
});

export const setRegionPrompt = defineOp<
	{
		atlas: string;
		region: string;
		prompt: string;
		negative?: string;
		gptPrompt?: string;
		base?: DocBase;
	},
	{ atlas: string; region: string; message: string; version: DocBase | null }
>({
	tool: 'atlas',
	name: 'set_region_prompt',
	description:
		"Set a region's generation prompt, and optionally its negative and (for gpt_image) its edit instruction `gptPrompt`. Saved through the Atlas Maker's own save, compare-and-swapped: a conflict means someone saved this atlas since `base` — re-read and retry.",
	inputSchema: {
		type: 'object',
		properties: {
			atlas: atlasProp,
			region: regionProp,
			prompt: { type: 'string', pattern: '\\S', maxLength: 4000 },
			negative: { type: 'string', maxLength: 2000 },
			gptPrompt: { type: 'string', maxLength: 4000 },
			base: baseProp,
		},
		required: ['atlas', 'region', 'prompt'],
		additionalProperties: false,
	},
	agents: ['atlas-artist'],
	scope: 'project',
	write: true,
	writes: writesManifest,
	handler: async (ctx, { atlas, region, prompt, negative, gptPrompt, base }) => {
		const m = await loadManifest(ctx, atlas);
		const r = requireRegion(m, region);
		const saved = await saveCard(
			ctx,
			m,
			cardOf(r, { prompt: prompt.trim(), negative, gptPrompt }),
			base,
		);
		return { atlas, region, ...saved };
	},
});

export const queueVariants = defineOp<
	{ atlas: string; regions: string[]; variants: number; step: string },
	{
		jobRef: string;
		status: 'queued';
		atlas: string;
		regions: string[];
		variants: number;
		callback: boolean;
		tracked: boolean;
		/** The approved recipe steps this render runs, for the worker to mark queued. */
		steps: { recipe: string; n: number; region: string }[];
	}
>({
	tool: 'atlas',
	name: 'queue_variants',
	description:
		"Queue variant renders for regions of one atlas and return a jobRef at once, for an APPROVED recipe step: every region must have an approved step on this atlas with this many variants, the atlas's pipeline and size. `step` names one of them as `<region>#<n>`. Never wait or poll for it: the run is told when the job is done.",
	inputSchema: {
		type: 'object',
		properties: {
			atlas: atlasProp,
			regions: { type: 'array', items: regionProp, maxItems: 32 },
			variants: { type: 'integer', minimum: 1, maximum: 8 },
			step: {
				type: 'string',
				description: 'The approved recipe step this render runs, `<region>#<n>`.',
				pattern: '^[A-Za-z0-9_][A-Za-z0-9_.()-]{0,119}#[0-9]{1,2}$',
			},
		},
		required: ['atlas', 'regions', 'variants', 'step'],
		additionalProperties: false,
	},
	agents: ['atlas-technician'],
	scope: 'project',
	write: true,
	// The render's variants, its job records, and the post-hook's machine write to the manifest.
	writes: (input, scope) => {
		const root = projectPrefix(scope.clientKey, scope.projectKey);
		return [...writesManifest(input, scope), `${root}/batch/`, `${root}/_jobs/still/`];
	},
	handler: async (ctx, { atlas, regions, variants, step }) => {
		const names = [...new Set(regions)];
		if (names.length === 0)
			throw new AdapterError(400, 'invalid_input', 'Name at least one region.');
		const m = await loadManifest(ctx, atlas);
		for (const name of names) requireRegion(m, name);
		// Only approved, not yet rendered recipe steps render (ADR-0008 §3, §5).
		const steps = await requireApprovedSteps(ctx, m, names, variants, step);
		let callback = callbackFor(ctx.run.id);
		const render = () =>
			atlasFetch(ctx, {
				method: 'POST',
				path: '/render',
				atlas,
				body: { names, variants, ...callback },
			});
		let answer;
		try {
			answer = await render();
		} catch (e) {
			// atlas-tool without ATLAS_CALLBACK_SECRET refuses any callback: the poll settles it.
			const unconfigured =
				e instanceof AdapterError && /callbacks are not configured/.test(e.message);
			if (!callback || !unconfigured) throw e;
			callback = null;
			answer = await render();
		}
		const started = answer.json<{ started: boolean; message: string; jobRef: string | null }>();
		if (!started.started || !started.jobRef || !new RegExp(JOB_REF).test(started.jobRef)) {
			throw new AdapterError(409, 'busy', started.message || 'The Atlas Maker is busy rendering.');
		}
		// The render is running now: failing the op here would release its opId, and the retry
		// would start a second render. An unrecorded job is reported instead.
		let tracked = true;
		try {
			await insertAtlasJob({
				jobRef: started.jobRef,
				runId: ctx.run.id,
				agent: ctx.agent,
				atlas,
				regions: names,
			});
			startAtlasJobWatch(ctx, started.jobRef);
		} catch (e) {
			tracked = false;
			console.error(`director atlas job ${started.jobRef}: not recorded:`, e);
		}
		return {
			jobRef: started.jobRef,
			status: 'queued',
			atlas,
			regions: names,
			variants,
			callback: callback !== null,
			tracked,
			steps,
		};
	},
});

export const listVariants = defineOp<
	{ atlas: string; region: string },
	{ region: string; chosen: string | null; variants: { id: string; seed: number | null }[] }
>({
	tool: 'atlas',
	name: 'list_variants',
	description: "A region's rendered variants, newest first, and which one is chosen.",
	inputSchema: {
		type: 'object',
		properties: { atlas: atlasProp, region: regionProp },
		required: ['atlas', 'region'],
		additionalProperties: false,
	},
	agents: ['atlas-artist', 'atlas-technician', 'art-director'],
	scope: 'project',
	write: false,
	handler: async (ctx, { atlas, region }) => {
		const m = await loadManifest(ctx, atlas);
		const r = requireRegion(m, region);
		const answer = await atlasFetch(ctx, {
			method: 'GET',
			path: `/variants/${encodeURIComponent(region)}`,
			atlas,
		});
		return {
			region,
			chosen: r.variant ?? null,
			variants: answer.json<{ id: string; seed: number | null }[]>(),
		};
	},
});

export const getVariantImage = defineOp<
	{ atlas: string; region: string; id: string; size?: 'thumb' | 'full' },
	{ region: string; id: string; contentType: string; bytes: number; base64: string }
>({
	tool: 'atlas',
	name: 'get_variant_image',
	description: "One rendered variant's image (a JPEG thumb by default, or the full PNG), base64.",
	inputSchema: {
		type: 'object',
		properties: {
			atlas: atlasProp,
			region: regionProp,
			id: {
				type: 'string',
				description: 'A variant id from atlas.list_variants.',
				pattern: VARIANT_ID,
			},
			size: { type: 'string', enum: ['thumb', 'full'] },
		},
		required: ['atlas', 'region', 'id'],
		additionalProperties: false,
	},
	agents: ['art-director', 'qa'],
	scope: 'project',
	write: false,
	handler: async (ctx, { atlas, region, id, size }) => {
		const answer = await atlasFetch(ctx, {
			method: 'GET',
			path: `/${size === 'full' ? 'vfull' : 'vthumb'}/${encodeURIComponent(region)}`,
			atlas,
			query: { id },
		});
		const contentType = answer.contentType.split(';')[0].trim();
		// A missing variant is answered with a placeholder SVG, not a 404.
		if (!/^image\/(png|jpeg|webp)$/.test(contentType)) {
			throw new AdapterError(404, 'unknown_variant', `No variant ${id} of "${region}".`);
		}
		if (answer.bytes.length > MAX_IMAGE_BYTES) {
			throw new AdapterError(
				413,
				'too_large',
				`Variant ${id} is too large to return; ask for the thumb.`,
			);
		}
		return {
			region,
			id,
			contentType,
			bytes: answer.bytes.length,
			base64: Buffer.from(answer.bytes).toString('base64'),
		};
	},
});

export const chooseVariant = defineOp<
	{ atlas: string; region: string; id: string; lock?: boolean; base?: DocBase },
	{
		atlas: string;
		region: string;
		chosen: string;
		locked: boolean;
		message: string;
		version: DocBase | null;
	}
>({
	tool: 'atlas',
	name: 'choose_variant',
	description:
		"Make a rendered variant the region's tile, and lock it (with the variant's seed) or not. The region's other fields are re-sent unchanged. Compare-and-swapped like set_region_prompt: a conflict means someone saved this atlas since `base`.",
	inputSchema: {
		type: 'object',
		properties: {
			atlas: atlasProp,
			region: regionProp,
			id: {
				type: 'string',
				description: 'A variant id from atlas.list_variants.',
				pattern: VARIANT_ID,
			},
			lock: {
				type: 'boolean',
				description:
					'Pin the pick and its seed so a re-render skips it. false never unpins a region that is pinned now; omitted keeps the pin as it is.',
			},
			base: baseProp,
		},
		required: ['atlas', 'region', 'id'],
		additionalProperties: false,
	},
	agents: ['atlas-technician'],
	scope: 'project',
	write: true,
	writes: writesManifest,
	handler: async (ctx, { atlas, region, id, lock, base }) => {
		const m = await loadManifest(ctx, atlas);
		const r = requireRegion(m, region);
		const listed = await atlasFetch(ctx, {
			method: 'GET',
			path: `/variants/${encodeURIComponent(region)}`,
			atlas,
		});
		const picked = listed.json<{ id: string; seed: number | null }[]>().find((v) => v.id === id);
		if (!picked) {
			throw new AdapterError(404, 'unknown_variant', `No variant ${id} of "${region}".`);
		}
		// A pin someone set stays: `lock: false` never unpins a region that is locked now.
		const stored =
			'lock' in r ? Boolean(r.lock) : r.seed !== undefined || Boolean(r.variant?.trim());
		// Without `lock` the region keeps its pin and seed as they are (the pre-8D card).
		const keep = lock === undefined ? stored : lock || stored;
		const card =
			lock === undefined
				? cardOf(r, { variant: id })
				: cardOf(r, { variant: id, lock: keep, seed: keep ? picked.seed : null });
		const saved = await saveCard(ctx, m, card, base);
		return { atlas, region, chosen: id, locked: keep, ...saved };
	},
});

export const packSheet = defineOp<
	{ atlas: string },
	{ atlas: string; started: true; message: string }
>({
	tool: 'atlas',
	name: 'pack_sheet',
	description:
		"Pack and compose the atlas's sheet from each region's chosen variant (the Atlas Maker's Create Atlas). It never deploys. Check the result with atlas.sheet_stats.",
	inputSchema: {
		type: 'object',
		properties: { atlas: atlasProp },
		required: ['atlas'],
		additionalProperties: false,
	},
	agents: ['atlas-technician'],
	scope: 'project',
	write: true,
	// The packed layout (machine manifest writes), rebuilt FX layers in batch/, and the page.
	writes: (input, scope) => [
		...writesManifest(input, scope),
		`${projectPrefix(scope.clientKey, scope.projectKey)}/batch/`,
		`${SUB.atlas(scope.clientKey, scope.projectKey)}/`,
	],
	handler: async (ctx, { atlas }) => {
		await loadManifest(ctx, atlas);
		if ((await scratchAtlases(ctx, 'project')).has(atlas)) {
			throw new AdapterError(
				409,
				'scratch_atlas',
				`"${atlas}" is a scratch atlas: it is never packed.`,
			);
		}
		const answer = await atlasFetch(ctx, { method: 'POST', path: '/createatlas', atlas, body: {} });
		const res = answer.json<{ started: boolean; message: string }>();
		if (!res.started)
			throw new AdapterError(409, 'busy', res.message || 'The Atlas Maker is busy.');
		return { atlas, started: true, message: res.message };
	},
});

export const sheetStats = defineOp<{ atlas: string }, Record<string, unknown>>({
	tool: 'atlas',
	name: 'sheet_stats',
	description:
		"The atlas's sheet in numbers: page size, region count, how much of the page the regions fill, and the regions with no prompt or no chosen variant.",
	inputSchema: {
		type: 'object',
		properties: { atlas: atlasProp },
		required: ['atlas'],
		additionalProperties: false,
	},
	agents: ['qa'],
	scope: 'project',
	write: false,
	handler: async (ctx, { atlas }) => {
		const m = await loadManifest(ctx, atlas);
		const width = m.doc.atlas?.width ?? null;
		const height = m.doc.atlas?.height ?? null;
		const placed = m.regions.filter(
			(r) => [r.x, r.y, r.w, r.h].every((n) => typeof n === 'number') && !r.layer_of,
		);
		const area = placed.reduce((sum, r) => sum + r.w! * r.h!, 0);
		const overflow = placed.filter(
			(r) => width !== null && height !== null && (r.x! + r.w! > width || r.y! + r.h! > height),
		);
		return {
			atlas,
			page: width && height ? { width, height } : null,
			regions: m.regions.length,
			rotated: m.regions.filter((r) => r.rotated).length,
			placed: placed.length,
			fill: width && height ? Math.round((area / (width * height)) * 1000) / 1000 : null,
			outsidePage: overflow.map((r) => r.name),
			withoutPrompt: m.regions.filter((r) => !r.prompt?.trim()).map((r) => r.name),
			withoutChosenVariant: m.regions.filter((r) => !r.variant).map((r) => r.name),
			pageImage: m.doc.atlas?.source_image_path ?? null,
			boundToAtlasFile: Boolean(m.doc.atlas?.atlas_file),
			savedBy: m.doc.saved_by ?? null,
		};
	},
});

export const jobStatus = defineOp<{ jobRef: string }, Record<string, unknown>>({
	tool: 'comfyui',
	name: 'job_status',
	description:
		"One look at a queued render's progress (jobs done of total, variants so far, GPU seconds spent). Do not call it in a loop: the run is told when the job is done.",
	inputSchema: {
		type: 'object',
		properties: { jobRef: { type: 'string', pattern: JOB_REF } },
		required: ['jobRef'],
		additionalProperties: false,
	},
	agents: ['atlas-technician'],
	scope: 'project',
	write: false,
	handler: async (ctx, { jobRef }) => {
		const job = await getAtlasJob(jobRef);
		if (!job || job.runId !== ctx.run.id) {
			throw new AdapterError(404, 'unknown_job', `This run queued no job ${jobRef}.`);
		}
		const view = await readJobView(ctx, jobRef);
		const jobs = view.jobs ?? [];
		return {
			jobRef,
			status: view.status,
			recorded: job.status,
			total: view.total ?? jobs.length,
			done: jobs.filter((j) => j.status === 'done').length,
			failed: jobs.filter((j) => ['failed', 'lost', 'abandoned'].includes(j.status)).length,
			variants: view.variants ?? [],
			runpod: runpodUsageOf(view.runpod),
			error: view.error ?? null,
		};
	},
});

export const ATLAS_OPS = [
	listRegions,
	getRegion,
	setRegionPrompt,
	queueVariants,
	listVariants,
	getVariantImage,
	chooseVariant,
	packSheet,
	sheetStats,
	jobStatus,
];
