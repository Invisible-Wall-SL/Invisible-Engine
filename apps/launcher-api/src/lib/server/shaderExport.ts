/**
 * Export a project's shader graphs into the game-loadable `deploy/` subtree, compiled: the
 * Invisible Shader Graph analogue of `effectExport.ts` (rule 8,
 * `docs/design/invisible-shader-graph.md` §8 step 4).
 *
 *   <client>/<project>/shaders/<id>.json              ← the authored graph (/api/shaders/save)
 *   _shared/shaders/<id>.json                         ← the studio-shared library
 *   <client>/<project>/deploy/editor-shaders/<id>.json ← the compiled effect (this writes it)
 *   <client>/<project>/deploy/editor-shaders/index.json
 *
 * No graph runs in the game: each is compiled here to the `CustomElementFx` the runtime plays as
 * `custom:<id>` (its GLSL pass, passes and motion), one plain JSON value. The bake and the runtime
 * bundle embed the list as `shaderEffects`, and the game registers it with `setCustomElementFx`
 * at boot; `pull-project-assets.mjs` mirrors `deploy/editor-shaders/` with the rest of `deploy/`.
 *
 * What ships is the project's set (its own graphs and the shared ones it does not override). A
 * graph that does not compile is left out and named in `skipped`, so an entry naming it plays
 * nothing rather than failing the build. Stale objects from an earlier export are pruned, so a
 * project with no graphs ships none. Idempotent.
 */
import { CUSTOM_ELEMENT_FX_PREFIX, type CustomElementFx } from 'constants-shared/elementFx';
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

	const written = new Set<string>();
	for (const effect of effects) {
		const key = `${prefix}${effect.spec.kind.slice(CUSTOM_ELEMENT_FX_PREFIX.length)}.json`;
		await putObjectText(key, JSON.stringify(effect), 'application/json');
		written.add(key);
	}
	const index = {
		effects: effects.map((e) => ({ kind: e.spec.kind, label: e.spec.label })),
		skipped,
	};
	const indexKey = `${prefix}index.json`;
	await putObjectText(indexKey, JSON.stringify(index, null, '\t'), 'application/json');
	written.add(indexKey);

	await deleteObjects((await listAllKeys(prefix)).filter((k) => !written.has(k)));
	return { shaderEffects: effects, skipped };
}
