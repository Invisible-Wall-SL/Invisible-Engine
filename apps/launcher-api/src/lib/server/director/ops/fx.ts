import {
	parseEffectParamPath,
	type EffectDoc,
	type EffectParam,
	type EmitterLayer,
} from 'engine-fx';
import type { LayoutNode, Scene } from 'engine-layout';
import { loadDocWithEtag } from '../../editorStorage';
import { listFxAtlases, type FxAtlas } from '../../fxAtlases';
import { listEffects, loadEffect, saveEffect, type FxEffectRow } from '../../fxStorage';
import { fxDocKey, fxMetaKey, r2Slug } from '../../projectPaths';
import { projectGameType } from '../../projects';
import { AdapterError, defineOp } from '../adapter';
import { baseEtagProp, baseOf, preconditionOf, projectOf, validated } from './docs';
import { componentClosure, defLoader, lockOf, sceneHolders } from './mathLock';

/**
 * Invisible FX adapters (ADR-0011 §2), through `fxStorage.ts`: the tool's own `listEffects`,
 * `loadEffect` and `saveEffect` (one `If-Match` on the effect doc; the editor-only sidecar is passed
 * back as loaded). The animator re-points the art of layers that already exist and recolours the
 * colour stops they already have. Everything else in the effect is read and never written. The doc
 * carries no `saved_by`, so a write answers with `before` and `director_ops` keeps it.
 */

