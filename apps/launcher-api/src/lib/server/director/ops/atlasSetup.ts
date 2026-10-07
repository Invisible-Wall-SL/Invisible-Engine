import { createHash } from 'node:crypto';
import {
	REGION_NAME,
	type Card,
	type CardSetting,
	type Catalogue,
	type CatalogueEntry,
} from 'director-costs/recipe';
import { projectPrefix } from '../../projectPaths';
import { ConflictError, getObjectBytes, putObjectBytes } from '../../r2';
import { cropKey } from '../mockups';
import {
	AdapterError,
	RefusalError,
	defineOp,
	type AdapterContext,
	type ObjectSchema,
} from '../adapter';
import {
	atlasFetch,
	manifestDocId,
	writtenVersions,
	type AtlasAnswer,
	type DocBase,
} from '../atlasClient';
import { doneOpResults } from '../store';
import {
	MAX_IMAGE_BYTES,
	VARIANT_ID,
	atlasProp,
	baseProp,
	loadManifest,
	manifestKey,
	regionProp,
	requireRegion,
	scratchAtlases,
	writesManifest,
	type LoadedManifest,
} from './atlas';

/**
 * The atlas technician's set-up ops (ADR-0008 §4): read the reviewed blueprint catalogue, set an
 * atlas's own pipeline and settings, a region's pipeline override and references, make scratch
 * atlases and their layers, commit a chain's last pick as a template region's tile, and deploy a
 * template atlas. Every call names its atlas (`?manifest=`), goes through atlas-tool's own routes
 * as the run's owner and is compare-and-swapped on the manifest. What an op must never do is
 * refused from its input before atlas-tool is called (`RefusalError`), and atlas-tool refuses the
 * same things again for a Director token (card 8B, 8D).
 */

/** atlas-tool's `PER_ATLAS_KEYS`: the only settings `/saveconfig` stores on the atlas itself. */
export const PER_ATLAS_KEYS: ReadonlySet<string> = new Set([
	'checkpoint',
	'lora',
	'lora_strength',
	'controlnet',
	'rmbg_model',
	'rembg',
	'ipadapter_weight',
	'ipadapter_weight_type',
	'controlnet_strength',
	'controlnet_end_percent',
	'ksampler_steps',
	'ksampler_cfg',
	'padding_pct',
	'shape_ref_fill_pct',
	'gen_width',
	'gen_height',
]);
/** atlas-tool's `ADV_FIELDS` that hold settings, as `/saveadv` takes them per region. */
export const REGION_KEYS: ReadonlySet<string> = new Set([
	'ipadapter_weight',
	'redux_strength',
	'flux_lora_strength',
	'controlnet_strength',
	'controlnet_end_percent',
	'checkpoint',
	'fit_mode',
	'gpt_rembg',
]);
const FX_MODES = ['glow', 'shadow', 'shine', 'blur', 'zoom', 'colour'] as const;
const PIPELINE = '^[a-z0-9_]{0,64}$';
const SHEET_KEY =
	/^(?:[a-z0-9_-]+\/[a-z0-9_-]+\/)?(?:sheets|sheet_src)\/[A-Za-z0-9_./() -]{1,300}$/;

/** A reply atlas-tool marks as not done (its severity glyphs). */
const FAILED = /^\s*(✖|⚠|ℹ|📦)/;

function textOk(answer: AtlasAnswer, ok: RegExp = /./): string {
	const message = answer.text().trim();
	if (FAILED.test(message) || !ok.test(message)) {
		throw new AdapterError(502, 'atlas_refused', message.slice(0, 300));
	}
	return message;
}

const versionOf = (answer: AtlasAnswer, atlas: string) =>
	writtenVersions(answer)[manifestDocId(atlas)] ?? null;

// ── The catalogue ─────────────────────────────────────────────────────────────

const CATALOGUE_TTL_MS = 60_000;
let cached: { at: number; value: Catalogue } | null = null;

