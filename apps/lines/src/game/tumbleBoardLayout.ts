/**
 * The cascade board's PADDING contract, and the one rule that depends on it: where a step's refills
 * go when they are stacked onto the survivors.
 *
 * Plain TS rather than part of `stateTumble.svelte.ts` because this is the piece of the cascade that
 * can be DRIVEN OFFLINE — a rune-bearing module cannot be imported by a Node fixture, and this rule
 * shipped wrong for months precisely because nothing outside a browser could execute it. It is
 * exercised end-to-end by `packages/rgs-translator-eagaming/cascadeBoard.fixture.ts`, against the
 * real mock and the real facade.
 */

/**
 * Rows of off-screen buffer the board carries ABOVE its visible window.
 *
 * The reveal arrives pre-padded — the facade duplicates each reel's edge cells, one row top and one
 * bottom (`engineFacade.padReel`) — so a column is `[pad, …visible…, pad]` and every server row `r`
 * addresses combined index `r + 1`. `TumbleBoard` seats a symbol at `index - PAD_ROWS_ABOVE`, which
 * is what puts index 0 above the window and the last index below it.
 *
 * One home for the fact, so the seat offset and the stacking order below cannot drift apart: they
 * are two readings of it, and the cascade is only correct while they agree.
 */
export const PAD_ROWS_ABOVE = 1;

/**
 * One column of a cascade step: the survivors, with the step's refills spliced in BELOW the top
 * padding row(s) — those symbols sit above the survivors and land on top of them, but still INSIDE
 * the board, not above its buffer.
 *
 * WHY THE SPLICE, rather than `[...adding, ...base]`. A cascade never explodes a padding row (the
 * server only ever indexes visible cells), so both pads survive into `base` — and stacking the
 * refills on top of the whole thing left the column as `[…new…, pad, …survivors…, pad]`, with the
 * TOP pad stranded in the middle. Three things broke at once, all of them silently:
 *
 *   - the settled board handed back to the reels no longer matched the board the server had scored,
 *     so the next step's win frames were drawn over symbols that never paid — and symbols that DID
 *     pay were left unframed — with a stale duplicate of the pre-tumble top row sitting in the grid;
 *   - the slide aimed the refills one row too high, pushing the topmost one out of the window;
 *   - `tumbleBoardSlideDown`'s "visible rows only" guard (`index > 0 && index < length - 1`) marks
 *     the FIRST and LAST entries as padding, so it skipped a real symbol's `land` and played one for
 *     the stranded pad.
 *
 * All three come back into line by putting the pads where the rest of the cascade already assumes
 * they are: at the two ends. A column with NO survivors (the drop-in / column-cascade reveals pass
 * `keepBase: false`) reduces to the adding layer exactly as before.
 */
export const combineTumbleReel = <T>(baseReel: T[], addingReel: T[]): T[] => [
	...baseReel.slice(0, PAD_ROWS_ABOVE),
	...addingReel,
	...baseReel.slice(PAD_ROWS_ABOVE),
];
