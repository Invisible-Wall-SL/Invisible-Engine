// Type-only entry: layout schema + pure TS helpers, no Svelte imports here, so
// consumers that only need the contract (e.g. launcher-api) don't drag in
// pixi-svelte. For the runtime `<LayoutScene>` component, use the
// `engine-layout/svelte` subpath.
//
// ONE EXCEPTION, and it is deliberately narrow: `rigBoundContentInstall` (below) makes a runtime
// value import of `pixi-svelte/rigBoundContent`. That subpath is a LEAF — two functions, a frozen
// empty, and type-only imports — not the `pixi-svelte` barrel, so no component, no PixiJS and no
// `webfontloader` is reachable through it. The distinction is load-bearing: importing the barrel
// here crashed `apps/lines`' SSR route analysis (`webfontloader` touches `window` at import time).
// Keep any future cross-package import from this entry to the same standard.
export * from './types';
export * from './symbolNames';
export * from './symbolStates';
// The HUD's standard design box, re-exported so the editor (which has no live
// layout context) can frame `space: 'standard' | 'canvas'` scenes. Canonical
// copy lives in constants-shared so utils-layout (runtime) shares the one source.
export { STANDARD_MAIN_SIZES_MAP } from 'constants-shared/layout';
// Authorable layout profiles (bucket set + selection rules). Canonical copy in
// constants-shared so the runtime + editor share one contract.
export {
	DEFAULT_LAYOUT_PROFILE,
	selectBucket,
	findBucket,
	resolveBucketBox,
	bucketBoxMap,
	normalizeLayoutProfile,
	type LayoutProfile,
	type LayoutBucket,
	type LayoutBucketRule,
	type LayoutBucketBox,
} from 'constants-shared/layoutProfile';
export * from './editorArtKey';
export * from './spineLoadScale';
export * from './builtinRegions';
export * from './builtinSpineMeta';
export * from './coverTransform';
export * from './componentDesignSize';
export * from './blendMode';
export * from './backgroundScenes';
export * from './buyFeatureScene';
export * from './confirmScene';
export * from './genericMountScenes';
export * from './layerOrder';
export * from './resolveTransform';
export * from './sceneDuration';
export * from './textBoxLayout';
export * from './componentParams';
export * from './tapToContinue';
export * from './signalGates';
export * from './completeOnLoaded';
export * from './engineBindings';
export * from './sceneRole';
export * from './collectComponentIds';
export * from './reelGrid';
export * from './buttonConvert';
export * from './normalizeHudScenes';
export * from './buttonStateImage';
export * from './fontCatalog';
export * from './registerFontCatalog';
export * from './soundLibrary';
export * from './bakedSounds';
export * from './bakedFonts';
export * from './hudText';
export * from './registerBoundComponents';
export * from './registerComponents';
export * from './registerEffects';
export * from './rigBeat';
export * from './registerRigFx';
export * from './registerFlipbooks';
export * from './registerRigFlipbooks';
// Joins the two rig-timeline registries above to `<SpineProvider>`, so EVERY rig plays its bound
// effects/clips. Installed by those registries themselves — exported for tests that tear it down.
export * from './rigBoundContentInstall';
export * from './registerComponentValues';
export * from './registerComponentActions';
export * from './registerRepeaterSources';
export * from './registerInstanceValues';
export * from './registerComponentVisibility';
export * from './registerSceneCameraTransform';
export * from './registerFlowComplete';
export * from './registerFlowValueSource';
export * from './registerFlowPress';
export * from './registerComponentSignals';
export * from './registerComponentDefaults';
export * from './registerTextResolver';
export * from './registerInlineImage';
export * from './inlineImage';
export * from './winText';
export * from './uiText';
export * from './builtinComponents';
export * from './boundComponentCatalog';
export * from './componentCatalog';
export * from './validateTemplate';
export * from './seedScenes';
export * from './engineOwnedOnly';
export * from './referenceLayouts';
export * from './templates';
