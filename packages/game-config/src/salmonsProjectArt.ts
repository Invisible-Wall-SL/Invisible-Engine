import { isObject } from './normalizeParts';
import type { GameConfigDoc } from './types';

/**
 * SALMONS' ORIGINAL ART AS PROJECT ART (`docs/status/salmons.md`): the sheets the runtime's built-in
 * Salmons art (`engine-layout` `salmonsArt/`) is also stored as in the project, so the Sheet Maker
 * and the Atlas Maker show and edit it. The art exporter ships them for a config whose rooms draw
 * with that art, and the online runtime draws a region from them when they ship it, from the
 * built-in copy otherwise. Region names are the built-in ones, unchanged.
 */

/** The field generators whose rooms are drawn in Salmons' art (`apps/lines` `online.ts` `FIELD_ART`). */
export const SALMONS_ART_GENERATORS: readonly string[] = ['salmonsRiver', 'salmonsMap'];

/**
 * The zone families (`zoneArt.ts` `zoneFamilyOf`) Salmons' art draws a piece on: the rest of its
 * generators' zones are walls and currents for the rules alone (`band#Water`, `waterfall#Bear`, …),
 * which `/config`'s Zone art card hides unless asked.
 */
export const SALMONS_DRAWN_ZONE_FAMILIES: readonly string[] = [
	'rock#',
	'whirlpool#',
	'sandbank#',
	'waterfall#',
	'bridge#',
	'source',
	'sea',
];

/**
 * Each built-in sheet's project sheet; `waterfall_face` and `cliff` are the one-region sheets of the
 * tiles. Plain literals, no top-level calls: a runtime that never draws Salmons must tree-shake this
 * module away (`check:runtime-bytes`).
 */
export const SALMONS_PROJECT_SHEETS = {
	terrain: 'salmons_terrain',
	props: 'salmons_props',
	characters: 'salmons_characters',
	waterfall_face: 'salmons_waterfall_face',
	cliff: 'salmons_cliff',
} as const;

export type SalmonsProjectSheet =
	(typeof SALMONS_PROJECT_SHEETS)[keyof typeof SALMONS_PROJECT_SHEETS];

/** A project sheet's manifest file, as the Sheet Maker names it under `manifests/`. */
export function salmonsProjectManifestName(sheet: SalmonsProjectSheet): string {
	return `atlas_manifest_${sheet}.json`;
}

/**
 * The project sheet a manifest key is, or none: `<client>/<project>/manifests/atlas_manifest_<sheet>.json`
 * (the editor-art `sheet.key`, also each shipped sheet's namespace without its `::`).
 */
export function salmonsProjectSheetOf(manifestKey: string): SalmonsProjectSheet | undefined {
	const match = /\/manifests\/atlas_manifest_([a-z_]+)\.json$/.exec(manifestKey);
	const sheets: readonly string[] = Object.values(SALMONS_PROJECT_SHEETS);
	return match && sheets.includes(match[1]) ? (match[1] as SalmonsProjectSheet) : undefined;
}

/** Whether a config's rooms are drawn in Salmons' art (its `arcade.online.generator`). */
export function usesSalmonsArt(config: GameConfigDoc | null | undefined): boolean {
	const arcade: unknown = (config as { arcade?: unknown } | null | undefined)?.arcade;
	const online = isObject(arcade) ? arcade.online : undefined;
	const generator = isObject(online) ? online.generator : undefined;
	return typeof generator === 'string' && SALMONS_ART_GENERATORS.includes(generator);
}
