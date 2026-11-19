/**
 * The `models` asset class's export index (`docs/design/3d/assets-evaluation.md` §4, §5.3): what
 * `modelExport.ts` writes, the bake embeds, the pull reads and the 3D runtime registers. Types only,
 * so importing it adds no runtime bytes anywhere. Tier data lives in `modelTiers.ts`.
 */
import type {
	ModelClass,
	ModelLodLevel,
	ModelLodScreenSize,
	ModelMap,
	ModelTextureEncoding,
	ModelTierId,
} from './modelTiers';

/** One shipped texture of one tier. `file` is relative to `deploy/models/` (`_tex/<hash>@<tier>.ktx2`). */
export interface ModelExportMap {
	file: string;
	w: number;
	h: number;
	enc: ModelTextureEncoding;
	mips: number;
}

export interface ModelExportLod {
	/** The master level (`MODEL_LOD_ULTRA` = `_LODU`). The GLB carries it as a `_LOD<n>` / `_LODU` node. */
	level: ModelLodLevel;
	/** The node that draws it (`<base>_LOD<n>`); a multi-part model lists one entry per part. */
	node?: string;
	tris: number;
	/** `authored` = the master's own `_LOD<n>` mesh; `generated` = simplified at export. */
	source: 'authored' | 'generated';
}

export interface ModelExportTier {
	/** Relative to `deploy/models/`: `<id>.glb` for `full`, `<id>@<tier>.glb` otherwise. */
	glb: string;
	bytes: number;
	/** GPU memory of the tier's textures once transcoded, mip chains included. */
	vramBytes: number;
	lods: ModelExportLod[];
	maps: Partial<Record<ModelMap, ModelExportMap | 'dropped'>>;
}

export interface ModelExportEntry {
	id: string;
	class: ModelClass;
	/** Animation names in the GLB (clip libraries name them `<set>.<clip>`). */
	clips: string[];
	/** `SK_<name>` socket empties, without the prefix. */
	sockets: string[];
	lodScreenSize: ModelLodScreenSize;
	/**
	 * Every published tier with its own copy. A tier that would equal `full` is absent; the runtime
	 * reads `tiers[chosen] ?? tiers.full`.
	 */
	tiers: Partial<Record<ModelTierId, ModelExportTier>> & { full: ModelExportTier };
}

/** A model the game names that did not ship this export, and why (shown, never shipped). */
export interface ModelExportSkip {
	id: string;
	reason: string;
}

export interface ModelExportIndex {
	prefix: 'models';
	models: ModelExportEntry[];
	/**
	 * The export's report of what did NOT ship: the route answers it and the bake prints it. Never
	 * part of a game bundle (the runtime assemble and the bake both strip it).
	 */
	skipped?: ModelExportSkip[];
}
