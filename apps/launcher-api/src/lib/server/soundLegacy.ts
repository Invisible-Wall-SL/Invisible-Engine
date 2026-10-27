import { effectiveSoundBindings, type SoundBindings, type SoundsDoc } from 'engine-layout';
import { loadGameConfigDoc, loadGameConfigDocWithEtag } from './gameConfigStorage';
import { loadSymbolsDoc, loadSymbolsDocWithEtag } from './symbolsStorage';

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

/** A legacy doc could not be read, so what it holds is unknown. */
export class LegacySoundsUnreadableError extends Error {
	constructor(readonly doc: 'config' | 'symbols') {
		super(`The ${doc} doc could not be read.`);
		this.name = 'LegacySoundsUnreadableError';
	}
}

/**
 * {@link resolveSoundBindings} for a caller that is about to WRITE the sounds doc's own block. The
 * first save ends the fallback for good, so a legacy doc that is corrupt or fails to read must not
 * be taken for an empty one: it would be saved without the cues it holds. Throws
 * {@link LegacySoundsUnreadableError} instead.
 */
export async function resolveSoundBindingsForWrite(
	clientKey: string,
	projectKey: string,
	doc: SoundsDoc | null | undefined,
): Promise<SoundBindings | undefined> {
	if (doc?.bindings) return doc.bindings;

	const read = async <T extends { corrupt?: true }>(
		name: 'config' | 'symbols',
		load: () => Promise<T>,
	): Promise<T> => {
		let loaded: T;
		try {
			loaded = await load();
		} catch {
			throw new LegacySoundsUnreadableError(name);
		}
		if (loaded.corrupt) throw new LegacySoundsUnreadableError(name);
		return loaded;
	};
	const [config, symbols] = await Promise.all([
		read('config', () => loadGameConfigDocWithEtag(clientKey, projectKey)),
		read('symbols', () => loadSymbolsDocWithEtag(clientKey, projectKey)),
	]);

	const migrated = effectiveSoundBindings(doc, {
		configSounds: config.doc?.sounds,
		symbolSounds: (symbols.doc as { symbolSounds?: unknown }).symbolSounds,
		anticipation: (symbols.doc as { anticipation?: unknown }).anticipation,
		winLevels: config.doc?.winLevels,
	});
	return Object.keys(migrated).length ? migrated : undefined;
}
