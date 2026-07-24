/**
 * Skeleton LOAD scales — canonical copy in `engine-layout` (`spineLoadScale.ts`), because the
 * GAME RUNTIME needs the same numbers to render a natural-sized rig at the size the editor
 * previews it (`<SpineProvider loadScaleBase>`). Re-exported here so the launcher's exporters
 * and the editor preview keep importing `$lib/spineScale`.
 */
export { EDITOR_SPINE_LOAD_SCALE, SYMBOL_SPINE_LOAD_SCALE } from 'engine-layout';
