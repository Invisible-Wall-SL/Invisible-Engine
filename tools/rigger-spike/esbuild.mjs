// Where the Rigger spikes get esbuild: from `packages/engine-layout`, which declares it.
//
//   import { ESBUILD } from './esbuild.mjs';
//   const esbuild = await import(ESBUILD);
import { pathToFileURL } from 'node:url';
import { resolveFromPackage } from './resolve.mjs';

export const ESBUILD = pathToFileURL(resolveFromPackage('esbuild', 'engine-layout').entry).href;