/** The reviewed image cards atlas-tool serves to agents (`GET /blueprints?kind=image`), a minute. */
export async function catalogue(ctx: AdapterContext, now = Date.now()): Promise<Catalogue> {
	if (cached && now - cached.at < CATALOGUE_TTL_MS) return cached.value;
	const answer = await atlasFetch(ctx, {
		method: 'GET',
		path: '/blueprints',
		query: { kind: 'image' },
	});
	const body = answer.json<{ gpu?: unknown; blueprints?: unknown }>();
	const list = Array.isArray(body.blueprints) ? body.blueprints : [];
	const value: Catalogue = {
		gpu: typeof body.gpu === 'string' ? body.gpu : '',
		blueprints: list
			.filter(
				(b): b is CatalogueEntry =>
					typeof b === 'object' &&
					b !== null &&
					typeof (b as CatalogueEntry).id === 'string' &&
					(b as CatalogueEntry).kind === 'image' &&
					(b as { status?: unknown }).status === 'reviewed' &&
					typeof (b as CatalogueEntry).card === 'object' &&
					(b as CatalogueEntry).card !== null,
			)
			.map((b) => ({
				id: b.id,
				name: b.name,
				kind: b.kind,
				builtin: Boolean(b.builtin),
				roles: Array.isArray(b.roles) ? b.roles : [],
				card: b.card,
			})),
	};
	cached = { at: now, value };
	return value;
}

/** Forget the cached catalogue (fixtures). */
export function resetCatalogueCache(): void {
	cached = null;
}

async function cardFor(
	ctx: AdapterContext,
	pipeline: string,
): Promise<{ entry: CatalogueEntry; card: Card }> {
	const entry = (await catalogue(ctx)).blueprints.find((b) => b.id === pipeline);
	if (!entry) {
		throw new AdapterError(
			400,
			'no_card',
			`"${pipeline}" has no reviewed card: agents may not use it.`,
		);
	}
	return { entry, card: entry.card };
}

export const listBlueprints = defineOp<Record<string, never>, Catalogue>({
	tool: 'atlas',
	name: 'list_blueprints',
	description:
		"The pipelines agents may use: every image blueprint whose card the owner reviewed (and that still matches its graph), each with its card (purpose, when to use it, inputs, settings and their ranges and scopes, variants, GPU seconds, billing, licence, gotchas), its bound roles, plus the endpoint's GPU. A pipeline not listed here does not exist for you.",
	inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	agents: ['atlas-technician', 'coordinator', 'worker'],
	scope: 'project',
	write: false,
	handler: (ctx) => catalogue(ctx),
});

// ── Settings ──────────────────────────────────────────────────────────────────

const settingsProp = {
	type: 'array',
	description: 'Settings the card names, as text values.',
	items: {
		type: 'object',
		properties: {
			key: { type: 'string', pattern: '^[A-Za-z0-9_]{1,64}$' },
			value: { type: 'string', maxLength: 200 },
		},
		required: ['key', 'value'],
		additionalProperties: false,
	},
	maxItems: 24,
} as const;

type Setting = { key: string; value: string };

/** The card's setting `key` in `scope`, or a refusal naming why it may not be sent. */
function cardSetting(card: Card, pipeline: string, key: string, scope: 'atlas' | 'region') {
	if (key === 'run_on') throw new RefusalError('run_on');
	const setting = card.settings?.find((s) => s.key === key);
	if (!setting) {
		throw new AdapterError(400, 'not_on_card', `"${pipeline}"'s card names no setting ${key}.`);
	}
	if ((setting.scope ?? 'atlas') !== scope) {
		throw new AdapterError(
			400,
			'wrong_scope',
			`${key} is a per-${setting.scope ?? 'atlas'} setting of "${pipeline}".`,
		);
	}
	return setting;
}

