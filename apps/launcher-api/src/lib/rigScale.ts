/**
 * Skeleton LOAD scales — canonical copy in `engine-layout` (`rigLoadScale.ts`), because the
 * GAME RUNTIME needs the same numbers to render a natural-sized rig at the size the editor
 * previews it (`<RigProvider loadScaleBase>`). Re-exported here so the launcher's exporters
 * and the editor preview keep importing `$lib/rigScale`.
 */
export { EDITOR_RIG_LOAD_SCALE, SYMBOL_RIG_LOAD_SCALE } from 'engine-layout';
