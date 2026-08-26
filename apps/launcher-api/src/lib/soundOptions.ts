import { MUSIC_NAMES, SOUND_EFFECT_NAMES, type TemplateVocabulary } from 'engine-flow-v2';
import type { SoundsDoc } from 'engine-layout';

/**
 * WHAT A SOUND PICKER MAY OFFER — the engine's own sounds plus this project's.
 *
 * Every sound dropdown in the launcher used to read `soundEnums.generated.ts` directly: a codegen of
 * `apps/lines/src/game/sound.ts`'s `SoundName` union, i.e. the 53 regions of the audiosprite that
 * ships with the engine. That was the whole vocabulary, so a project that uploaded its own sound
 * could store it in `/sound` and then not select it anywhere — the library and the bindings could
 * not talk about the same thing.
 *
 * This is the one place that answers the question now, and every picker reads it:
 * `/config`'s slot ladders and win tiers, `/symbols`' per-symbol and anticipation cues, and
 * `/flow-v2`'s inspector (via {@link withProjectSounds}).
 *
 * ## Why the generated enum did NOT retire with this
 *
 * The design expected it to. It cannot: those 53 names are a real fact about the shipped
 * audiosprite — which sounds a game has before it uploads anything — and the launcher has no other
 * way to know them (the sprite map lives in a game app's `static/`, which the launcher does not
 * read). The usage index and the publish gate both depend on that fact to tell a re-skin of a
 * built-in from a sound nothing plays. What retired is its ROLE as the only source: it is now the
 * BASE of the list, not the whole of it.
 */

export interface SoundOptions {
	/** Music-bed names, this project's first. */
	music: string[];
	/** One-shot names, this project's first. */
	sfx: string[];
	/** Which of the above came from the project's library — for labelling a picker's own entries. */
	project: string[];
}

/**
 * The pickable names for a project.
 *
 * A library sound's `kind` finally does something load-bearing here: it decides which of the two
 * lists the sound appears in. Until now it was only a sectioning hint.
 *
 * PROJECT SOUNDS COME FIRST, deliberately. A dropdown that opens on 53 engine names and hides the
 * five you just uploaded below them is a dropdown that gets scrolled past, and the whole point of
 * the tool is that your own audio is the thing you are reaching for. A name that appears in both
 * (an upload that REPLACES a built-in) is listed once, from the project.
 */
export function soundOptionsFor(library: SoundsDoc | null | undefined): SoundOptions {
	const entries = library?.entries ?? [];
	const project = entries.map((e) => e.name);
	const own = new Set(project);
	const merge = (mine: string[], builtin: readonly string[]) => [
		...mine,
		...builtin.filter((n) => !own.has(n)),
	];
	return {
		music: merge(
			entries.filter((e) => e.kind === 'music').map((e) => e.name),
			MUSIC_NAMES,
		),
		sfx: merge(
			entries.filter((e) => e.kind !== 'music').map((e) => e.name),
			SOUND_EFFECT_NAMES,
		),
		project,
	};
}

/** The options a picker shows when the project has no library of its own — the engine's set,
 *  unchanged. Keeps a page that has not been given options rendering exactly as it did. */
export const BUILTIN_SOUND_OPTIONS: SoundOptions = {
	music: [...MUSIC_NAMES],
	sfx: [...SOUND_EFFECT_NAMES],
	project: [],
};

/**
 * A flow vocabulary whose three sound enums also offer the project's sounds.
 *
 * The enums are ONLY dropdown options — `validate.ts` checks an enum literal with
 * `typeof value === 'string'` and never tests membership — so extending them changes what the
 * inspector lists and nothing else. A graph that already names a project sound was valid before
 * this; it just could not be authored through the UI.
 *
 * Returns the vocabulary UNCHANGED when the project has no sounds, so a project that uploaded
 * nothing keeps the exact object identity the editor had before.
 */
export function withProjectSounds(
	vocab: TemplateVocabulary,
	options: SoundOptions,
): TemplateVocabulary {
	if (!options.project.length) return vocab;
	const byName: Record<string, string[]> = {
		MusicName: options.music,
		SoundEffectName: options.sfx,
		SoundName: [...options.music, ...options.sfx],
	};
	return {
		...vocab,
		enums: vocab.enums.map((e) => (byName[e.name] ? { ...e, values: byName[e.name] } : e)),
	};
}
