/**
 * The `lines` engine-truth layout now lives in `engine-layout` (so the launcher
 * editor can load it too — see `packages/engine-layout/src/lib/referenceLayouts/
 * lines.ts`). Re-exported here so `editor-scenes.ts`'s import path is unchanged.
 */
export { defaultLayout } from 'engine-layout';
