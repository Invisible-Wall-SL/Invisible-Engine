/**
 * The tier ids a STORED `LayoutDoc.resolutionTiers` keeps: the 2D art tiers (`engine-layout`
 * `RESOLUTION_TIERS`) plus the 3D model tiers that are not 2D ones (`constants-shared` `MODEL_TIERS`
 * minus `full`: `ultra`, `quarter`). One list for both, as `docs/design/3d/assets-evaluation.md`
 * §5.3 asks, so a 3D project's model tiers survive an editor save.
 *
 * Only the doc's storage keeps the model ids. Every 2D reader still reads the list through
 * `normalizeResolutionTiers`, which keeps only the 2D ids, so the page store, the art export and
 * every 2D game see exactly what they did; the model export reads it through `publishedModelTiers`.
 * `RESOLUTION_TIERS` itself never gains a model id (it is compiled into every 2D runtime).
 */
import { normalizeResolutionTiers, type StoredResolutionTierId } from 'engine-layout';
import { MODEL_FALLBACK_TIER, MODEL_TIERS, type ModelTierId } from 'constants-shared/modelTiers';

const is2dTier = (id: string) => normalizeResolutionTiers([id]) !== undefined;

/** The model tiers `input` names that are not 2D tiers, in `MODEL_TIERS` order. */
export function modelOnlyResolutionTiers(input: unknown): ModelTierId[] {
	if (!Array.isArray(input)) return [];
	return MODEL_TIERS.filter(
		(id) => id !== MODEL_FALLBACK_TIER && !is2dTier(id) && input.includes(id),
	);
}

/** What the doc stores: the 2D ids in their order, then the model-only ids; `undefined` for none,
 *  so a 2D-only doc stores exactly what it did. An id neither list knows is dropped. */
export function storedResolutionTiers(input: unknown): StoredResolutionTierId[] | undefined {
	const all = [...(normalizeResolutionTiers(input) ?? []), ...modelOnlyResolutionTiers(input)];
	return all.length > 0 ? all : undefined;
}
