/**
 * The engine's BUILT-IN sprite sheets — the art the coded-default components reference.
 *
 * Every game app (`apps/{lines,cluster,scatter,ways,price}`) ships these sheets as LOCAL
 * assets (`static/assets/sprites/<id>/`) and registers them in its `game/assets.ts`, so
 * their frames are in `loadedAssets` under their BARE names at runtime. That is why
 * `LOADING_BAR_DEF`'s `progressBar*.png` defaults and `FREE_SPIN_COUNTER_DEF`'s
 * `Frame_FSCounter.png` resolve in a shipped game with no atlas work: they are ENGINE
 * art, not project art.
 *
 * Two things did NOT know that, and both read as "the region is missing":
 * - the editor canvas, which resolves a region name only against the PROJECT's R2
 *   atlases, so a built-in region drew a placeholder;
 * - `editorArtExport`'s dangling-region guard, which flagged them as "in NO shipped
 *   atlas and will render blank" — a false positive, since the engine bundle ships them.
 *
 * This registry is the one place both sides ask. It mirrors the built-in SPINE precedent
 * (`editorSpine.client.ts`'s `BUILTIN_SPINES`): the launcher vendors a copy of each sheet
 * under `static/builtin/sheets/<id>/` so a tool can preview coded-default art that is not
 * (and should not be) in R2.
 *
 * The vendored JSON is authoritative for RECTS — the editor parses it rather than
 * duplicating coordinates here. `regions` below is only the name → sheet ROUTING table,
 * so a name it lists but the sheet no longer packs simply misses and falls back to the
 * existing behaviour (no regression).
 */

export interface BuiltinSheet {
	/** Folder under the launcher's `static/builtin/sheets/` and under a game's
	 *  `static/assets/sprites/`. */
	readonly id: string;
	/** TexturePacker manifest file name inside that folder. */
	readonly json: string;
	/** Packed page file name inside that folder (matches the manifest's `meta.image`). */
	readonly page: string;
	/** Frame names the sheet packs — the bare keys a game looks up in `loadedAssets`. */
	readonly regions: readonly string[];
}

export const BUILTIN_SHEETS: Readonly<Record<string, BuiltinSheet>> = {
	progressBar: {
		id: 'progressBar',
		json: 'progressBar.json',
		page: 'progressBar.webp',
		regions: ['progressBar.png', 'progressBarBackground.png', 'progressBarFrame.png'],
	},
	reelsFrame: {
		id: 'reelsFrame',
		json: 'reels_frame.json',
		page: 'reels_frame.png',
		regions: [
			'frame_bg.png',
			'frame_edge.png',
			'frame_fade.png',
			'Frame_FSCounter.png',
			'Frame_Multiplier.png',
			'Frame_Tumble.png',
			'Frame_TumbleWin.png',
			'pressanywhere_fade.png',
		],
	},
};

/**
 * The built-in region names the coded component DEFAULTS reference. Declared here so the
 * defs, the editor's preview resolver and the export guard all read ONE value — a renamed
 * frame can't leave a def pointing at a name nothing ships (the drift that produced the
 * "4 placed region(s) are in NO shipped atlas" report).
 */
export const BUILTIN_REGION = {
	freeSpinCounterFrame: 'Frame_FSCounter.png',
	progressBarTrack: 'progressBarBackground.png',
	progressBarFill: 'progressBar.png',
	progressBarFrame: 'progressBarFrame.png',
} as const;

/** Region name → the built-in sheet id that packs it, or undefined when none does. */
export function builtinSheetIdForRegion(region: string): string | undefined {
	for (const sheet of Object.values(BUILTIN_SHEETS)) {
		if (sheet.regions.includes(region)) return sheet.id;
	}
	return undefined;
}

/** Whether `region` is packed by an engine-shipped sheet — i.e. it resolves in a built
 *  game with no project atlas, so it must never be reported as a dangling binding. */
export function isBuiltinRegion(region: string): boolean {
	return builtinSheetIdForRegion(region) !== undefined;
}

/** Prefix marking a `RegionSet` identifier that resolves from the vendored built-in
 *  sheets instead of R2. Mirrors `editorSpine.client.ts`'s `builtin:` spine keys. */
export const BUILTIN_SHEET_PREFIX = 'builtin:';

/** The `RegionSet` identifier for a built-in sheet id. */
export function builtinSheetKey(id: string): string {
	return `${BUILTIN_SHEET_PREFIX}${id}`;
}

/** The built-in sheet a `RegionSet` identifier names, or undefined when it isn't one. */
export function builtinSheetFromKey(key: string): BuiltinSheet | undefined {
	if (!key.startsWith(BUILTIN_SHEET_PREFIX)) return undefined;
	return BUILTIN_SHEETS[key.slice(BUILTIN_SHEET_PREFIX.length)];
}
