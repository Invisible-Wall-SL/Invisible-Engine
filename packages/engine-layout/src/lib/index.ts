// Type-only entry: layout schema + pure TS helpers, no Svelte imports here, so
// consumers that only need the contract (e.g. launcher-api) don't drag in
// pixi-svelte. For the runtime `<LayoutScene>` component, use the
// `engine-layout/svelte` subpath.
export * from './types';
// The HUD's standard design box, re-exported so the editor (which has no live
// layout context) can frame `space: 'standard' | 'canvas'` scenes. Canonical
// copy lives in constants-shared so utils-layout (runtime) shares the one source.
export { STANDARD_MAIN_SIZES_MAP } from 'constants-shared/layout';
export * from './editorArtKey';
export * from './coverTransform';
export * from './componentDesignSize';
export * from './backgroundScenes';
export * from './genericMountScenes';
export * from './layerOrder';
export * from './resolveTransform';
export * from './componentParams';
export * from './tapToContinue';
export * from './completeOnLoaded';
export * from './engineBindings';
export * from './sceneRole';
export * from './collectComponentIds';
export * from './reelGrid';
export * from './buttonConvert';
export * from './buttonStateImage';
export * from './fontCatalog';
export * from './registerFontCatalog';
export * from './bakedFonts';
export * from './hudText';
export * from './registerBoundComponents';
export * from './registerComponents';
export * from './registerEffects';
export * from './registerComponentValues';
export * from './registerComponentActions';
export * from './registerComponentVisibility';
export * from './registerFlowComplete';
export * from './registerFlowValueSource';
export * from './registerFlowPress';
export * from './registerComponentSignals';
export * from './registerComponentDefaults';
export * from './registerTextResolver';
export * from './builtinComponents';
export * from './boundComponentCatalog';
export * from './componentCatalog';
export * from './validateTemplate';
export * from './seedScenes';
export * from './engineOwnedOnly';
export * from './referenceLayouts';
export * from './templates';
