/**
 * The Invisible Model Viewer's validator report: a master's facts checked against its class, as
 * sections of rows. Built on the page from the facts `model.json` keeps, so it follows the class and
 * the overrides being edited without reading the master again.
 *
 * The rules are the ones a GLB alone can answer, with the Blender validator's issue codes where one
 * exists (`tools/blender/ie_conventions.py` `ISSUES`, `docs/conventions/blender-3d-assets.md`). The
 * upload gate is `modelStorage.ts` `validateModelMaster`; an issue it stored that no row here
 * recomputes is listed as it was stored, so a rule added to the validator shows without a change
 * here.
 */
import {
	MODEL_CLASS_DEFAULTS,
	MODEL_LOD_ULTRA,
	MODEL_TIERED_MAPS,
	MODEL_TIERS,
	type ModelClass,
	type ModelTierId,
	type ModelTierProfile,
} from 'constants-shared/modelTiers';
import type { ModelMasterFacts } from './modelFacts';
import { MODEL_TIER_LABEL, TIERED_MAP_LABEL, lodLabel } from './modelProfile';

export type CheckState = 'ok' | 'info' | 'warning' | 'error';

export interface ReportIssue {
	level: 'error' | 'warning';
	code: string;
	message: string;
}

export interface ReportRow {
	label: string;
	value: string;
	note?: string;
	state: CheckState;
	/** The validator code this row answers, when it has one. */
	code?: string;
}

export type ReportSectionId = 'budgets' | 'lods' | 'textures' | 'names' | 'tiers' | 'other';

export interface ReportSection {
	id: ReportSectionId;
	title: string;
	state: CheckState;
	rows: ReportRow[];
}

export interface ModelReportInput {
	cls: ModelClass;
	/** `null` for a model registered before facts were kept: only the stored issues show. */
	facts: ModelMasterFacts | null;
	/** The issues the upload stored. */
	issues: readonly ReportIssue[];
	/** The effective profile (`modelProfile.ts` `effectiveProfile`). */
	profile: Readonly<Record<ModelTierId, ModelTierProfile>>;
	publishedTiers: readonly ModelTierId[];
}

/** The mesh-name prefix of each class (`blender-3d-assets.md` "Names"). */
export const CLASS_NAME_PREFIX: Partial<Record<ModelClass, string>> = {
	hero: 'CH',
	weapon: 'WP',
	prop: 'PR',
	tile: 'TL',
	fx: 'FX',
	// A first-person viewmodel is a hero asset `CH_<hero>_vm` (`blender-3d-assets.md`).
	viewmodel: 'CH',
};

