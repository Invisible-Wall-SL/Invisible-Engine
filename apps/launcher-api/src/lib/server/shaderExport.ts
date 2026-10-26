/**
 * Export a project's shader graphs into the game-loadable `deploy/` subtree, compiled: the
 * Invisible Shader Graph analogue of `effectExport.ts` (rule 8,
 * `docs/design/invisible-shader-graph.md` §8 step 4).
 *
 *   <client>/<project>/shaders/<id>.json              ← the authored graph (/api/shaders/save)
 *   _shared/shaders/<id>.json                         ← the studio-shared library
 *   <client>/<project>/deploy/editor-shaders/<id>.json ← the compiled effect (this writes it)
 *   <client>/<project>/deploy/editor-shaders/_index.json (no graph id starts with `_`)
 *
 * No graph runs in the game: each is compiled here to the `CustomElementFx` the runtime plays as
 * `custom:<id>` (its GLSL pass, passes and motion), one plain JSON value. The bake and the runtime
 * bundle embed the list as `shaderEffects`, and the game registers it with `setCustomElementFx`
 * at boot; `pull-project-assets.mjs` mirrors `deploy/editor-shaders/` with the rest of `deploy/`.
 *
 * The deploy tree holds the project's set (its own graphs and the shared ones it does not
 * override); a bundle embeds only the effects it names ({@link namedShaderEffects}). A
 * graph that does not compile is left out and named in `skipped` (for the bake's log, never in a
 * file a game ships), so an entry naming it plays nothing rather than failing the build;
 * {@link unshippedCustomKinds} names such entries for Publish. Stale objects from an earlier export
 * are pruned, so a project with no graphs ships none. Idempotent.
 */
import {
	CUSTOM_ELEMENT_FX_PREFIX,
	isCustomElementFxKind,
	type CustomElementFx,
} from 'constants-shared/elementFx';
import { mapWithConcurrency } from './concurrency';
import { SUB } from './projectPaths';
import { deleteObjects, listAllKeys, putObjectText } from './r2';
import { compileProjectShaders, type ShaderSkip } from './shaderStorage';

export interface ShaderExportIndex {
	/** The compiled effects, in the set's order. Empty when the project has none. */
	shaderEffects: CustomElementFx[];
	/** Graphs left out because they do not compile, with their errors. */
	skipped: ShaderSkip[];
}

/** `<client>/<project>/deploy/editor-shaders/`. */
export const shaderDeployPrefix = (clientKey: string, projectKey: string): string =>
	`${SUB.deploy(clientKey, projectKey)}/editor-shaders/`;

export async function exportShaders(
	clientKey: string,
	projectKey: string,
): Promise<ShaderExportIndex> {
	const prefix = shaderDeployPrefix(clientKey, projectKey);
	const { effects, skipped } = await compileProjectShaders(clientKey, projectKey);

	const files = effects.map((effect) => ({
		key: `${prefix}${effect.spec.kind.slice(CUSTOM_ELEMENT_FX_PREFIX.length)}.json`,
		text: JSON.stringify(effect),
	}));
	files.push({
		key: `${prefix}_index.json`,
		text: JSON.stringify(
			effects.map((e) => ({ kind: e.spec.kind, label: e.spec.label })),
			null,
			'\t',
		),
	});
	await mapWithConcurrency(files, 8, ({ key, text }) =>
		putObjectText(key, text, 'application/json'),
	);
	const written = new Set(files.map((f) => f.key));

	await deleteObjects((await listAllKeys(prefix)).filter((k) => !written.has(k)));
	return { shaderEffects: effects, skipped };
}

/** Every custom Element FX kind named anywhere in `value`: an entry's kind, a Flow parameter. */
function customKindsNamed(value: unknown, into: Set<string>): Set<string> {
	if (typeof value === 'string') {
		if (isCustomElementFxKind(value)) into.add(value);
	} else if (Array.isArray(value)) {
		for (const item of value) customKindsNamed(item, into);
	} else if (value && typeof value === 'object') {
		for (const item of Object.values(value)) customKindsNamed(item, into);
	}
	return into;
}

/** The custom kinds a bundle names outside its `shaderEffects`. */
function namedCustomKinds(bundle: Record<string, unknown>): Set<string> {
	const named = new Set<string>();
	for (const [section, value] of Object.entries(bundle)) {
		if (section !== 'shaderEffects') customKindsNamed(value, named);
	}
	return named;
}

/**
 * The effects a bundle ships: those it names (an entry's kind, a Flow parameter). A project's set
 * takes in the whole studio-shared library, and a game carries only what it plays.
 */
export function namedShaderEffects(
	effects: readonly CustomElementFx[],
	bundle: Record<string, unknown>,
): CustomElementFx[] {
	const named = namedCustomKinds(bundle);
	return effects.filter((e) => named.has(e.spec.kind));
}

/**
 * The custom kinds a bundle names (in its scenes, components, symbols, flow…) that it does not ship
 * in `shaderEffects`: entries that will play nothing, because their graph was deleted or does not
 * compile. Sorted; empty when every one ships.
 */
export function unshippedCustomKinds(bundle: Record<string, unknown>): string[] {
	const named = namedCustomKinds(bundle);
	const shipped = new Set<string>(
		((bundle.shaderEffects ?? []) as CustomElementFx[]).map((e) => e.spec.kind),
	);
	return [...named].filter((kind) => !shipped.has(kind)).sort();
}