/** A setting value in the card's own range, typed as the card declares it. */
function typedValue(setting: CardSetting, key: string, value: string): string | number | boolean {
	if (setting.options?.length) {
		if (!setting.options.map(String).includes(value)) {
			throw new AdapterError(400, 'bad_setting', `${key} is one of ${setting.options.join(', ')}.`);
		}
		return setting.options.find((o) => String(o) === value)!;
	}
	if (typeof setting.default === 'boolean') {
		if (value !== 'true' && value !== 'false')
			throw new AdapterError(400, 'bad_setting', `${key} is true or false.`);
		return value === 'true';
	}
	const numeric =
		typeof setting.default === 'number' || setting.min !== undefined || setting.max !== undefined;
	if (!numeric) return value;
	const n = Number(value);
	if (value.trim() === '' || !Number.isFinite(n))
		throw new AdapterError(400, 'bad_setting', `${key} is a number.`);
	if (
		(setting.min !== undefined && n < setting.min) ||
		(setting.max !== undefined && n > setting.max)
	) {
		throw new AdapterError(400, 'bad_setting', `${key} ${n} is outside the card's range.`);
	}
	return n;
}

export const setAtlasPipeline = defineOp<
	{ atlas: string; pipeline: string; genPx: number; settings: Setting[]; base: DocBase },
	{ atlas: string; pipeline: string; genPx: number; message: string; version: DocBase | null }
>({
	tool: 'atlas',
	name: 'set_atlas_pipeline',
	description:
		"Set an atlas's OWN pipeline, its generation size, and that pipeline's per-atlas settings (the card's settings with scope atlas). Only these keys are ever sent; the project's global settings are never touched. Every region without its own pipeline renders with it.",
	inputSchema: {
		type: 'object',
		properties: {
			atlas: atlasProp,
			pipeline: {
				type: 'string',
				description: 'A reviewed card id.',
				pattern: PIPELINE,
				minLength: 1,
			},
			genPx: { type: 'integer', minimum: 256, maximum: 2048 },
			settings: settingsProp,
			base: baseProp,
		},
		required: ['atlas', 'pipeline', 'genPx', 'settings', 'base'],
		additionalProperties: false,
	},
	agents: ['atlas-technician'],
	scope: 'project',
	write: true,
	writes: writesManifest,
	handler: async (ctx, { atlas, pipeline, genPx, settings, base }) => {
		const { entry, card } = await cardFor(ctx, pipeline);
		await loadManifest(ctx, atlas);
		const body: Record<string, unknown> = {
			atlas_pipeline: pipeline,
			gen_width: String(genPx),
			gen_height: String(genPx),
		};
		const params: Record<string, string | number | boolean> = {};
		for (const { key, value } of settings) {
			if (key === 'gen_width' || key === 'gen_height') {
				throw new AdapterError(400, 'bad_setting', `${key} is genPx.`);
			}
			const setting = cardSetting(card, pipeline, key, 'atlas');
			if (entry.builtin) {
				if (!PER_ATLAS_KEYS.has(key))
					throw new RefusalError('global_config', `${key} is not a per-atlas key.`);
				body[key] = String(typedValue(setting, key, value));
			} else {
				params[key] = typedValue(setting, key, value);
			}
		}
		if (!entry.builtin && Object.keys(params).length) body.bpParams = { [pipeline]: params };
		const answer = await atlasFetch(ctx, {
			method: 'POST',
			path: '/saveconfig',
			atlas,
			body,
			bases: { [manifestDocId(atlas)]: base },
		});
		const message = textOk(answer, /^(✓|Settings saved)/);
		return { atlas, pipeline, genPx, message, version: versionOf(answer, atlas) };
	},
});

/** A region's whole advanced card, as `/regionadv` reads it: `/saveadv` clears what it omits. */
async function advancedFields(ctx: AdapterContext, atlas: string, region: string) {
	const answer = await atlasFetch(ctx, {
		method: 'GET',
		path: `/regionadv/${encodeURIComponent(region)}`,
		atlas,
	});
	const body = answer.json<{ fields?: { key: string; value: unknown }[] }>();
	const fields: Record<string, string> = {};
	for (const f of body.fields ?? []) {
		if (f && typeof f.key === 'string')
			fields[f.key] = f.value === undefined || f.value === null ? '' : String(f.value);
	}
	return fields;
}