const ASSET_NAME = /^(CH|WP|PR|TL|FX)_[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*$/;
const SOCKET_NAME = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const CLIP_NAME = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const DUPLICATE_SUFFIX = /\.\d{3}$/;
/** A palette or ramp is small on purpose: the size rules do not apply to it. */
const TEXTURE_EXEMPT = /(palette|ramp)/i;
/** The hard cap on a master texture's side (`modelOptimize.ts` `MODEL_LIMITS.textureSide`). */
const TEXTURE_SIDE_LIMIT = 8192;

/** The stored issue codes the rows below recompute from the facts, so they are not listed twice. */
const RECOMPUTED = new Set([
	'TRIS_OVER_BUDGET',
	'LODU_UNUSED',
	'NO_LOD0',
	'TEXTURE_NOT_POW2',
	'TEXTURE_OVER_CLASS',
	'TEXTURE_TOO_LARGE',
]);

const RANK: Record<CheckState, number> = { ok: 0, info: 1, warning: 2, error: 3 };
const worst = (rows: readonly ReportRow[]): CheckState =>
	rows.reduce<CheckState>((s, r) => (RANK[r.state] > RANK[s] ? r.state : s), 'ok');

const fmt = (n: number) => n.toLocaleString('en-US');
const isPow2 = (n: number) => n > 0 && Number.isInteger(Math.log2(n));

/** The section a stored issue belongs to, by its code. */
function sectionOfCode(code: string): ReportSectionId {
	if (/^(TRIS_|MODEL_OVER)/.test(code)) return 'budgets';
	if (/^(LOD|NO_LOD)/.test(code)) return 'lods';
	if (/^TEXTURE_/.test(code)) return 'textures';
	if (/^(NAME_|SOCKET_|SK_|RIG_|ACTION_|CLIP|NO_CLIPS)/.test(code)) return 'names';
	return 'other';
}

function budgetRows(cls: ModelClass, facts: ModelMasterFacts): ReportRow[] {
	const gen = MODEL_CLASS_DEFAULTS[cls].lodGenerate as {
		tris: readonly number[];
		ultraTris?: number;
	};
	return facts.levels.map((l): ReportRow => {
		const label = `${l.base} ${lodLabel(l.level)}`;
		const value = `${fmt(l.tris)} tris`;
		const budget = l.level === MODEL_LOD_ULTRA ? gen.ultraTris : gen.tris[l.level];
		if (budget === undefined)
			return l.level === MODEL_LOD_ULTRA
				? {
						label,
						value,
						note: `The ${cls} class has no ultra level, so it never ships.`,
						state: 'warning',
						code: 'LODU_UNUSED',
					}
				: {
						label,
						value,
						note: `The ${cls} class has no ${lodLabel(l.level)}: no tier ships it.`,
						state: 'info',
					};
		const over = l.tris > budget * 1.1;
		return {
			label,
			value,
			note: `Budget ${fmt(budget)}`,
			state: over ? 'warning' : 'ok',
			...(over ? { code: 'TRIS_OVER_BUDGET' } : {}),
		};
	});
}

function lodRows(cls: ModelClass, facts: ModelMasterFacts): ReportRow[] {
	const gen = MODEL_CLASS_DEFAULTS[cls].lodGenerate as {
		tris: readonly number[];
		ultraTris?: number;
	};
	const rows: ReportRow[] = [];
	if (!facts.levels.some((l) => l.level === 0))
		rows.push({
			label: 'LOD0',
			value: 'Missing',
			note: 'The master has no mesh (no LOD0).',
			state: 'error',
			code: 'NO_LOD0',
		});
	const bases = [...new Set(facts.levels.map((l) => l.base))];
	for (const base of bases) {
		const own = new Map(facts.levels.filter((l) => l.base === base).map((l) => [l.level, l.tris]));
		if (gen.ultraTris !== undefined)
			rows.push(
				own.has(MODEL_LOD_ULTRA)
					? {
							label: `${base} LODU`,
							value: `Authored · ${fmt(own.get(MODEL_LOD_ULTRA) ?? 0)} tris`,
							note: 'Ships in the ultra tier only.',
							state: 'ok',
						}
					: {
							label: `${base} LODU`,
							value: 'None',
							note: 'Ultra ships LOD0 as its top level (an ultra level is never generated).',
							state: 'info',
						},
			);
		for (const [level, target] of gen.tris.entries()) {
			const tris = own.get(level);
			if (tris !== undefined) {
				rows.push({
					label: `${base} LOD${level}`,
					value: `Authored · ${fmt(tris)} tris`,
					state: 'ok',
				});
			} else if (level === 0) {
				rows.push({
					label: `${base} LOD0`,
					value: 'Missing',
					note: 'This mesh has lower levels but no LOD0 to generate them from.',
					state: 'warning',
					code: 'LOD_MISSING_BASE',
				});
			} else {
				rows.push({
					label: `${base} LOD${level}`,
					value: 'Generated at export',
					note: `Simplified from the nearest richer level, towards ${fmt(target)} tris.`,
					state: 'info',
				});
			}
		}
	}
	return rows;
}

function textureRows(cls: ModelClass, facts: ModelMasterFacts): ReportRow[] {
	const defaults = MODEL_CLASS_DEFAULTS[cls];
	// The size the full tier ships a map of this class at: its cap, or the class's largest master
	// where that is smaller (a tile master is 1024², under full's 2048² cap).
	const fullCap = Math.min(
		defaults.masterMaxTexture,
		Math.max(
			...Object.values(defaults.tiers.full.maps).filter((v): v is number => typeof v === 'number'),
			0,
		),
	);
	if (!facts.textures.length)
		return [
			{
				label: 'Textures',
				value: 'None',
				note: 'The materials use colours only.',
				state: 'info',
			},
		];
	return facts.textures.map((t): ReportRow => {
		const label = t.name || '(unnamed)';
		const value = `${t.w}×${t.h}`;
		const side = Math.max(t.w, t.h);
		if (side > TEXTURE_SIDE_LIMIT)
			return {
				label,
				value,
				note: `Over the ${fmt(TEXTURE_SIDE_LIMIT)}² limit.`,
				state: 'error',
				code: 'TEXTURE_TOO_LARGE',
			};
		if (!isPow2(t.w) || !isPow2(t.h))
			return {
				label,
				value,
				note: 'Sizes must be powers of two.',
				state: 'error',
				code: 'TEXTURE_NOT_POW2',
			};
		if (t.w % 4 || t.h % 4)
			return {
				label,
				value,
				note: 'Each side should divide by 4: a block-compressed texture is made of 4×4 blocks.',
				state: 'warning',
				code: 'TEXTURE_NOT_DIV4',
			};
		if (side > defaults.masterMaxTexture)
			return {
				label,
				value,
				note: `Above the ${cls} master's ${defaults.masterMaxTexture}²: every tier resizes it down.`,
				state: 'warning',
				code: 'TEXTURE_OVER_CLASS',
			};
		if (side < fullCap && !TEXTURE_EXEMPT.test(t.name))
			return {
				label,
				value,
				note: `Below the full tier's ${fullCap}²: full ships it at its own size (nothing is scaled up).`,
				state: 'info',
				code: 'TEXTURE_BELOW_FULL',
			};
		return { label, value, note: 'Power of two, divides by 4.', state: 'ok' };
	});
}

function nameRows(cls: ModelClass, facts: ModelMasterFacts): ReportRow[] {
	const rows: ReportRow[] = [];
	const prefix = CLASS_NAME_PREFIX[cls];
	for (const base of [...new Set(facts.levels.map((l) => l.base))]) {
		const label = base || '(unnamed)';
		if (DUPLICATE_SUFFIX.test(base))
			rows.push({
				label,
				value: 'Mesh',
				note: 'Ends in a Blender copy suffix (.001): rename the object.',
				state: 'warning',
				code: 'NAME_DUPLICATE_SUFFIX',
			});
		else if (!ASSET_NAME.test(base))
			rows.push({
				label,
				value: 'Mesh',
				note: `Not an asset name: expected ${prefix ?? 'CH|WP|PR|TL|FX'}_<name>.`,
				state: 'warning',
				code: 'NAME_UNKNOWN',
			});
		else if (prefix && !base.startsWith(`${prefix}_`))
			rows.push({
				label,
				value: 'Mesh',
				note: `Named as another class: a ${cls} is ${prefix}_<name>.`,
				state: 'warning',
				code: 'NAME_UNKNOWN',
			});
		else rows.push({ label, value: 'Mesh', state: 'ok' });
	}
	for (const socket of facts.sockets)
		rows.push(
			SOCKET_NAME.test(socket)
				? { label: `SK_${socket}`, value: 'Socket', state: 'ok' }
				: {
						label: `SK_${socket}`,
						value: 'Socket',
						note: 'Socket names are lower snake case: SK_hand_r.',
						state: 'warning',
						code: 'SOCKET_NAME',
					},
		);
	if (!facts.sockets.length) rows.push({ label: 'Sockets', value: 'None', state: 'info' });
	const badClips = facts.clips.filter((c) => !CLIP_NAME.test(c));
	if (facts.clips.length)
		rows.push({
			label: 'Clips',
			value: fmt(facts.clips.length),
			note: badClips.length
				? `Not <set>.<clip>: ${badClips.slice(0, 6).join(', ')}${badClips.length > 6 ? '…' : ''}`
				: facts.clips.slice(0, 6).join(', ') + (facts.clips.length > 6 ? '…' : ''),
			state: badClips.length ? 'warning' : 'ok',
			...(badClips.length ? { code: 'ACTION_NAME' } : {}),
		});
	return rows;
}

function tierRows(input: ModelReportInput, facts: ModelMasterFacts): ReportRow[] {
	const gen = MODEL_CLASS_DEFAULTS[input.cls].lodGenerate as { tris: readonly number[] };
	const lastLevel = gen.tris.length - 1;
	const hasUltra = facts.levels.some((l) => l.level === MODEL_LOD_ULTRA);
	return MODEL_TIERS.map((tier): ReportRow => {
		const [from, to] = input.profile[tier].lods;
		const published = input.publishedTiers.includes(tier);
		const label = `${MODEL_TIER_LABEL[tier]}${published ? '' : ' (not published)'}`;
		const first = from === MODEL_LOD_ULTRA && !hasUltra ? 0 : from;
		const value =
			first === to ? lodLabel(first) : `${lodLabel(first)}–${lodLabel(to).replace('LOD', '')}`;
		if (first > to || to > lastLevel || to < 0)
			return {
				label,
				value: `${lodLabel(from)}–${lodLabel(to).replace('LOD', '')}`,
				note:
					first > to
						? 'The window starts after it ends: no level ships.'
						: `The ${input.cls} class ends at LOD${lastLevel}.`,
				state: 'warning',
			};
		const dropped = MODEL_TIERED_MAPS.filter((map) => input.profile[tier].maps[map] === 'drop').map(
			(map) => TIERED_MAP_LABEL[map],
		);
		const notes = [
			from === MODEL_LOD_ULTRA && !hasUltra ? 'No LODU in the master: starts at LOD0.' : '',
			dropped.length ? `Drops: ${dropped.join(', ')}.` : '',
		].filter(Boolean);
		return {
			label,
			value,
			...(notes.length ? { note: notes.join(' ') } : {}),
			state: published ? 'ok' : 'info',
		};
	});
}

const TITLES: Record<ReportSectionId, string> = {
	budgets: 'Budgets',
	lods: 'LOD chain',
	textures: 'Textures',
	names: 'Names and sockets',
	tiers: 'Tier windows',
	other: 'Upload report',
};

/** The report's sections, in display order. A section with no row is left out. */
export function buildModelReport(input: ModelReportInput): ReportSection[] {
	const { cls, facts } = input;
	const rows: Record<ReportSectionId, ReportRow[]> = {
		budgets: [],
		lods: [],
		textures: [],
		names: [],
		tiers: [],
		other: [],
	};
	if (facts) {
		rows.budgets = budgetRows(cls, facts);
		rows.lods = lodRows(cls, facts);
		rows.textures = textureRows(cls, facts);
		rows.tiers = tierRows(input, facts);
		rows.names = nameRows(cls, facts);
	}
	for (const issue of input.issues) {
		if (facts && RECOMPUTED.has(issue.code)) continue;
		rows[facts ? sectionOfCode(issue.code) : 'other'].push({
			label: issue.code,
			value: issue.message,
			state: issue.level,
			code: issue.code,
		});
	}
	return (Object.keys(rows) as ReportSectionId[])
		.filter((id) => rows[id].length)
		.map((id) => ({ id, title: TITLES[id], state: worst(rows[id]), rows: rows[id] }));
}

/** How many rows of a report are errors and warnings. */
export function reportCounts(sections: readonly ReportSection[]): {
	errors: number;
	warnings: number;
} {
	let errors = 0;
	let warnings = 0;
	for (const s of sections)
		for (const r of s.rows) {
			if (r.state === 'error') errors += 1;
			else if (r.state === 'warning') warnings += 1;
		}
	return { errors, warnings };
}
