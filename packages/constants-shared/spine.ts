/**
 * The natural size assumed for a spine that has no measurable one: no `skeleton.width/height` in the
 * export AND nothing for `getBounds` to see in any pose.
 *
 * That is not a hypothetical — it is exactly a CARRIER rig, whose only content is timeline-event FX
 * and Flipbook bindings. Those are events, not attachments, and the slots hosting them are empty, so
 * every measurement path returns 0 and the rig ships with no size at all.
 *
 * ONE number, because the two surfaces that hit this fallback used to disagree: the editor's
 * `measureSpineBounds` fitted a 100×100 box while the runtime's `spineSizeScale` gave up and left
 * the requested width/height unapplied at scale 1. The same rig then rendered at two different sizes
 * in /symbols and in the game, which read as a sizing bug in one of them rather than as the missing
 * bounds it actually was.
 *
 * Deliberately arbitrary and a LAST resort — the real fix is for the rig to carry bounds (the Rigger
 * writes them on save, and lets the author draw a frame when nothing is measurable). This only
 * guarantees that a rig which slips through unsized is wrong the SAME way everywhere, so the
 * disagreement can never hide the cause again.
 */
export const SPINE_FALLBACK_NATURAL_SIZE = 100;
