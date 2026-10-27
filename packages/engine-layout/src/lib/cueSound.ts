/**
 * Timeline SOUND CUES: the options an `sfx:` / `music:` cue key carries, and the one place that
 * turns such a cue into calls on the game's sound player. Every timeline that fires cues (a screen
 * timeline, a cinematic, a component timeline on any instance) ends here, so an option means the
 * same thing wherever its cue sits.
 *
 * ## The key format
 *
 * A cue key was `{ time, cue }`, with the namespace in the string. It stays that: the options ride
 * in an OPTIONAL `sound` object beside `cue`, so
 *  - a key without `sound` is exactly the old cue and plays exactly as before (a one-shot at the
 *    sound's own level on the SFX channel, or a music bed), and
 *  - an older reader, which only reads `cue`, plays the named sound plainly and ignores the rest
 *    (`docs/conventions/doc-readers.md`). A stop cue degrades to a plain play there, the one
 *    option an older runtime cannot ignore silently: no older runtime plays a component cue at all.
 *
 * Everything is read through {@link readCueSound}, which keeps only the fields of the cue's kind,
 * clamps numbers into {@link CUE_SOUND_RANGES} and drops the rest, so a newer build's field or a
 * hand-edited doc costs that field, never the cue.
 *
 * ## Why this package does the playing without depending on a sound player
 *
 * `engine-layout` is shared by every game and the launcher, and owns no audio. The game hands
 * {@link playCueSound} its player as a {@link CueSoundTarget} (structural: `utils-sound`'s
 * `createSound()` result fits it) and registers a sink with {@link registerCueSound}, which
 * `<ComponentInstance>` calls for a component timeline's sound cue. Unregistered (the launcher's
 * previews, a game that wires none) ⇒ a component's sound cue is dropped, as it always was.
 */

export const CUE_SOUND_KINDS = ['sfx', 'music'] as const;
export type CueSoundKind = (typeof CUE_SOUND_KINDS)[number];

/** What a sound cue does. Absent ⇒ play. */
export const CUE_SOUND_ACTIONS = ['play', 'stop'] as const;
export type CueSoundAction = (typeof CUE_SOUND_ACTIONS)[number];

/**
 * A sound cue's options. Every field is optional and absent means "as the plain cue": one play at
 * the sound's own level, no fade, the channel's volume. Times are milliseconds.
 */
export interface CueSoundOptions {
	/** `stop` ends the named sound (a loop a play cue started, or a music bed). Absent ⇒ play. */
	action?: 'stop';
	/** × the sound's own level and the player's channel volume (SFX or music). */
	volume?: number;
	/** SFX: ± a random share of `volume` per play. */
	volumeJitter?: number;
	/** SFX: playback rate (pitch and speed together). */
	rate?: number;
	/** SFX: ± a random amount added to `rate` per play. */
	rateJitter?: number;
	/** SFX: stereo pan, −1 left … 1 right. Web Audio only; HTML5 audio plays it centred. */
	pan?: number;
	/** SFX: loop until a stop cue names it. Music: override the track's own loop flag. */
	loop?: boolean;
	/** Fade in over this long. Music: the crossfade, the bed it replaces fading out as long. */
	fadeIn?: number;
	/** Stop cues: fade out over this long, then stop. */
	fadeOut?: number;
	/** SFX: start this far into the sound. */
	offset?: number;
	/** SFX: a play while the sound still plays starts another copy. Absent ⇒ the play is skipped,
	 *  as a plain cue's always was. */
	overlap?: boolean;
	/** SFX: other sounds to pick from at random with the cue's own, one per play. */
	pick?: string[];
}

/** A cue key on a timeline's `cue` track. */
export interface CueKey {
	time: number;
	cue: string;
	sound?: CueSoundOptions;
}

/** Inclusive ranges a number option is clamped into. The editor's copy (`timeline.js`) must match:
 *  `check:timeline-cue-sound` holds them together. */