const EFFECT_ID = '^[A-Za-z0-9_.-]{1,120}$';
const MAX_FRAMES = 64;
const HEX = /^#[0-9a-fA-F]{6}$/;
/** A stored colour stop the particle library reads: `#rrggbb`, bare or `0x`-prefixed (8 digits carry alpha). */
const STORED_HEX = /^(?:#|0x)?[0-9a-fA-F]{6}$/;

type Behavior = { type?: unknown; config?: Record<string, unknown> };

const behaviorsOf = (layer: EmitterLayer): Behavior[] => {
	const list = (layer.config as unknown as { behaviors?: unknown }).behaviors;
	return Array.isArray(list) ? (list as Behavior[]) : [];
};

interface ColorStops {
	type: 'color' | 'colorStatic';
	/** The stored values, in stop order (one for `colorStatic`). */
	values: string[];
	/** The stop times of a `color` behaviour. */
	times?: number[];
}

/** A colour behaviour's stops, or `null` when the behaviour is not one or is not shaped as the library writes it. */
function colorStops(behavior: Behavior | undefined): ColorStops | null {
	const config = behavior?.config;
	if (!config) return null;
	if (behavior.type === 'colorStatic') {
		return typeof config.color === 'string' && STORED_HEX.test(config.color)
			? { type: 'colorStatic', values: [config.color] }
			: null;
	}
	if (behavior.type !== 'color') return null;
	const list = (config.color as { list?: unknown } | undefined)?.list;
	if (!Array.isArray(list) || list.length === 0) return null;
	const stops = list as { time?: unknown; value?: unknown }[];
	if (!stops.every((s) => typeof s?.value === 'string' && STORED_HEX.test(s.value))) return null;
	return {
		type: 'color',
		values: stops.map((s) => s.value as string),
		times: stops.map((s) => (typeof s.time === 'number' ? s.time : 0)),
	};
}

/** `hex` (`#rrggbb`) written the way `stored` is: its prefix (`#`, `0x` or none) and letter case. */
function writtenLike(stored: string, hex: string): string {
	const prefix = /^(#|0x)/.exec(stored)?.[0] ?? '';
	const digits = stored.slice(prefix.length);
	const upper = /[A-F]/.test(digits) && !/[a-f]/.test(digits);
	return prefix + (upper ? hex.slice(1).toUpperCase() : hex.slice(1).toLowerCase());
}

const hexDigits = (value: string) => value.replace(/^(#|0x)/, '').toLowerCase();

/** Behaviours `layerKey`'s parameters drive, as `<type>#<n>` (the n-th behaviour of that type). */
function drivenBehaviors(
	params: readonly EffectParam[] | undefined,
	layerKey: string,
): Set<string> {
	const out = new Set<string>();
	for (const param of params ?? []) {
		for (const drive of param.drives) {
			if (drive.layer !== layerKey) continue;
			const parsed = parseEffectParamPath(drive.path);
			if (parsed.ok && parsed.target.scope === 'behavior') {
				out.add(`${parsed.target.type}#${parsed.target.index}`);
			}
		}
	}
	return out;
}

/** The `<type>#<n>` key of `behaviors[index]`. */
function behaviorKey(list: readonly Behavior[], index: number): string {
	const type = String(list[index]?.type);
	return `${type}#${list.slice(0, index).filter((b) => b?.type === list[index]?.type).length}`;
}

function* effectNodes(
	nodes: LayoutNode[],
	effectId: string,
	ancestors: LayoutNode[] = [],
): Generator<{ node: LayoutNode; ancestors: LayoutNode[] }> {
	for (const node of nodes) {
		if (node.kind === 'effect' && node.effectId === effectId) yield { node, ancestors };
		if (node.kind === 'container')
			yield* effectNodes(node.children, effectId, [...ancestors, node]);
	}
}

/**
 * Why a Scene Editor node that places the effect is locked (bound to the game's math, or locked in
 * the editor), or `null` when none is. The effect is placed by an `effect` node in a scene, or by
 * one inside a component def a scene node places, directly or through nested defs; in that case
 * the lock is that scene node's. A layout that cannot be read cannot be checked, so it locks.
 */
async function placementLock(
	clientKey: string,
	projectKey: string,
	effectId: string,
): Promise<string | null> {
	const { doc, etag, corrupt } = await loadDocWithEtag(
		clientKey,
		projectKey,
		await projectGameType(projectKey),
	);
	if (corrupt) {
		return "the project's layout is unreadable, so where this effect is placed cannot be checked";
	}
	if (etag === null) return null;
	const defs = defLoader(projectKey);
	for (const scene of doc.scenes as Scene[]) {
		for (const { node, ancestors } of effectNodes(scene.nodes, effectId)) {
			const why = await lockOf(scene, ancestors, node, defs);
			if (why) return `it is placed by "${node.id}" on "${scene.id}", which is ${why}`;
		}
	}
	for (const holder of sceneHolders(doc.scenes as Scene[])) {
		const closure = await componentClosure(holder.node, defs);
		const inside = closure.defs.find((def) => !effectNodes([def.root], effectId).next().done);
		if (!inside && !closure.deep) continue;
		const why = await lockOf(holder.scene, holder.ancestors, holder.node, defs);
		if (why) {
			return inside
				? `it is placed inside the component "${inside.id}", held by "${holder.node.id}" on "${holder.scene.id}", which is ${why}`
				: `it may be placed in a component "${holder.node.id}" on "${holder.scene.id}" holds too deep to check, and that node is ${why}`;
		}
	}
	return null;
}

async function loadExisting(clientKey: string, projectKey: string, id: string) {
	const loaded = await loadEffect(clientKey, projectKey, id);
	if (loaded.docEtag === null) {
		throw new AdapterError(404, 'unknown_effect', `No effect "${id}" in this project.`);
	}
	if (loaded.doc.layers.length === 0) {
		throw new AdapterError(
			409,
			'unreadable_doc',
			`The effect "${id}" is unreadable or has no layers. A person must repair it in Invisible FX.`,
		);
	}
	return loaded as typeof loaded & { docEtag: string };
}

interface LayerSummary {
	key: string;
	particleKind: EmitterLayer['particleKind'];
	art: {
		assetKey: string;
		frames: string[];
		weights: number[] | null;
		animated: boolean;
	};
	/** The colour behaviours, by their index in `config.behaviors`. */
	colors: { behavior: number; type: string; values: string[]; times?: number[]; driven: boolean }[];
	/** The leaves an exposed parameter drives on this layer. */
	driven: string[];
}

function summarize(doc: EffectDoc, layer: EmitterLayer): LayerSummary {
	const list = behaviorsOf(layer);
	const drivenBy = drivenBehaviors(doc.params, layer.key);
	const colors: LayerSummary['colors'] = [];
	list.forEach((behavior, index) => {
		const stops = colorStops(behavior);
		if (stops) {
			colors.push({
				behavior: index,
				type: stops.type,
				values: stops.values,
				...(stops.times ? { times: stops.times } : {}),
				driven: drivenBy.has(behaviorKey(list, index)),
			});
		}
	});
	return {
		key: layer.key,
		particleKind: layer.particleKind,
		art: {
			assetKey: layer.art.assetKey,
			frames: layer.art.frames,
			weights: layer.art.weights ?? null,
			animated: layer.art.animated === true,
		},
		colors,
		driven: (doc.params ?? []).flatMap((p) =>
			p.drives.filter((d) => d.layer === layer.key).map((d) => d.path),
		),
	};
}

export const getEffect = defineOp<
	{ id?: string },
	| { effects: FxEffectRow[]; atlases: FxAtlas[] }
	| {
			id: string;
			name: string;
			layers: LayerSummary[];
			locked: string | null;
			baseEtag: string;
	  }
>({
	tool: 'fx',
	name: 'get_effect',
	description:
		"The project's FX. With no `id`: the effects, and the atlases a layer may draw from (manifest key, label, regions). With an `id`: each layer's key, particle kind, art (assetKey, frames, weights, animated), its colour behaviours (by index in `config.behaviors`, with their stop values and whether a parameter drives them), the leaves parameters drive, `locked` (why fx.update_art refuses the effect, or null) and the baseEtag to hand back to fx.update_art.",
	inputSchema: {
		type: 'object',
		properties: { id: { type: 'string', pattern: EFFECT_ID } },
		additionalProperties: false,
	},
	agents: ['animator'],
	scope: 'project',
	write: false,
	handler: async (ctx, { id }) => {
		const { clientKey, projectKey } = projectOf(ctx);
		if (!id) {
			return {
				effects: await listEffects(clientKey, projectKey),
				atlases: await listFxAtlases(clientKey, projectKey),
			};
		}
		const { doc, docEtag } = await loadExisting(clientKey, projectKey, id);
		return {
			id: doc.id,
			name: doc.name,
			layers: doc.layers.map((layer) => summarize(doc, layer)),
			locked: await placementLock(clientKey, projectKey, doc.id),
			baseEtag: baseOf(docEtag),
		};
	},
});

export interface LayerArtChange {
	layer: string;
	assetKey: string;
	frames: string[];
	weights?: number[];
	colors?: { behavior: number; values: string[] }[];
}

interface Refused {
	layer: string;
	reason: string;
}

type LayerBefore = {
	layer: string;
	assetKey: string;
	frames: string[];
	weights: number[] | null;
	colors: { behavior: number; values: string[] }[];
};

/** Apply one change to `layer` in place, or say why it cannot be applied (the layer is then untouched). */
function applyLayerChange(
	doc: EffectDoc,
	layer: EmitterLayer,
	change: LayerArtChange,
	atlases: FxAtlas[],
): { reason: string } | { before: LayerBefore; changed: boolean } {
	if (layer.particleKind === 'spine') {
		return { reason: 'it is a rig-particle layer; rig particles belong to the Rigger' };
	}
	const atlas = atlases.find((a) => a.manifestKey === change.assetKey);
	if (!atlas) {
		return {
			reason: `"${change.assetKey}" is not one of the project's atlases (see fx.get_effect)`,
		};
	}
	if (change.frames.length < 1 || change.frames.length > MAX_FRAMES) {
		return { reason: `it takes 1 to ${MAX_FRAMES} frames, not ${change.frames.length}` };
	}
	const regions = new Set(atlas.regions);
	const missing = change.frames.filter((f) => !regions.has(f));
	if (missing.length) {
		return {
			reason: `not regions of ${atlas.label}: ${[...new Set(missing)].slice(0, 5).join(', ')}`,
		};
	}

	const art = layer.art;
	const hadWeights = Array.isArray(art.weights);
	let weights: number[] | undefined = art.weights;
	if (change.weights) {
		if (art.animated) return { reason: 'weights mix a static particle; this layer is animated' };
		if (change.frames.length < 2) return { reason: 'a weighted mix needs at least 2 frames' };
		if (change.weights.length !== change.frames.length) {
			return {
				reason: `it needs one weight per frame (${change.frames.length}), not ${change.weights.length}`,
			};
		}
		if (!change.weights.every((w) => w > 0)) return { reason: 'every weight must be above 0' };
		weights = change.weights;
	} else if (hadWeights && change.frames.length !== art.frames.length) {
		if (change.frames.length > 1) {
			return {
				reason: `the frame count changed from ${art.frames.length} to ${change.frames.length} on a layer with weights; send one new weight per frame`,
			};
		}
		weights = undefined;
	}

	const list = behaviorsOf(layer);
	const drivenBy = drivenBehaviors(doc.params, layer.key);
	const recolor: { behavior: Behavior; index: number; stops: ColorStops; values: string[] }[] = [];
	const seen = new Set<number>();
	for (const colors of change.colors ?? []) {
		const behavior = list[colors.behavior];
		const stops = colorStops(behavior);
		if (!stops) {
			return {
				reason: `behaviors[${colors.behavior}] is not a colour behaviour with readable stops`,
			};
		}
		if (seen.has(colors.behavior)) {
			return { reason: `behaviors[${colors.behavior}] is listed twice` };
		}
		seen.add(colors.behavior);
		if (drivenBy.has(behaviorKey(list, colors.behavior))) {
			return {
				reason: `behaviors[${colors.behavior}] is driven by an effect parameter, which owns its value`,
			};
		}
		if (colors.values.length !== stops.values.length) {
			return {
				reason: `behaviors[${colors.behavior}] has ${stops.values.length} colour stop${stops.values.length === 1 ? '' : 's'}; send exactly that many values, not ${colors.values.length}`,
			};
		}
		if (!colors.values.every((v) => HEX.test(v))) {
			return { reason: `behaviors[${colors.behavior}] takes #rrggbb values` };
		}
		recolor.push({ behavior: behavior!, index: colors.behavior, stops, values: colors.values });
	}

	const before: LayerBefore = {
		layer: layer.key,
		assetKey: art.assetKey,
		frames: [...art.frames],
		weights: art.weights ? [...art.weights] : null,
		colors: recolor.map((r) => ({ behavior: r.index, values: [...r.stops.values] })),
	};
	let changed =
		art.assetKey !== change.assetKey ||
		art.frames.length !== change.frames.length ||
		art.frames.some((f, i) => f !== change.frames[i]) ||
		JSON.stringify(art.weights ?? null) !== JSON.stringify(weights ?? null);
	art.assetKey = change.assetKey;
	art.frames = [...change.frames];
	if (weights) art.weights = [...weights];
	else delete art.weights;
	for (const { behavior, stops, values } of recolor) {
		const written = values.map((v, i) => writtenLike(stops.values[i], v));
		if (written.some((v, i) => hexDigits(v) !== hexDigits(stops.values[i]))) changed = true;
		else continue;
		if (stops.type === 'colorStatic') behavior.config!.color = written[0];
		else {
			const list = (behavior.config!.color as { list: { value: string }[] }).list;
			list.forEach((stop, i) => (stop.value = written[i]));
		}
	}
	return { before, changed };
}

export const updateArt = defineOp<
	{ id: string; layers: LayerArtChange[]; baseEtag: string },
	{
		applied: { layer: string }[];
		unchanged: string[];
		refused: Refused[];
		before: LayerBefore[];
		baseEtag: string;
	}
>({
	tool: 'fx',
	name: 'update_art',
	description:
		'Re-point the art of particle layers that already exist, and recolour the colour stops they already have. Per layer send `assetKey` and `frames` (always both, even when only recolouring), optionally `weights` (one per frame, each above 0; required when the frame count changes on a layer that has weights) and `colors` ({behavior: index in config.behaviors, values: exactly one #rrggbb per existing stop}). Nothing else in the effect changes: no emitter field, other behaviour, placement, trigger, material, parameter, layer or order. Rig-particle layers, a colour an effect parameter drives, unknown atlases or regions, and wrong stop counts are refused and listed in `refused`; the rest are saved together. An effect placed by a node bound to the math is refused outright.',
	inputSchema: {
		type: 'object',
		properties: {
			id: { type: 'string', pattern: EFFECT_ID },
			layers: {
				type: 'array',
				maxItems: 16,
				items: {
					type: 'object',
					properties: {
						layer: { type: 'string', minLength: 1, maxLength: 120 },
						assetKey: { type: 'string', minLength: 1, maxLength: 400 },
						frames: {
							type: 'array',
							maxItems: MAX_FRAMES,
							items: { type: 'string', minLength: 1, maxLength: 400 },
						},
						weights: {
							type: 'array',
							maxItems: MAX_FRAMES,
							items: { type: 'number', minimum: 0, maximum: 1000000 },
						},
						colors: {
							type: 'array',
							maxItems: 16,
							items: {
								type: 'object',
								properties: {
									behavior: { type: 'integer', minimum: 0, maximum: 63 },
									values: {
										type: 'array',
										maxItems: 32,
										items: { type: 'string', pattern: HEX.source },
									},
								},
								required: ['behavior', 'values'],
								additionalProperties: false,
							},
						},
					},
					required: ['layer', 'assetKey', 'frames'],
					additionalProperties: false,
				},
			},
			baseEtag: baseEtagProp,
		},
		required: ['id', 'layers', 'baseEtag'],
		additionalProperties: false,
	},
	agents: ['animator'],
	scope: 'project',
	write: true,
	writes: (input, scope) => [
		fxDocKey(scope.clientKey, scope.projectKey, input.id),
		fxMetaKey(scope.clientKey, scope.projectKey, input.id),
	],
	handler: async (ctx, { id, layers, baseEtag }) => {
		const { clientKey, projectKey } = projectOf(ctx);
		if (r2Slug(id) !== id) {
			throw new AdapterError(
				400,
				'invalid_input',
				`"${id}" is not an effect id as the project stores it (lower-case letters, digits and _).`,
			);
		}
		const { doc, meta } = await loadExisting(clientKey, projectKey, id);
		const locked = await placementLock(clientKey, projectKey, id);
		if (locked) throw new AdapterError(403, 'locked', `The effect "${id}" is locked: ${locked}.`);

		const atlases = await listFxAtlases(clientKey, projectKey);
		const applied: { layer: string }[] = [];
		const unchanged: string[] = [];
		const refused: Refused[] = [];
		const before: LayerBefore[] = [];
		const seen = new Set<string>();
		for (const change of layers) {
			const layer = doc.layers.find((l) => l.key === change.layer);
			if (!layer) {
				refused.push({
					layer: change.layer,
					reason: 'the effect has no such layer; layers cannot be added',
				});
				continue;
			}
			if (seen.has(change.layer)) {
				refused.push({ layer: change.layer, reason: 'it is listed twice' });
				continue;
			}
			seen.add(change.layer);
			const result = applyLayerChange(doc, layer, change, atlases);
			if ('reason' in result) refused.push({ layer: change.layer, reason: result.reason });
			else if (!result.changed) unchanged.push(change.layer);
			else {
				applied.push({ layer: change.layer });
				before.push(result.before);
			}
		}
		if (applied.length === 0) return { applied, unchanged, refused, before, baseEtag };
		const saved = await validated(() =>
			saveEffect(clientKey, projectKey, doc, meta, preconditionOf(baseEtag)),
		);
		return { applied, unchanged, refused, before, baseEtag: baseOf(saved.etag) };
	},
});

export const FX_OPS = [getEffect, updateArt];
