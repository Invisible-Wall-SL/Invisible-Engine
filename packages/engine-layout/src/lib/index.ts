// Type-only entry: layout schema + pure TS helpers, no Svelte imports here, so
// consumers that only need the contract (e.g. launcher-api) don't drag in
// pixi-svelte. For the runtime `<LayoutScene>` component, use the
// `engine-layout/svelte` subpath.
export * from './types';
// The HUD's standard design box, re-exported so the editor (which has no live
// layout context) can frame `space: 'standard' | 'canvas'` scenes. Canonical
// copy lives in constants-shared so utils-layout (runtime) shares the one source.
export { STANDARD_MAIN_SIZES_MAP } from 'constants-shared/layout';
export * from './resolveTransform';
export * from './fontCatalog';
export * from './hudText';
export * from './registerBoundComponents';
export * from './boundComponentCatalog';
export * from './validateTemplate';
export * from './seedScenes';
export * from './referenceLayouts';
export * from './templates';