async function saveAdvanced(
	ctx: AdapterContext,
	atlas: string,
	region: string,
	fields: Record<string, string>,
	base: DocBase,
) {
	const answer = await atlasFetch(ctx, {
		method: 'POST',
		path: '/saveadv',
		atlas,
		body: { name: region, fields },
		bases: { [manifestDocId(atlas)]: base },
	});
	return { message: textOk(answer, /^Advanced saved/), version: versionOf(answer, atlas) };
}

export const setRegionPipeline = defineOp<
	{
		atlas: string;
		region: string;
		pipeline: string;
		fitMode: string;
		settings: Setting[];
		base: DocBase;
	},
	{ atlas: string; region: string; message: string; version: DocBase | null }
>({
	tool: 'atlas',
	name: 'set_region_pipeline',
	description:
		'A region\'s own pipeline override ("" = the atlas\'s), its fit mode ("" = default, contain, fill, …) and its per-REGION settings (the card\'s settings with scope region). The region\'s other advanced fields are re-sent unchanged.',
	inputSchema: {
		type: 'object',
		properties: {
			atlas: atlasProp,
			region: regionProp,
			pipeline: {
				type: 'string',
				description: 'A reviewed card id, or "" to inherit the atlas pipeline.',
				pattern: PIPELINE,
			},
			fitMode: { type: 'string', pattern: '^[a-z_]{0,20}$' },
			settings: settingsProp,
			base: baseProp,
		},
		required: ['atlas', 'region', 'pipeline', 'fitMode', 'settings', 'base'],
		additionalProperties: false,
	},
	agents: ['atlas-technician'],
	scope: 'project',
	write: true,
	writes: writesManifest,
	handler: async (ctx, { atlas, region, pipeline, fitMode, settings, base }) => {
		const m = await loadManifest(ctx, atlas);
		requireRegion(m, region);
		const effective = pipeline || String(m.doc.settings?.pipeline ?? '');
		if (pipeline) await cardFor(ctx, pipeline);
		const card = effective ? (await cardFor(ctx, effective)).card : null;
		const fields = await advancedFields(ctx, atlas, region);
		fields.pipeline = pipeline;
		fields.fit_mode = fitMode;
		for (const { key, value } of settings) {
			if (!card) throw new AdapterError(400, 'no_pipeline', 'Set the atlas pipeline first.');
			const setting = cardSetting(card, effective, key, 'region');
			if (!REGION_KEYS.has(key))
				throw new RefusalError('global_config', `${key} is not a per-region field.`);
			fields[key] = String(typedValue(setting, key, value));
		}
		return { atlas, region, ...(await saveAdvanced(ctx, atlas, region, fields, base)) };
	},
});

// ── References ────────────────────────────────────────────────────────────────

const refProp = {
	type: 'object',
	properties: {
		source: { type: 'string', enum: ['keep', 'clear', 'key', 'variant', 'mockupCrop'] },
		value: {
			type: 'string',
			description:
				'"" for keep and clear; a sheets/… or sheet_src/… key; a variant as <atlas>/<region>/<id>; for mockupCrop the region whose crop to use ("" = this region).',
			maxLength: 400,
		},
	},
	required: ['source', 'value'],
	additionalProperties: false,
} as const satisfies ObjectSchema;

type RefChoice = { source: 'keep' | 'clear' | 'key' | 'variant' | 'mockupCrop'; value: string };

const VARIANT_REF = new RegExp(
	`^(${atlasProp.pattern.slice(1, -1)})/(${regionProp.pattern.slice(1, -1)})/(${VARIANT_ID.slice(1, -1)})$`,
);
const refName = (part: string) => part.replace(/[^A-Za-z0-9_-]+/g, '-');
/** A short digest of the parts that name a copy: no two (atlas, region, id) share a file. */
const refDigest = (...parts: string[]) =>
	createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 12);

