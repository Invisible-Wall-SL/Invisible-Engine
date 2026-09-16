/**
 * A per-play volume the players will accept — finite and within `0..1` — or `undefined`.
 *
 * OUT OF RANGE IS DISCARDED, NOT CLAMPED, which is the rule the authored paths already apply
 * (`readVolume` in `game-config/src/sounds.ts`, `normalizeSoundsDoc` in the launcher): a value the
 * author cannot have meant falls back to the sound's own level rather than being silently rewritten
 * into a different one.
 *
 * It lives here because the flow editor's `volume` pin reaches the players WITHOUT passing either of
 * those: a number input has no range, so `2` is authorable. Howler then ignores a volume outside
 * `0..1` entirely — `volume(2)` returns the current level instead of setting it — so the firing
 * would be a silent no-op, and worse, `2` would stay in the sound map and skew every later mix
 * (`playerVolume * 2 * config.volume` is accepted while the master slider is below 0.5 and ignored
 * above it, which reads as a slider that stops working half way).
 */
export const usablePlayVolume = (volume: number | undefined): number | undefined =>
	typeof volume === 'number' && Number.isFinite(volume) && volume >= 0 && volume <= 1
		? volume
		: undefined;
