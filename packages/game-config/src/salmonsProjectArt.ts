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
export const SALMONS_ART_GENERATORS: readonly string[] = Object.freeze([
	'salmonsRiver',
	'salmonsMap',
]);

/** Each built-in sheet's project sheet; `waterfall_face` is the one-region sheet of the tile. */
export const SALMONS_PROJECT_SHEETS = Object.freeze({
	terrain: 'salmons_terrain',
	props: 'salmons_props',
	characters: 'salmons_characters',
	waterfall_face: 'salmons_waterfall_face',
} as const);

export type SalmonsProjectSheet =
	(typeof SALMONS_PROJECT_SHEETS)[keyof typeof SALMONS_PROJECT_SHEETS];

const SHEET_NAMES: ReadonlySet<string> = new Set(Object.values(SALMONS_PROJECT_SHEETS));

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
	return match && SHEET_NAMES.has(match[1]) ? (match[1] as SalmonsProjectSheet) : undefined;
}

/** Whether a config's rooms are drawn in Salmons' art (its `arcade.online.generator`). */
export function usesSalmonsArt(config: GameConfigDoc | null | undefined): boolean {
	const arcade: unknown = (config as { arcade?: unknown } | null | undefined)?.arcade;
	const online = isObject(arcade) ? arcade.online : undefined;
	const generator = isObject(online) ? online.generator : undefined;
	return typeof generator === 'string' && SALMONS_ART_GENERATORS.includes(generator);
}
