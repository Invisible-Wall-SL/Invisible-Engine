// Copy MediaPipe's vision WASM runtime from the pinned `@mediapipe/tasks-vision` package into
// `static/rigger/vendor/mediapipe/`, where the Rigger's motion import (`vendor/rigger-motion.js`,
// rig templates T5 / T7b) loads it same-origin. Run before `build`/`dev` (see package.json).
//
// Copied, not committed: the runtime is 14 MB and the lockfile already pins it, so git carries the
// version and not the bytes. Only the SIMD build is served (every browser the Rigger supports has
// WASM SIMD); `rigger-motion.js` names these two files directly instead of letting MediaPipe pick.
// The two `.task` models next to them ARE committed — they are not on npm.
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(join(appRoot, 'package.json'));
const dest = join(appRoot, 'static', 'rigger', 'vendor', 'mediapipe');

await mkdir(dest, { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm'])
	await copyFile(req.resolve(`@mediapipe/tasks-vision/${f}`), join(dest, f));
console.log(`copy-mediapipe-wasm: ${dest}`);
