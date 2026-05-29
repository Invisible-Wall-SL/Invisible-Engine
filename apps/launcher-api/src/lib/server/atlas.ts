import { error } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import type { AtlasManifest, AtlasRegion } from '$lib/atlas-types';

export type { AtlasManifest, AtlasRegion } from '$lib/atlas-types';

export function requireAtlasAccess(locals: App.Locals): void {
	if (!locals.user) throw error(401, 'Not authenticated');
	if (!roleHasTool(locals.user.role, 'atlasTool')) {
		throw error(403, 'Your role does not have access to the Atlas Maker.');
	}
}

/** Default SDXL generation config (from the Atlas Maker's atlas_config.json).
 * gen size kept square/modest for cloud runs; tune later per project. */
export const DEFAULT_ATLAS_CONFIG = {
	pipeline: 'sdxl',
	checkpoint: 'juggernautXL_ragnarokBy.safetensors',
	lora: 'gameIconInstitute3d_v10.safetensors',
	lora_strength: 0.85,
	controlnet: 'controlnet-union-sdxl-1.0-promax.safetensors',
	rmbg_model: 'RMBG-2.0',
	ipadapter_weight: 0.35,
	ipadapter_weight_type: 'style transfer',
	controlnet_strength: 0.7,
	controlnet_end_percent: 0.85,
	ksampler_steps: 30,
	ksampler_cfg: 8.5,
	gen_width: 1024,
	gen_height: 1024,
};

export function parseManifest(text: string | null): AtlasManifest | null {
	if (!text) return null;
	const m = JSON.parse(text) as Partial<AtlasManifest>;
	return {
		atlas: m.atlas ?? {},
		style: m.style ?? {},
		config: m.config ?? {},
		regions: Array.isArray(m.regions) ? (m.regions as AtlasRegion[]) : [],
	};
}

/** Merge manifest-level config over the defaults — the effective generation config. */
export function effectiveConfig(manifest: AtlasManifest | null): Record<string, unknown> {
	return { ...DEFAULT_ATLAS_CONFIG, ...(manifest?.config ?? {}) };
}
