/**
 * The `mode` scene role survives a save (`docs/design/hold-and-win.md` §4.5).
 *
 *   pnpm --filter launcher-api check:scene-mode-role
 *
 * `normalizeScene` rebuilds every scene from a whitelist, so a field it does not copy is silently
 * dropped on save — the bug that once ate `role` itself. A mode screen carries two fields: the role
 * `mode` and the `modeId` it belongs to. Both must round-trip, and `modeId` must not survive on any
 * other role, where it would name a mode the screen no longer belongs to.
 */
import { normalizeDoc } from '../src/lib/server/editorStorage';
import { SCENE_ROLES, modeScenes } from 'engine-layout';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	console.log(`${ok ? '  ok ' : 'FAIL '} ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
	if (!ok) failures += 1;
};

const doc = normalizeDoc({
	version: 1,
	scenes: [
		{ id: 'fsBoard', name: 'Free spins board', nodes: [], role: 'mode', modeId: ' freeSpins ' },
		{ id: 'hwBoard', name: 'Respin board', nodes: [], role: 'mode', modeId: 'holdAndWin' },
		{ id: 'stale', name: 'Base', nodes: [], role: 'basegame', modeId: 'freeSpins' },
		{ id: 'unnamed', name: 'Mode, no id', nodes: [], role: 'mode', modeId: '  ' },
	],
});
const byId = (id: string) => doc.scenes.find((scene) => scene.id === id);

check('mode is a listed role', SCENE_ROLES.includes('mode'));
check('a mode screen keeps its role', byId('fsBoard')?.role === 'mode');
check(
	'...and its trimmed mode id',
	byId('fsBoard')?.modeId === 'freeSpins',
	JSON.stringify(byId('fsBoard')),
);
check('a mode id on another role is dropped', byId('stale')?.modeId === undefined);
check(
	'a blank mode id is not stored',
	byId('unnamed') !== undefined && !('modeId' in byId('unnamed')!),
);
check(
	'modeScenes finds a mode screen by id, in doc order',
	JSON.stringify(modeScenes(doc.scenes, 'freeSpins').map((s) => s.id)) === '["fsBoard"]' &&
		JSON.stringify(modeScenes(doc.scenes, 'holdAndWin').map((s) => s.id)) === '["hwBoard"]',
);
const again = normalizeDoc(JSON.parse(JSON.stringify(doc)));
check('idempotent', JSON.stringify(again.scenes) === JSON.stringify(doc.scenes));

console.log(failures === 0 ? '\nAll scene-mode-role assertions passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
