/**
 * Whether an arcade play field is being PLAYED — what the render-quality ladder measures on a
 * play-field game (`Game.svelte` `configureRenderQuality`), as it measures a round on a slot. The
 * 2D arcade runtime notes it once a frame: online, while the room is `running`; offline, while a
 * body is on the field (`arcadePerf.ts` reads the same two for its `play` phase). A menu, a lobby, a
 * countdown, a win screen, or a field that stopped ticking (unmounted, a hidden tab) is not play:
 * that is the quiet a level switch waits for. The 3D stage notes nothing: its canvas walks its own
 * ladder (`engine-3d` `createQuality3d`), and the Pixi HUD over it keeps its resolution.
 *
 * It imports nothing, so a runtime built without the arcade family carries a few bytes that are
 * never written.
 */

/** A note older than this is a field that stopped ticking. */
const STALE_MS = 1000;

let playing = false;
let notedAt = Number.NEGATIVE_INFINITY;

/** The arcade runtime's note for this frame. */
export const notePlayFieldFrame = (play: boolean): void => {
	playing = play;
	notedAt = performance.now();
};

/** Whether the field was played in its last frame, and that frame was just now. */
export const playFieldPlaying = (): boolean => playing && performance.now() - notedAt < STALE_MS;
