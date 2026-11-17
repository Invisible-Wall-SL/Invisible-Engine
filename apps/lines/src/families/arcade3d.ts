/**
 * The arcade seam of the `arcade3d` runtime (`docs/design/3d-games.md`): the arcade family as it is,
 * with its play field drawn in 3D. `config-vite` `familySeams()` resolves `families/arcade` to this
 * module only in a build with `PUBLIC_IE_3D=1`, so no other runtime compiles it or anything it
 * imports.
 */
export * from './arcade';
export { default as ArcadeStage } from '../components/ArcadeStage3D.svelte';