/** The full PNG of a variant, through atlas-tool (`/vfull`). */
async function variantPng(ctx: AdapterContext, atlas: string, region: string, id: string) {
	await loadManifest(ctx, atlas);
	const answer = await atlasFetch(ctx, {
		method: 'GET',
		path: `/vfull/${encodeURIComponent(region)}`,
		atlas,
		query: { id },
	});
	if (!/^image\/png/.test(answer.contentType)) {
		throw new AdapterError(
			404,
			'unknown_variant',
			`No variant ${id} of "${region}" in "${atlas}".`,
		);
	}
	if (answer.bytes.length > MAX_IMAGE_BYTES) {
		throw new AdapterError(413, 'too_large', `Variant ${id} of "${region}" is too large to copy.`);
	}
	return answer.bytes;
}

/** Copy bytes to `key` create-only; a copy already there (a retry) is kept as it is. */
async function putOnce(key: string, bytes: Uint8Array) {
	try {
		await putObjectBytes(key, bytes, 'image/png', { ifNoneMatch: '*' });
	} catch (e) {
		if (!(e instanceof ConflictError)) throw e;
	}
}

/** What a region's `style_ref` / `shape_ref` becomes for a choice; `null` = unchanged. */
async function resolveRef(
	ctx: AdapterContext,
	region: string,
	ref: RefChoice,
	label: string,
): Promise<string | null> {
	const { clientKey, projectKey } = ctx.scope!;
	const root = projectPrefix(clientKey, projectKey);
	switch (ref.source) {
		case 'keep':
			return null;
		case 'clear':
			return '';
		case 'key': {
			const prefixed = /^[a-z0-9_-]+\/[a-z0-9_-]+\/(sheets|sheet_src)\//.test(ref.value);
			if (
				!SHEET_KEY.test(ref.value) ||
				ref.value.includes('..') ||
				(prefixed && !ref.value.startsWith(`${root}/`))
			) {
				throw new AdapterError(
					400,
					'bad_ref',
					`${label}: a key is a Sheet Maker image of this project (sheets/… or sheet_src/…).`,
				);
			}
			return ref.value;
		}
		case 'variant': {
			const m = VARIANT_REF.exec(ref.value);
			if (!m)
				throw new AdapterError(400, 'bad_ref', `${label}: a variant is <atlas>/<region>/<id>.`);
			const [, atlas, from, id] = m;
			const rel = `refs/director_${refName(atlas)}_${refDigest(atlas, from, id)}.png`;
			await putOnce(`${root}/input/${rel}`, await variantPng(ctx, atlas, from, id));
			return rel;
		}
		case 'mockupCrop': {
			const of = ref.value || region;
			if (!REGION_NAME.test(of)) {
				throw new AdapterError(400, 'bad_ref', `${label}: a mockup crop is named by its region.`);
			}
			const got = await getObjectBytes(cropKey(clientKey, projectKey, ctx.run.id, of));
			if (!got) throw new AdapterError(404, 'no_crop', `No mockup crop for "${of}" in this run.`);
			const rel = `refs/director_crop_${refDigest(ctx.run.id, of)}.png`;
			await putOnce(`${root}/input/${rel}`, got.body);
			return rel;
		}
	}
}

export const setRefs = defineOp<
	{ atlas: string; region: string; style: RefChoice; shape: RefChoice; base: DocBase },
	{
		atlas: string;
		region: string;
		styleRef: string | null;
		shapeRef: string | null;
		message: string;
		version: DocBase | null;
	}
