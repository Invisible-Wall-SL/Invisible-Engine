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
 *  - a spine whose bound `animationName` is not in the skeleton: `setAnimation` throws, the catch
 *    logs the available names, and no track exists to report.
 *
 * A LOOPING spine is NOT one of them, though this list said it was. `SymbolSpineMain` passes
 * `listener` — not `SpineTrack`'s `oncomplete` prop, which is deliberately attached only to a
 * one-shot — and `propsSyncEffect` assigns it straight onto the TrackEntry, where Spine fires
 * `complete` at the end of EVERY loop iteration (`SpineTrack` says so where it explains why its own
 * prop is one-shot-only). So a looping win beat costs ONE cycle of its animation, not the cap. The
 * distinction matters now that a project can set its own budget: "loops ⇒ hangs" would make the
 * common authoring look like the broken one, and `Symbol.svelte` defaults an unauthored cell's
 * `loop` to TRUE, so it is most of them.
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
 * A beat that is a STEP ON THE WAY somewhere: the cascade's `clearReel` and `land`
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
 *
 * IT IS SPENT ONLY ON ART SOMEONE AUTHORED, and that qualifier was not free. An un-authored `intro`
 * inherits `land` — or the resting `static` art — and neither reliably reports completion, so a
 * board with no intro bound paid this cap IN FULL on every single arrival: a cascade step measured
 * 2650 virtual ms against the shipped slide's 1500, reported from a live game as "a long delay".
 * A cap the common case always pays is not a guard, it is the pace. `TumbleBoard`'s appear handler
 * therefore asks `hasAuthoredSymbolState` first and gives everything else
 * {@link TRANSIT_BEAT_CAP_MS}, which is what the arrival it fell back to would have cost anyway.
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

/**
 * The FLOOR under the win beat — the other end of {@link WIN_BEAT_CAP_MS}, and for the opposite
 * failure.
 *
 * The cap stops a beat that can never finish. This stops one that finishes INSTANTLY, which turned
 * out to be the far more common way a win goes unseen. A `sprite` cell is one frozen frame, so
 * `SymbolSprite` reports `oncomplete` from an `$effect` the moment its art changes — the beat
 * resolves in the same tick, and everything scoped to it is torn down with it: the lit symbol, and
 * the win's stamped AMOUNT TEXT.
 *
 * Measured on the live `test6` at full frame rate, one cascading spin:
 *
 *     winInfo L2 x3  ->  2 ms     (sprite win art)   no amount text
 *     winInfo H4 x3  ->  961 ms   (flipbook)         "€0.05" drawn at board centre
 *     winInfo H3 x5  ->  2 ms     (sprite win art)   no amount text
 *
 * The owner read that as "the win amount text doesn't show after a tumble" — but the tumble was
 * incidental. It is whichever symbol paid: two of that project's ten symbols had animated win art,
 * so eight of ten wins flashed for one frame. A sprite bound to `win` is a legitimate authoring
 * choice ("show this art while the win is celebrated"); it just carries no duration of its own, so
 * the engine has to supply one.
 *
 * The same reasoning already exists one branch away: a stacked-covered cell mounts no `<Symbol>` and
 * so holds `winHoldMs` (`STACKED_WIN_HOLD_MS`, 650ms) instead of awaiting a completion it can never
 * get. This is that rule applied to the ordinary case, at the same length for the same reason — the
 * shortest beat a player can actually read.
 *
 * A FLOOR, not a delay: it runs CONCURRENTLY with the animation (`Promise.all`), so authored art
 * longer than this still sets the pace and is untouched. Only a beat that would have been shorter
 * than a readable moment is stretched to one.
 */
export const WIN_BEAT_MIN_MS = 650;

/**
 * THE AUTHORED WIN-BEAT BUDGET (Invisible Symbols → "Cap each win at") — the one place a project
 * gets to say how long a paying cell may hold the round, resolved into the three numbers
 * `Board.svelte` actually races against.
 *
 * WHY THIS IS A SHAPER AND {@link WIN_BEAT_CAP_MS} IS NOT. The header above is explicit that a cap
 * a real animation can hit "stops being a guard and starts being the timing", so the guard stays
 * sized off the art and un-authorable. But the pace it protects is not free either: measured on the
 * live `test6`, every symbol's `win` is a 2.00s spine (`Pull`) and its `explosion` a 0.50s one
 * (`Take`), and that project cascades — a three-tumble round narrates three wins, so ~7.5s of the
 * round is symbol beats before the reels may turn again. Nothing was broken there; the art is
 * simply longer than the game wants to spend. Shortening the animation is the other fix, but it is
 * an art round-trip per symbol, and the same art may be right for a non-cascading title.
 *
 * So `maxMs` TRUNCATES: set it and no single win or explosion beat outlives it, cutting a longer
 * animation short at the `postWinStatic` revert that already ends the beat on both exits of the
 * race. Absent ⇒ every number below is the constant it always was, so an unauthored project is
 * byte-identical.
 *
 * The floor and the unauthored fallback are CLAMPED to the budget rather than left standing:
 *  - `minMs` — {@link WIN_BEAT_MIN_MS} is the readable minimum, but it is a `Promise.all` partner,
 *    so an unclamped 650 would quietly ignore a budget set below it. An author who types 300 means
 *    300, and gets it.
 *  - `unauthoredMs` — a cell with nothing bound for the state can never report `oncomplete` at all
 *    (see the header), so it must never buy the runaway guard. It costs the short transit beat
 *    instead, exactly as `TumbleBoard`'s emerge arrival does via `hasAuthoredSymbolState`. Clamped
 *    too, so it can never be the LONGEST thing a budgeted spin waits for.
 */
export const resolveWinBeatBudget = (
	maxMs: number | undefined,
): { capMs: number; minMs: number; unauthoredMs: number } => {
	const capMs = maxMs ?? WIN_BEAT_CAP_MS;
	return {
		capMs,
		minMs: Math.min(WIN_BEAT_MIN_MS, capMs),
		unauthoredMs: Math.min(TRANSIT_BEAT_CAP_MS, capMs),
	};
};
