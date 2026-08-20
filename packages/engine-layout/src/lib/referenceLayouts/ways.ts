import { defaultLayout } from './lines';
import type { LayoutDoc } from '../types';

/**
 * FILLED reference layout for the `ways` kind — the board-frame-bearing doc behind "Import composed
 * reference", not the bare engine skeleton this used to return.
 *
 * It is the SAME generator `lines` uses (`defaultLayout`), because a ways game is the same game up
 * to how it pays: same `_runtime/lines` bundle, same coded components, same 5x3 board (`apps/ways`
 * `SYMBOL_SIZE = 120`, `BOARD_DIMENSIONS = 5x3`, `REEL_PADDING = 0.53`), and the same `reelsFrame`
 * atlas — `apps/ways` and `apps/lines` ship byte-identical frame sets, down to matching source
 * rectangles, so there was never any missing ways art to block this. The one difference the
 * generator makes is dropping the `specialBook` scene: the expanding-symbol reveal is a Book-of
 * mechanic, and a ways game has none.
 *
 * The import endpoint rewrites the bare frame names to the ACTIVE project's atlas region, so the
 * shared `frame_bg.png` / `frame_edge.png` names are placeholders a real ways project replaces.
 */
export function waysReferenceLayout(): LayoutDoc {
	return defaultLayout('ways');
}
