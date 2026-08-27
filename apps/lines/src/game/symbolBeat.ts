/**
 * ONE SYMBOL-ANIMATION BEAT — awaited, but never unbounded.
 *
 * Every presentation that plays a symbol state and waits for it does the same thing: set
 * `symbolState`, await the cell's `oncomplete`, move on. The wait is what makes an AUTHORED
 * animation drive the pacing, and it is also the single way this game freezes, because a symbol
 * only reports `oncomplete` when its state actually PLAYS something:
 *
 *  - `SymbolSprite` fires from an `$effect` on `symbolInfo` — a state bound to art that is already
 *    on screen has nothing to report.
 *  - `Symbol.svelte` renders NOTHING when the state resolves to no art at all (`missingArt`), so no
 *    renderer is mounted to report in the first place.
 *  - `SymbolWrap` only mounts the cell on the layer that matches its `animating` flag and only while
 *    the seat is in frame, so an out-of-frame cell has no `<Symbol>` either.
 *  - a spine whose bound `animationName` is not in the skeleton — or is a loop — never fires
 *    `complete`.
 *
 * Any one of those turns `await` into `await forever`. The beat's `Promise.all` never settles, the
 * book event that owns it never finishes, and the round stops dead: the spin button stays disabled
 * and the game reads as frozen until the player slams (a slam releases it only because
 * `awaitCue` races the round-skip token — nothing else bounds it).
 *
 * So every such wait is RACED against a cap. An authored animation still wins the race and still
 * sets the pace; an unauthored one costs one bounded beat. The cap is a RUNAWAY GUARD, not a
 * shaper — each caller sizes its own, above anything that surface plausibly authors (see the two
 * constants below), because a cap that a real animation can hit stops being a guard and starts
 * being the timing.
 *
 * It lives here rather than beside any one caller because there are three of them — the cascade's
 * explode/land beats (`TumbleBoard`), the win beat (`Board`) and the multiplier collect
 * (`MultiplierBoard`) — and the first two grew the guard independently while the third, the one
 * every online game hits on every paying spin, never grew one at all. That is exactly the drift a
 * shared helper exists to prevent.
 */

import { waitForResolve, waitForTimeout } from 'utils-shared/wait';

/**
 * Await a symbol's completion, but never longer than `capMs`.
 *
 * `arm` receives the resolve to hang on the cell — `(resolve) => (symbol.oncomplete = resolve)`.
 * When the cap wins, the armed `oncomplete` is left in place and fires into an already-settled
 * promise later; harmless, and cheaper than tearing it down.
 *
 * A caller that mutates state on completion must still settle that state AFTER the await rather
 * than only inside `arm`, since the cap path never runs the callback.
 */
export const awaitSymbolBeat = (arm: (resolve: () => void) => void, capMs: number) =>
	Promise.race([waitForResolve(arm), waitForTimeout(capMs)]);

/**
 * A beat that is a STEP ON THE WAY somewhere: the cascade's `tumbleExplosion` and `land`
 * (`TumbleBoard`) and the multiplier collect's `win` (`MultiplierBoard`).
 *
 * Short, because the sequence has somewhere to be and the guard doubles as the pace a project that
 * authored no art for these states gets. Observed on `test4` before it existed: the cascade played,
 * then the game would not accept another spin, intermittently, because whether it hung depended on
 * WHICH symbol exploded.
 */
export const TRANSIT_BEAT_CAP_MS = 650;

/**
 * The EMERGE arrival (`tumbleBoardAppear`) — a symbol appearing on its seat and playing its
 * authored `intro` state there.
 *
 * Sized between the other two, because the beat sits between them in kind. It is not a step on the
 * way somewhere — under `swapStyle: 'emerge'` nothing travels, so the intro IS how the board
 * arrives, an animation an artist authored to be watched, which is the argument for the win beat's
 * long cap. But it is also on the CRITICAL PATH of every single spin, where the win beat is only on
 * a paying one, so a blown guard here costs the player 4 seconds of nothing on every round.
 *
 * 2000 ms is the measured length of the LONGEST animation in the reference symbol spines (see
 * {@link WIN_BEAT_CAP_MS}, which is sized as double that) — so a real authored emerge still wins the
 * race and still sets the pace, and only a cell that can never report pays the cap. Raise it before
 * shortening it: if a game's emerge is being cut off, this number is the bug.
 */
export const INTRO_BEAT_CAP_MS = 2_000;

/**
 * The win beat (`boardWithAnimateSymbols`) — the round's per-win narration.
 *
 * Deliberately MUCH longer than {@link TRANSIT_BEAT_CAP_MS}, because this beat IS the win
 * animation, not a step on the way to one. A win spine is a flourish an artist authored to be
 * watched, so a cap short enough to trim one would silently re-time every shipped game — and this
 * runs in the shared `_runtime/lines` bundle every online game boots. A truncated animation is the
 * worse failure of the two: it is invisible in logs and shows up on every paying spin, where a
 * blown guard is loud, rare, and diagnosable.
 *
 * So it is sized off the ART, not off what feels snappy. Measured across the reference symbol
 * spines (`static/assets/spines/symbols{,2,3}`), the longest animation of any kind is exactly
 * 2000ms — every picture/royal win, every multiplier pay, the wild — and `timeScale` is only ever
 * 1 or 2 (turbo makes them FASTER, never slower). 4000ms is double that: room for a project that
 * authors a longer flourish, and for a frame-starved device that takes wall-clock longer than the
 * animation's own length, while still bounding a cell that can never report.
 *
 * Raise this before shortening it. If a game's win animation is genuinely being cut off, this
 * number is the bug — not the animation.
 */
export const WIN_BEAT_CAP_MS = 4_000;
