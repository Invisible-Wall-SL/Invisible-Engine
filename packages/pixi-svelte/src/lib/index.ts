export * from './components/index';
export * from './utils.svelte';
export * from './types';
export * from './createApp.svelte';
export * from './context.svelte';
export * from './sanitizeBitmapText';
// Tier-C particle pooling — the canonical runtime behavior + backing the `/fx` preview reuses
// (the SAME pool `<EffectLayer>` mounts), so the authoring stage and the game render identically.
export * from './rigParticleBehavior';
export * from './rigBacking';
export * from './rigLoadScale';
// The seam that lets ANY rig play the content bound on its own timeline: `engine-layout` installs
// the lookup, `<RigProvider>` mounts whatever it returns. See `rigBoundContent.ts`.
export * from './rigBoundContent';
// Rig TEXT is localized ART: one attachment per locale in one slot, swapped at mount.
export * from './rigLocale';
// Full-screen camera effects (shake / flash / zoom punch / chromatic wobble) — they drive the
// `Application.stage`, the one transform above every layer band, so they live with the app itself.
export * from './cameraEffects';
// Named anchors: where a mounted container is on screen, for code aiming at it (flights).
export * from './anchors';
// Element FX: shake / bend / light / break ONE container (a node, a screen, the reels).
export * from './elementFx';
// The level the renderer starts at (`?render=` pins it) and the measured steps down from it.
export * from './renderTier';
export * from './renderQuality';
// Whether every texture stays on the GPU: the one thing a device's reported memory decides.
export * from './textureResidency';
// Phone or desktop (which art format), and the screen's real pixel ratio: decided once at boot.
export * from './deviceClass';
// Back buffer, MSAA and an opaque canvas, decided before the context exists; the test switches.
export * from './renderOptions';
// `?perf=1`'s per-frame GL counts, what the particles and rigs did in each frame, and what it built.
export * from './glCounters';
export * from './perfProbe';
export * from './churnProbe';
// The loader's last step: upload every texture and compile every program a game will draw with.
export * from './gpuWarmup';
// Press-and-hold on a pointer-up press surface (the spin button's hold-to-spin).
export * from './pressHold';
// The rotation `<RigBoneAttach followRotation>` gives a bone-bound child (and the `/fx` stage copies).
export * from './rigBoneRotation';
// One particle time scale (turbo): every `<ParticleEmitter>` steps by it, emission timers divide by it.
export * from './particleClock';
// One particle quality factor: every `<ParticleEmitter>` scales its cap and spawn chance by it.
export * from './particleBudget';
// The missing-asset diagnostic `Sprite` logs, for a texture-keyed view outside this package.
export { hasAssetKey, warnMissingAsset } from './missingAsset';
