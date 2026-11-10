/**
 * Offline fixture for the DEFAULT BOOT — a game no Flow v2 graph drives boots on its loading screen
 * and swaps it for the base game, once.
 *
 *   pnpm --filter launcher-api exec tsx ../lines/src/game/bootScreens.fixture.ts
 *
 * `bootScreens.ts` replaced the Flow v1 interpreter, which every such game ran over a synthesized
 * `loading → basegame` doc. Claims:
 *
 *  1. THE REFERENCE LAYOUTS BOOT ON LOADING. `lines` and `bookOf` build boot screens whose only
 *     active screen is `loading`, with both scenes resolved for the mounts.
 *  2. COMPLETE SWAPS TO THE BASE GAME, ONCE. The first `complete()` (a tap or `completeOnLoaded`)
 *     leaves `[basegame]` and notifies once; later ones change nothing and notify nothing.
 *  3. ROLES, NOT IDS. A role-tagged custom-id pair is found; a scene sharing the legacy id but not
 *     the role is not a boot screen.
 *  4. NO SCENE, NO BOOT SCREENS. A doc missing either scene builds none, so the game mounts it all
 *     through its coded path.
 */

import { bookofReferenceLayout, defaultLayout, type LayoutDoc } from 'engine-layout';

import { createBootScreens } from './bootScreens.ts';

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

const doc = (scenes: { id: string; role?: string }[]): LayoutDoc =>
	({ version: 1, scenes: scenes.map((s) => ({ ...s, nodes: [] })) }) as unknown as LayoutDoc;

console.log('1. the reference layouts boot on loading');
for (const [name, layout] of [
	['lines', defaultLayout('lines')],
	['bookOf', bookofReferenceLayout()],
] as const) {
	const boot = createBootScreens(layout, () => {});
	check(`${name}: built`, boot !== undefined, true);
	check(`${name}: only loading is up`, boot?.activeScreenIds, ['loading']);
	check(`${name}: loading + basegame resolve`, [boot?.scene('loading')?.id, boot?.scene('basegame')?.id], ['loading', 'basegame']); // prettier-ignore
	check(`${name}: no other screen resolves`, [boot?.scene('hudBar'), boot?.scene(undefined)], [undefined, undefined]); // prettier-ignore
}

console.log('2. complete swaps to the base game, once');
{
	const notified: (readonly string[])[] = [];
	const boot = createBootScreens(defaultLayout('lines'), (ids) => notified.push([...ids]));
	check('the first complete swaps', boot?.complete(), true);
	check('…to the base game alone', boot?.activeScreenIds, ['basegame']);
	check('…and says so once', notified, [['basegame']]);
	check('a second complete changes nothing', [boot?.complete(), boot?.complete()], [false, false]);
	check('…and notifies nothing', notified.length, 1);
	check('the base game stays up', boot?.activeScreenIds, ['basegame']);
}

console.log('3. roles, not ids');
{
	const boot = createBootScreens(
		doc([
			{ id: 's_splash', role: 'loading' },
			{ id: 's_main', role: 'basegame' },
			{ id: 'basegame' },
		]),
		() => {},
	);
	check('the role-tagged pair are the boot screens', [...(boot?.screenIds ?? [])], ['s_splash', 's_main']); // prettier-ignore
	check('a legacy-id scene without the role is not one', boot?.scene('basegame'), undefined);
	boot?.complete();
	check('complete swaps to the role-tagged base', boot?.activeScreenIds, ['s_main']);
}

console.log('4. no scene, no boot screens');
check(
	'no loading scene',
	createBootScreens(doc([{ id: 'basegame' }]), () => {}),
	undefined,
);
check(
	'no basegame scene',
	createBootScreens(doc([{ id: 'loading' }]), () => {}),
	undefined,
);
check(
	'no scenes',
	createBootScreens(doc([]), () => {}),
	undefined,
);

console.log(failures ? `\n${failures} boot-screen check(s) failed.` : '\nboot screens: ok');
if (failures > 0) throw new Error('boot screens fixture failed');
