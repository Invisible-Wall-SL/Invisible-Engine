import type { LoadedAudio } from 'pixi-svelte';

/**
 * SOUND BANKS — how a sound NAME finds the audio that carries it.
 *
 * The player used to hold exactly one `Howl`, built from exactly one `LoadedAudio`, and played by
 * indexing that one sprite map. That is why a game could not have a sound of its own: the audiosprite
 * is baked into the app's `static/`, identical for every project, and a name that is not a region of
 * it is unplayable no matter where it is authored. See `docs/design/invisible-sound.md` §3.
 *
 * A bank is one `LoadedAudio` — the shipped audiosprite, a project's exported sounds, or a single
 * uploaded file as a one-entry sprite. `load()` takes an ORDERED list of them and a name resolves to
 * the **last** bank declaring it, so a project sound overrides a built-in of the same name. That is
 * the same last-wins rule `mergeBakedFontCatalog` uses for fonts, and it is deliberate: an author who
 * uploads `sfx_reel_stop_1` means to replace the shipped one, not to collide with it.
 *
 * MEMBERSHIP IS BY `sprite`, NOT BY `config`. `howl.play(name)` needs a sprite region; a `config`
 * entry only carries a base volume. A bank that lists a name in `config` alone does not own it, and
 * treating it as owner would route the name to a Howl that cannot play it — which howler declines
 * SILENTLY, the failure this whole feature exists to end.
 *
 * These two functions are the pure half, free of howler and of Svelte, so they are exercised offline
 * by `packages/utils-sound/banks.fixture.ts`.
 */

/**
 * Normalize `load()`'s argument into a bank list. Accepts a single `LoadedAudio` so every existing
 * caller (each game's `src/components/EnableSound.svelte`) is unchanged.
 *
 * A bank with no `src` is dropped rather than kept: it cannot become a `Howl`, and an entry that
 * silently owns names nothing can play is worse than an absent one.
 */
export function toSoundBankList<TSoundName extends string>(
	input: LoadedAudio<TSoundName> | readonly LoadedAudio<TSoundName>[] | null | undefined,
): LoadedAudio<TSoundName>[] {
	if (!input) return [];
	const list: readonly LoadedAudio<TSoundName>[] = Array.isArray(input)
		? (input as readonly LoadedAudio<TSoundName>[])
		: [input as LoadedAudio<TSoundName>];
	return list.filter((audio): audio is LoadedAudio<TSoundName> => Boolean(audio?.src));
}

/** Sound name → the index of the bank that owns it. Absent ⇒ no bank declares it. */
export type SoundBankIndex<TSoundName extends string> = Partial<Record<TSoundName, number>>;

/**
 * Build that index. Later banks overwrite earlier ones, so it is filled front to back and the last
 * writer wins.
 *
 * NULL-PROTOTYPE, deliberately. Sound names become author-supplied the moment a project uploads its
 * own, and a plain object answers `index['constructor']` with something inherited — a name resolving
 * to a bank that never declared it. The membership test this replaces (`loadedAudio.sprite[name]`)
 * had the same hole.
 */
export function buildSoundBankIndex<TSoundName extends string>(
	banks: readonly Pick<LoadedAudio<TSoundName>, 'sprite'>[],
): SoundBankIndex<TSoundName> {
	const index: SoundBankIndex<TSoundName> = Object.create(null);
	banks.forEach((bank, bankIndex) => {
		for (const name of Object.keys(bank?.sprite ?? {})) {
			index[name as TSoundName] = bankIndex;
		}
	});
	return index;
}
