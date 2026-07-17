// export nothing
// import { ... } from 'constants-shared/...';
//
// The subpath imports above are spelled out in package.json's `exports` map (`./*` → `./*.ts`, plus
// `./particleConfig` for the one directory). Without it only bundlers that guess extensions could
// resolve them — plain Node/tsx could not, which silently made every `constants-shared` VALUE
// unimportable from a flow-spike harness (the spikes worked around it by importing only TYPES).
// `type: module` matters for the same reason: without it Node treats these .ts files as CommonJS
// and named ESM imports of them fail. Keep both if you add a file here.
