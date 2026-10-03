/**
 * Offline fixture for the game's report of a Flow screen the layout no longer has. Run with tsx:
 *   pnpm --filter launcher-api exec tsx ../lines/src/game/flowV2MissingScreens.fixture.ts
 *
 * Live, a driven flow ran `load → show background → hide splash → show loading`, the layout had lost
 * `loading`, and the game sat on its background forever with an empty console. FOUR claims, all
 * through the real mount model:
 *
 *  1. PARITY. A flow and layout that agree (or an unknown, empty layout) get the SAME mount object
 *     back and log nothing.
 *  2. BOOT. A mismatch logs ONE line listing every missing screen, before anything is shown.
 *  3. ONCE PER SCREEN. The first show or hide of a missing screen logs the actionable line; a repeat,
 *     the other verb, or a screen the layout has logs nothing more.
 *  4. LOGGING ONLY. The wrapped mount shows, hides, orders and notifies exactly like the raw one.
 */

import {
	createContainerMountModel,
	type ContainerMountModel,
	type ContainerRef,
	type MountedContainer,
} from 'engine-flow-v2';

import { withMissingScreenReport } from './flowV2MissingScreens.ts';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

const CONTAINERS: ContainerRef[] = [
	{ id: 'background', sceneId: 'background', z: 0 },
	{ id: 'splash', sceneId: 's_q9iw9aqf', z: 5 },
	{ id: 'loading', sceneId: 'loading', z: 10 },
];
const ALL = ['background', 's_q9iw9aqf', 'loading'];

/** The incident's start-up chain, then a second show of the same screen. */
const play = (mount: ContainerMountModel): void => {
	mount.show('background');
	mount.hide('splash');
	mount.show('loading');
	mount.show('loading');
	mount.hide('loading');
	mount.show('loading');
};

const build = (sceneIds: string[]) => {
	const logs: string[] = [];
	const changes: MountedContainer[][] = [];
	const raw = createContainerMountModel(CONTAINERS, (ordered) => changes.push(ordered));
	const mount = withMissingScreenReport(raw, CONTAINERS, sceneIds, (m) => logs.push(m));
	return { raw, mount, logs, changes };
};

console.log('1. parity');
for (const [label, scenes] of [
	['an agreeing layout', ALL],
	['an unknown (empty) layout', []],
] as const) {
	const { raw, mount, logs } = build([...scenes]);
	check(`${label}: the same mount object comes back`, mount === raw, true);
	play(mount);
	check(`${label}: nothing is logged`, logs, []);
}

console.log('2. boot');
const lost = build(['background']);
check('one line before anything is shown', lost.logs, [
	`[flow-v2] this game's Flow names 2 screen(s) that are not in its layout (Scene Editor): "splash" (scene "s_q9iw9aqf"), "loading". Nothing will draw for them, and any step waiting on one will never continue. Restore them in /editor (History…) or remove them from the Flow.`,
]);

console.log('3. once per screen');
play(lost.mount);
check('the first hide of splash and the first show of loading each log once', lost.logs.slice(1), [
	`[flow-v2] the Flow hides screen "splash" (scene "s_q9iw9aqf"), which is not in this game's layout (Scene Editor). Nothing will draw for it, and any step waiting on it will never continue. Restore the screen in /editor (History…) or remove it from the Flow.`,
	`[flow-v2] the Flow shows screen "loading", which is not in this game's layout (Scene Editor). Nothing will draw for it, and any step waiting on it will never continue. Restore the screen in /editor (History…) or remove it from the Flow.`,
]);
lost.mount.show('nope');
lost.mount.hide('splash');
check('an unknown id, a repeat and the other verb add nothing', lost.logs.length, 3);

console.log('4. logging only');
const reference = build(ALL);
play(reference.mount);
const wrapped = build(['background']);
play(wrapped.mount);
check('the same shown set', wrapped.mount.ordered(), reference.mount.ordered());
check('the same change notifications', wrapped.changes, reference.changes);
check('isShown passes through', wrapped.mount.isShown('loading'), true);
void wrapped.mount.awaitComplete('loading');
check('a hold still registers', wrapped.mount.heldContainers(), ['loading']);
check('and a tap still releases it', wrapped.mount.complete('loading'), true);

console.log(failures === 0 ? '\nAll assertions passed.' : `\n${failures} assertion(s) FAILED.`);
if (failures > 0) throw new Error('missing screen report fixture failed');
