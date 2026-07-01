/**
 * Invisible Flow — scene-ROLE identity harness (flow-driven-game; screen-identity decoupling).
 *
 *   pnpm --filter flow-spike run scenerole
 *
 * Proves the id-independent screen identity the game boot uses (engine-layout `sceneByRole` /
 * `loadingSceneId` / `basegameSceneId`), so scene ids stay free-form / renameable and a renamed
 * loading/base scene is still recognized — WITHOUT a FlowDoc (no shipped game loads one yet).
 *
 *  A. Role-tagged CUSTOM-id scene resolves by role (rename-independence — the owner's bug).
 *  B. No-role doc falls back to the legacy `id === role` match (§7 parity — byte-identical today).
 *  C. `loadingSceneId`/`basegameSceneId` return the custom id when role-tagged (so the game
 *     reserves it and never double-mounts it as an overlay), the legacy id otherwise.
 *  D. Role WINS over a same-named legacy id (a role-tagged custom-id scene is chosen even when a
 *     stray `id === 'loading'` scene also exists).
 *  E. Absent both ⇒ the fallback id string (`'loading'`/`'basegame'`), never undefined.
 */

// Import the pure module directly (not the `engine-layout` barrel, which pulls Svelte +
// constants-shared deps tsx can't resolve at runtime). `sceneRole.ts` only type-imports, so
// this stays a clean headless unit test of the real shipped resolver.
import {
	sceneByRole,
	loadingSceneId,
	basegameSceneId,
} from '../../packages/engine-layout/src/lib/sceneRole';
import type { Scene } from '../../packages/engine-layout/src/lib/types';

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) {
		console.log(`  PASS  ${label}`);
	} else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

const scene = (id: string, extra: Partial<Scene> = {}): Scene => ({
	id,
	name: id,
	nodes: [],
	...extra,
});

console.log('Invisible Flow — scene-role identity harness\n');

// --- A. Role-tagged custom-id scene resolves by role -------------------------
console.log('A. Role-tagged custom-id scene resolves by role:');
{
	const scenes = [
		scene('s_a1b2', { role: 'loading', space: 'canvas' }),
		scene('s_c3d4', { role: 'basegame' }),
		scene('bg', { space: 'background' }),
	];
	assert('loading role → custom id scene', sceneByRole(scenes, 'loading')?.id === 's_a1b2');
	assert('basegame role → custom id scene', sceneByRole(scenes, 'basegame')?.id === 's_c3d4');
	assert('loadingSceneId is the custom id', loadingSceneId(scenes) === 's_a1b2');
	assert('basegameSceneId is the custom id', basegameSceneId(scenes) === 's_c3d4');
}

// --- B. No-role doc falls back to the legacy id (parity) ---------------------
console.log('\nB. No-role doc falls back to the legacy id (byte-identical to today):');
{
	const scenes = [scene('loading', { space: 'canvas' }), scene('basegame')];
	assert('loading falls back to id match', sceneByRole(scenes, 'loading')?.id === 'loading');
	assert('basegame falls back to id match', sceneByRole(scenes, 'basegame')?.id === 'basegame');
	assert('loadingSceneId === legacy id', loadingSceneId(scenes) === 'loading');
	assert('basegameSceneId === legacy id', basegameSceneId(scenes) === 'basegame');
}

// --- D. Role WINS over a same-named legacy id -------------------------------
console.log('\nC. Role wins over a stray legacy id:');
{
	const scenes = [
		scene('loading', { space: 'canvas' }), // a stray legacy-named scene…
		scene('s_new', { role: 'loading', space: 'canvas' }), // …but the ROLE is on the custom id
	];
	assert('role beats the legacy id match', sceneByRole(scenes, 'loading')?.id === 's_new');
	assert('loadingSceneId prefers the role scene', loadingSceneId(scenes) === 's_new');
}

// --- E. Absent both ⇒ fallback string, never undefined ----------------------
console.log('\nD. Absent role AND legacy id ⇒ the fallback id string:');
{
	const scenes = [scene('s_only', { space: 'canvas' })];
	assert('sceneByRole undefined when nothing matches', sceneByRole(scenes, 'loading') === undefined);
	assert('loadingSceneId falls back to "loading"', loadingSceneId(scenes) === 'loading');
	assert('basegameSceneId falls back to "basegame"', basegameSceneId(scenes) === 'basegame');
}

console.log(`\n${failed ? 'SCENE-ROLE HARNESS: FAILED' : 'SCENE-ROLE HARNESS: PASSED'}`);
process.exit(failed ? 1 : 0);