>({
	tool: 'atlas',
	name: 'set_refs',
	description:
		"Set a region's style reference (style_ref) and shape reference (shape_ref): keep, clear, a Sheet Maker key, a rendered variant (copied into the project's refs) or the run's mockup crop. Which graph role reads which is the pipeline's binding (its card says).",
	inputSchema: {
		type: 'object',
		properties: {
			atlas: atlasProp,
			region: regionProp,
			style: refProp,
			shape: refProp,
			base: baseProp,
		},
		required: ['atlas', 'region', 'style', 'shape', 'base'],
		additionalProperties: false,
	},
	agents: ['atlas-technician'],
	scope: 'project',
	write: true,
	writes: (input, scope) => [
		...writesManifest(input, scope),
		`${projectPrefix(scope.clientKey, scope.projectKey)}/input/refs/director_`,
	],
	handler: async (ctx, { atlas, region, style, shape, base }) => {
		const m = await loadManifest(ctx, atlas);
		requireRegion(m, region);
		const styleRef = await resolveRef(ctx, region, style, 'style');
		const shapeRef = await resolveRef(ctx, region, shape, 'shape');
		const fields = await advancedFields(ctx, atlas, region);
		if (styleRef !== null) fields.style_ref = styleRef;
		if (shapeRef !== null) fields.shape_ref = shapeRef;
		const saved = await saveAdvanced(ctx, atlas, region, fields, base);
		return {
			atlas,
			region,
			styleRef: fields.style_ref ?? null,
			shapeRef: fields.shape_ref ?? null,
			...saved,
		};
	},
});

// ── Scratch atlases and their layers ─────────────────────────────────────────

const NAME = '^[a-z0-9][a-z0-9_]{0,59}$';
const TAG = '^[a-z0-9][a-z0-9_]{0,19}$';

/** Refuse a layer op on anything but a scratch atlas this run made. */
async function requireScratch(ctx: AdapterContext, atlas: string) {
	if (!(await scratchAtlases(ctx)).has(atlas)) {
		throw new RefusalError('layers', `"${atlas}" is not a scratch atlas this run made.`);
	}
}

export const duplicateAtlas = defineOp<
	{ atlas: string; name: string; tag: string },
	{ atlas: string; from: string; regions: { from: string; to: string }[]; message: string }
>({
	tool: 'atlas',
	name: 'duplicate_atlas',
	description:
		"Make a SCRATCH copy of an atlas for a chain's next pass: same setup and refs, no results, every region renamed <tag>_<region>. Refused on a .atlas-bound atlas or an existing name. A scratch atlas is never packed or deployed; it stays in the project as the run's working files.",
	inputSchema: {
		type: 'object',
		properties: {
			atlas: atlasProp,
			name: { type: 'string', description: 'The scratch atlas id (lower case).', pattern: NAME },
			tag: { type: 'string', description: 'The region prefix, e.g. "cut".', pattern: TAG },
		},
		required: ['atlas', 'name', 'tag'],
		additionalProperties: false,
	},
	agents: ['atlas-technician'],
	scope: 'project',
	write: true,
	writes: (input, scope) => [manifestKey(scope, input.name)],
	handler: async (ctx, { atlas, name, tag }) => {
		const m = await loadManifest(ctx, atlas);
		if (m.doc.atlas?.atlas_file) {
			throw new AdapterError(
				409,
				'atlas_bound',
				`"${atlas}" is bound to a .atlas file and cannot be duplicated.`,
			);
		}
		const answer = await atlasFetch(ctx, {
			method: 'POST',
			path: '/duplicateatlas',
			atlas,
			body: { name, prefix: tag },
		});
		const message = textOk(answer, /^✓/);
		return {
			atlas: name,
			from: atlas,
			regions: m.regions.map((r) => ({ from: r.name, to: `${tag}_${r.name}` })),
			message,
		};
	},
});

export const addLayer = defineOp<
	{ atlas: string; base: string; suffix: string; kind: 'ai' | 'fx'; mode: string },
	{ atlas: string; name: string; kind: 'ai' | 'fx'; message: string }
