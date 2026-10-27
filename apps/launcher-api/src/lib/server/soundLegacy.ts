import { effectiveSoundBindings, type SoundBindings, type SoundsDoc } from 'engine-layout';
import { loadGameConfigDoc } from './gameConfigStorage';
import { loadSymbolsDoc } from './symbolsStorage';

/**
 * The project's effective choices, migrated on the fly from the OLD homes when this project has not
 * saved them here yet.
 *
 * Whole-doc, never per-field: if the sounds doc carries a `bindings` block it is the entire answer,
 * exactly as {@link effectiveSoundBindings} defines it. A per-field merge would make a deliberately
 * cleared cue reappear from the config doc that still holds it, which is the failure mode this
 * migration exists to end rather than reproduce.
 *
 * A failed read of either legacy doc is swallowed: it can only ever have made the fallback richer,
 * and the whole export must not die because a config doc is momentarily unreadable. Returns
 * `undefined` when nothing anywhere binds a sound, so an untouched project ships no block at all.
 */
export async function resolveSoundBindings(
	clientKey: string,
	projectKey: string,
	doc: SoundsDoc | null | undefined,
): Promise<SoundBindings | undefined> {
	if (doc?.bindings) return doc.bindings;

	const [config, symbols] = await Promise.all([
		loadGameConfigDoc(clientKey, projectKey).catch(() => null),
		loadSymbolsDoc(clientKey, projectKey).catch(() => null),
	]);

	const migrated = effectiveSoundBindings(doc, {
		configSounds: config?.sounds,
		symbolSounds: (symbols as { symbolSounds?: unknown } | null)?.symbolSounds,
		anticipation: (symbols as { anticipation?: unknown } | null)?.anticipation,
		winLevels: config?.winLevels,
	});
	return Object.keys(migrated).length ? migrated : undefined;
}
