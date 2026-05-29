/** Shared (client + server safe) Atlas Maker manifest types. */

/** One region in an atlas manifest. Mirrors the local Atlas Maker schema; only
 * `name` is required. Cloud refs (`style_ref`/`shape_ref`) are R2 keys. */
export type AtlasRegion = {
	name: string;
	prompt?: string;
	seed?: number | null;
	style_ref?: string; // R2 key of the style reference image
	shape_ref?: string; // R2 key of the shape/controlnet reference image
	mode?: '' | 'generate' | 'shine' | 'glow' | 'shadow' | 'colour';
	skip_unless_explicit?: boolean;
	output_key?: string; // R2 key of the chosen variant for this region
	// per-region pipeline overrides (optional)
	controlnet_strength?: number;
	controlnet_end_percent?: number;
	ipadapter_weight?: number;
	lora_strength?: number;
	fx?: Record<string, unknown>;
};

export type AtlasManifest = {
	atlas?: { atlas_file?: string; source_image?: string };
	style?: { positive_prefix?: string; positive_suffix?: string; negative?: string };
	config?: Record<string, unknown>;
	regions: AtlasRegion[];
};