export const CUE_SOUND_RANGES = {
	volume: [0, 1],
	volumeJitter: [0, 1],
	rate: [0.5, 2],
	rateJitter: [0, 0.5],
	pan: [-1, 1],
	fadeIn: [0, 10000],
	fadeOut: [0, 10000],
	offset: [0, 60000],
} as const satisfies Record<string, readonly [number, number]>;
export type CueSoundNumberOption = keyof typeof CUE_SOUND_RANGES;

/** The options each kind honours; any other is dropped on read. */
export const CUE_SOUND_FIELDS: Record<CueSoundKind, readonly (keyof CueSoundOptions)[]> = {
	sfx: ['action', 'volume', 'volumeJitter', 'rate', 'rateJitter', 'pan', 'loop', 'fadeIn', 'fadeOut', 'offset', 'overlap', 'pick'], // prettier-ignore
	music: ['action', 'volume', 'loop', 'fadeIn', 'fadeOut'],
};

/** At most this many alternates in a `pick` list. */
export const CUE_SOUND_MAX_PICK = 8;

/** The sound kind and name of an `sfx:` / `music:` cue, or `undefined` for any other cue. */
export function cueSoundOf(cue: string): { kind: CueSoundKind; name: string } | undefined {
	const sep = cue.indexOf(':');
	if (sep <= 0) return undefined;
	const kind = cue.slice(0, sep);
	const name = cue.slice(sep + 1);
	if (!name || !(CUE_SOUND_KINDS as readonly string[]).includes(kind)) return undefined;
	return { kind: kind as CueSoundKind, name };
}

const clamp = (n: number, [lo, hi]: readonly [number, number]): number =>
	Math.min(Math.max(n, lo), hi);

/**
 * The options a cue of `kind` honours, read from a key's raw `sound` value: unknown and
 * other-kind fields dropped, numbers clamped, a non-number / non-bool / empty value dropped.
 * `undefined` when nothing is left, so a key without options reads exactly like the plain cue.
 */
export function readCueSound(kind: CueSoundKind, raw: unknown): CueSoundOptions | undefined {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
	const src = raw as Record<string, unknown>;
	const out: CueSoundOptions = {};
	for (const field of CUE_SOUND_FIELDS[kind]) {
		const value = src[field];
		if (value === undefined) continue;
		if (field === 'action') {
			if (value === 'stop') out.action = 'stop';
		} else if (field === 'loop' || field === 'overlap') {
			if (typeof value === 'boolean') out[field] = value;
		} else if (field === 'pick') {
			if (!Array.isArray(value)) continue;
			const names = [
				...new Set(value.filter((n): n is string => typeof n === 'string' && !!n.trim())),
			].slice(0, CUE_SOUND_MAX_PICK);
			if (names.length) out.pick = names;
		} else if (typeof value === 'number' && Number.isFinite(value)) {
			out[field] = clamp(value, CUE_SOUND_RANGES[field]);
		}
	}
	return Object.keys(out).length ? out : undefined;
}

/**
 * The game's sound player, as much of it as a cue needs. `utils-sound`'s `createSound()` result
 * fits it structurally; method syntax keeps a player typed on its own sound-name union assignable.
 */
export interface CueSoundChannel {
	play(options: { name: string; volume?: number; forcePlay?: boolean; fade?: number }): void;
	stop(options: { name: string }): void;
	fade(options: { name: string; from: number; to: number; duration: number }): void | Promise<void>;
	rate(options: { name: string; rate: number }): void;
	pan(options: { name: string; pan: number }): void;
	loop(options: { name: string; loop: boolean }): void;
	seek(options: { name: string; offset: number }): void;
	/** The level this channel last played `name` at, or `undefined` when it is not playing. */
	level(name: string): number | undefined;
}

export interface CueSoundTarget {
	hasSound(name: string): boolean;
	players: { once: CueSoundChannel; loop: CueSoundChannel; music: CueSoundChannel };
}

/** Where a stop cue is looked for: every channel a play cue of that kind can have used. */
const channelsOf = (target: CueSoundTarget, kind: CueSoundKind): CueSoundChannel[] =>
	kind === 'music' ? [target.players.music] : [target.players.loop, target.players.once];