>({
	tool: 'atlas',
	name: 'add_layer',
	description:
		"Add a layer of a region on a SCRATCH atlas this run made: an AI layer (<base>_<suffix>, generated with its own prompt over the base's source) or an FX layer (<base>_<mode>, rebuilt from the base's pixels when the sheet is made). On a template atlas this is refused: fill the layer regions the template already has.",
	inputSchema: {
		type: 'object',
		properties: {
			atlas: atlasProp,
			base: regionProp,
			suffix: {
				type: 'string',
				description: 'The AI layer suffix; "" for fx.',
				pattern: '^[a-z0-9_]{0,20}$',
			},
			kind: { type: 'string', enum: ['ai', 'fx'] },
			mode: { type: 'string', description: 'The FX mode; "" for ai.', enum: ['', ...FX_MODES] },
		},
		required: ['atlas', 'base', 'suffix', 'kind', 'mode'],
		additionalProperties: false,
	},
	agents: ['atlas-technician'],
	scope: 'project',
	write: true,
	writes: writesManifest,
	handler: async (ctx, { atlas, base, suffix, kind, mode }) => {
		await requireScratch(ctx, atlas);
		const m = await loadManifest(ctx, atlas);
		requireRegion(m, base);
		if (kind === 'ai') {
			if (!suffix || mode)
				throw new AdapterError(400, 'invalid_input', 'An AI layer has a suffix and no mode.');
			const answer = await atlasFetch(ctx, {
				method: 'POST',
				path: '/addlayer',
				atlas,
				body: { base, suffix },
			});
			return { atlas, name: `${base}_${suffix}`, kind, message: textOk(answer, /^✓/) };
		}
		if (!mode || (suffix && suffix !== mode)) {
			throw new AdapterError(
				400,
				'invalid_input',
				'An FX layer names its mode; its suffix is "" or the mode.',
			);
		}
		const name = `${base}_${mode}`;
		// Resumed from the second call on a replay: a region left by a first attempt is reused.
		if (!m.regions.some((r) => r.name === name)) {
			textOk(
				await atlasFetch(ctx, { method: 'POST', path: '/addregion', atlas, body: { name } }),
				/^✓/,
			);
		}
		const set = await atlasFetch(ctx, {
			method: 'POST',
			path: '/setmode',
			atlas,
			body: { name, mode },
		});
		return { atlas, name, kind, message: textOk(set, new RegExp(`^${name}: `)) };
	},
});

export const removeLayer = defineOp<
	{ atlas: string; name: string; base: DocBase },
	{ atlas: string; name: string; message: string }
>({
	tool: 'atlas',
	name: 'remove_layer',
	description:
		"Remove a layer this run's atlas.add_layer made on a scratch atlas. Its rendered variants are kept.",
	inputSchema: {
		type: 'object',
		properties: { atlas: atlasProp, name: regionProp, base: baseProp },
		required: ['atlas', 'name', 'base'],
		additionalProperties: false,
	},
	agents: ['atlas-technician'],
	scope: 'project',
	write: true,
	writes: writesManifest,
	handler: async (ctx, { atlas, name, base }) => {
		await requireScratch(ctx, atlas);
		const made = (await doneOpResults(ctx.run.id, 'atlas.add_layer')).some((r) => {
			const result = r as { atlas?: unknown; name?: unknown } | null;
			return result?.atlas === atlas && result.name === name;
		});
		if (!made) throw new RefusalError('art_deletion', `"${name}" is not a layer this run added.`);
		const answer = await atlasFetch(ctx, {
			method: 'POST',
			path: '/delregion',
			atlas,
			body: { name },
			bases: { [manifestDocId(atlas)]: base },
		});
		return { atlas, name, message: textOk(answer, /^✓/) };
	},
});

// ── Committing and shipping ───────────────────────────────────────────────────

/** A Director run's committed tile (`ui_server.versioned_output_rel`) of `run` for `region`. */
export function isRunTile(rel: string, region: string, run: string): boolean {
	const part = (s: string) => s.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
	const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const runId = part(run) || 'run';
	return new RegExp(
		`^refs/useroutput/${esc(part(region) || region)}_${esc(runId)}_[0-9a-f]{12}\\.png$`,
	).test(rel);
}

export const setOutput = defineOp<
	{
		atlas: string;
		region: string;
		from: { atlas: string; region: string; id: string };
		base: DocBase;
	},
	{ atlas: string; region: string; from: string; message: string; version: DocBase | null }
