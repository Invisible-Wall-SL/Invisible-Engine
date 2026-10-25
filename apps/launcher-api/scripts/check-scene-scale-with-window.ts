/**
 * The "Scale with the window" tick (`Scene.scaleWithWindow`) survives a save on a canvas screen.
 *
 *   pnpm --filter launcher-api check:scene-scale-with-window
 *
 * `normalizeScene` rebuilds every scene from a whitelist, so a field it does not copy is silently
 * dropped on save. The tick means something only on a `canvas` screen, so it must not survive on
 * another space, where it would come back to life if the screen were switched to canvas later.
 * What it does in game is `pnpm check:canvas-window-scale`.
 */
import { normalizeDoc } from '../src/lib/server/editorStorage';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	console.log(`${ok ? '  ok ' : 'FAIL '} ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
	if (!ok) failures += 1;
};

const doc = normalizeDoc({
	version: 1,
	scenes: [
		{ id: 'intro', name: 'Feature intro', nodes: [], space: 'canvas', scaleWithWindow: true },
		{ id: 'corners', name: 'HUD corners', nodes: [], space: 'canvas' },
		{ id: 'off', name: 'Off', nodes: [], space: 'canvas', scaleWithWindow: false },
		{ id: 'game', name: 'Base game', nodes: [], scaleWithWindow: true },
		{ id: 'hud', name: 'HUD', nodes: [], space: 'standard', scaleWithWindow: true },
	],
});
const byId = (id: string) => doc.scenes.find((scene) => scene.id === id);

check(
	'a ticked canvas screen keeps the tick',
	byId('intro')?.scaleWithWindow === true,
	JSON.stringify(byId('intro')),
);
check('an unticked canvas screen stores no tick', !('scaleWithWindow' in byId('corners')!));
check('a false tick is not stored', !('scaleWithWindow' in byId('off')!));
check('a tick on a game screen is dropped', !('scaleWithWindow' in byId('game')!));
check('a tick on a standard screen is dropped', !('scaleWithWindow' in byId('hud')!));
const again = normalizeDoc(JSON.parse(JSON.stringify(doc)));
check('idempotent', JSON.stringify(again.scenes) === JSON.stringify(doc.scenes));

console.log(
	failures === 0 ? '\nAll scene-scale-with-window assertions passed.' : `\n${failures} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