/**
 * Play (or stop) one sound cue on the game's player. A cue naming a sound no loaded bank carries
 * warns rather than plays: howler declines an unknown sprite silently, which would make a typo an
 * inaudible non-failure. `random` is injectable for the gates.
 *
 * A plain cue (no options) makes exactly the call it always made: `once.play({ name })` or
 * `music.play({ name })`.
 */
export function playCueSound(
	target: CueSoundTarget,
	cue: string,
	rawOptions?: unknown,
	random: () => number = Math.random,
): void {
	const sound = cueSoundOf(cue);
	if (!sound) return;
	const { kind } = sound;
	const options = readCueSound(kind, rawOptions);
	if (options?.action === 'stop') {
		stopCueSound(target, kind, sound.name, options);
		return;
	}
	const pool = [sound.name, ...(options?.pick ?? [])].filter((n) => target.hasSound(n));
	if (!pool.length) {
		console.warn(`[cue] "${cue}" names a sound this game has no region for.`);
		return;
	}
	const name = pool.length === 1 ? pool[0] : pool[Math.floor(random() * pool.length)];
	if (!options) {
		(kind === 'music' ? target.players.music : target.players.once).play({ name });
		return;
	}
	const jitter = (base: number, spread: number | undefined): number =>
		spread ? base + (random() * 2 - 1) * spread : base;
	const volumeJitter = options.volumeJitter ? options.volumeJitter * (options.volume ?? 1) : 0;
	const volume =
		options.volume === undefined && !volumeJitter
			? undefined
			: clamp(jitter(options.volume ?? 1, volumeJitter), CUE_SOUND_RANGES.volume);

	if (kind === 'music') {
		const music = target.players.music;
		const fade = options.fadeIn || undefined;
		music.play({ name, volume, fade });
		if (options.loop !== undefined) music.loop({ name, loop: options.loop });
		return;
	}

	const channel = options.loop ? target.players.loop : target.players.once;
	if (options.loop && channel.level(name) !== undefined) return;
	channel.play({ name, volume, forcePlay: options.overlap || undefined });
	if (options.loop) channel.loop({ name, loop: true });
	if (options.offset) channel.seek({ name, offset: options.offset });
	if (options.rate !== undefined || options.rateJitter) {
		const rate = clamp(jitter(options.rate ?? 1, options.rateJitter), CUE_SOUND_RANGES.rate);
		channel.rate({ name, rate });
	}
	if (options.pan) channel.pan({ name, pan: options.pan });
	if (options.fadeIn) {
		channel.fade({ name, from: 0, to: volume ?? 1, duration: options.fadeIn });
	}
}

function stopCueSound(
	target: CueSoundTarget,
	kind: CueSoundKind,
	cueName: string,
	options: CueSoundOptions,
): void {
	for (const name of [cueName, ...(options.pick ?? [])]) {
		for (const channel of channelsOf(target, kind)) {
			const level = channel.level(name);
			if (level === undefined) continue;
			if (!options.fadeOut) {
				channel.stop({ name });
				continue;
			}
			void channel.fade({ name, from: level, to: 0, duration: options.fadeOut });
			setTimeout(() => stopIfSilent(channel, name), options.fadeOut);
		}
	}
}

/** A faded-out sound is stopped only if nothing replayed it while it faded (its level is back up). */
function stopIfSilent(channel: CueSoundChannel, name: string): void {
	if (channel.level(name) === 0) channel.stop({ name });
}

/** Plays a component timeline's sound cue; the game registers one at boot. */
export type CueSoundSink = (cue: string, options: unknown) => void;

let sink: CueSoundSink | undefined;

/** Register the game's sound-cue sink. Returns the unregister. */
export function registerCueSound(next: CueSoundSink): () => void {
	sink = next;
	return () => {
		if (sink === next) sink = undefined;
	};
}

/** The registered sink, or `undefined` (a component's sound cue is then dropped). */
export function getCueSound(): CueSoundSink | undefined {
	return sink;
}