>({
	tool: 'atlas',
	name: 'set_output',
	description:
		"Commit a rendered variant (from any atlas of the project, usually the last step of a chain on a scratch atlas) as a TEMPLATE region's tile, verbatim. Refused when the region carries a committed tile this run did not write.",
	inputSchema: {
		type: 'object',
		properties: {
			atlas: atlasProp,
			region: regionProp,
			from: {
				type: 'object',
				properties: {
					atlas: atlasProp,
					region: regionProp,
					id: { type: 'string', pattern: VARIANT_ID },
				},
				required: ['atlas', 'region', 'id'],
				additionalProperties: false,
			},
			base: baseProp,
		},
		required: ['atlas', 'region', 'from', 'base'],
		additionalProperties: false,
	},
	agents: ['atlas-technician'],
	scope: 'project',
	write: true,
	writes: (input, scope) => [
		...writesManifest(input, scope),
		`${projectPrefix(scope.clientKey, scope.projectKey)}/input/refs/useroutput/`,
	],
	handler: async (ctx, { atlas, region, from, base }) => {
		if ((await scratchAtlases(ctx, 'project')).has(atlas)) {
			throw new AdapterError(
				409,
				'scratch_atlas',
				`"${atlas}" is a scratch atlas: a tile lands on a template region.`,
			);
		}
		const m: LoadedManifest = await loadManifest(ctx, atlas);
		const r = requireRegion(m, region);
		if (r.output_override && !isRunTile(r.output_override, region, ctx.run.id)) {
			throw new RefusalError(
				'art_deletion',
				`"${region}" already carries a tile this run did not commit (${r.output_override}).`,
			);
		}
		const png = await variantPng(ctx, from.atlas, from.region, from.id);
		const answer = await atlasFetch(ctx, {
			method: 'POST',
			path: '/setoutput',
			atlas,
			body: { name: region, data: Buffer.from(png).toString('base64') },
			bases: { [manifestDocId(atlas)]: base },
		});
		return {
			atlas,
			region,
			from: `${from.atlas}/${from.region}/${from.id}`,
			message: textOk(answer, /^✓/),
			version: versionOf(answer, atlas),
		};
	},
});

export const deployAtlas = defineOp<{ atlas: string }, { atlas: string; message: string }>({
	tool: 'atlas',
	name: 'deploy_atlas',
	description:
		"Deploy a template atlas's packed page into the project's deploy/ folder (where the build reads it). Never a scratch atlas; never publishes.",
	inputSchema: {
		type: 'object',
		properties: { atlas: atlasProp },
		required: ['atlas'],
		additionalProperties: false,
	},
	agents: ['atlas-technician'],
	scope: 'project',
	write: true,
	writes: (input, scope) => [
		...writesManifest(input, scope),
		`${projectPrefix(scope.clientKey, scope.projectKey)}/deploy/`,
	],
	handler: async (ctx, { atlas }) => {
		if ((await scratchAtlases(ctx, 'project')).has(atlas)) {
			throw new AdapterError(
				409,
				'scratch_atlas',
				`"${atlas}" is a scratch atlas: it is never deployed.`,
			);
		}
		const m = await loadManifest(ctx, atlas);
		const raw = String(m.doc.deploy_path ?? '')
			.replace(/\\/g, '/')
			.replace(/^\/+|\/+$/g, '');
		const root = projectPrefix(ctx.scope!.clientKey, ctx.scope!.projectKey);
		// atlas-tool re-checks the key it resolves (an asset-map target too) for a Director token.
		if (
			raw.includes('..') ||
			raw === root ||
			(raw.startsWith(`${root}/`) && !raw.startsWith(`${root}/deploy/`))
		) {
			throw new AdapterError(
				409,
				'deploy_path',
				`"${atlas}" deploys to ${raw}, outside deploy/: a person sets that target.`,
			);
		}
		const answer = await atlasFetch(ctx, { method: 'POST', path: '/deployatlas', atlas, body: {} });
		return { atlas, message: textOk(answer) };
	},
});

export const ATLAS_SETUP_OPS = [
	listBlueprints,
	setAtlasPipeline,
	setRegionPipeline,
	setRefs,
	addLayer,
	removeLayer,
	duplicateAtlas,
	setOutput,
	deployAtlas,
];
