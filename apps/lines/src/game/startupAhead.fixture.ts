/**
 * Offline fixture for THE START-UP SCREENS, MOUNTED AHEAD — the screens the start screen's tap
 * shows are mounted under the loading bar, dormant, and start in place at their show.
 *
 *   pnpm --filter launcher-api exec tsx ../lines/src/game/startupAhead.fixture.ts
 *
 * Claims:
 *
 *  1. WHICH SCREENS. Only the containers a start-up chain shows, less the excluded ones and those
 *     a timeline would remount at their show; stacked by `z`, a tie in the flow's order.
 *  2. A MOUNT AHEAD DRAWS NOTHING. Inside it `Math.random` answers a constant; after it, the
 *     seeded sequence goes on exactly where it was, also when the mount throws.
 *  3. MOUNTED AHEAD, KEPT AT THE SHOW. A container ahead is mounted before its show, by `z` among
 *     the shown ones, and keeps that mount when it shows — listed once.
 *  4. HIDDEN, UNMOUNTED; NEVER AHEAD AGAIN. A container hidden after its show is unmounted, and a
 *     later show mounts it afresh, not as the mount ahead; one dropped from the ahead list before
 *     it shows is unmounted too.
 *  5. NOTHING AHEAD, NOTHING CHANGES. With no container ahead, the mounts are the shown list as is.
 */

import { createAheadMounts } from 'engine-layout';

import { mountWithoutRandomDraws, startupAheadContainers } from './startupAhead.ts';

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

type C = { id: string; sceneId: string; z: number };
const c = (id: string, z: number): C => ({ id, sceneId: `${id}Scene`, z });
const ids = (list: readonly { id: string }[]): string[] => list.map((x) => x.id);

console.log('1. which screens');
{
	const containers = [
		{ ...c('basegame', 0), extra: 1 },
		c('hudBar', 30),
		c('pots', 10),
		c('jackpotBar', 20),
		c('loading', 90),
		c('intro', 50),
		c('bonusBoard', 40),
		c('hudCorners', 30),
	];
	const ahead = startupAheadContainers({
		startup: ['basegame', 'pots', 'jackpotBar', 'hudBar', 'hudCorners', 'intro', 'loading', 'gone'],
		containers,
		exclude: new Set(['basegame', 'loading']),
		startsInPlace: (sceneId) => sceneId !== 'introScene',
	});
	check('start-up shown, not excluded, started in place', ids(ahead), [
		'pots',
		'jackpotBar',
		'hudBar',
		'hudCorners',
	]);
	check('each as the flow lists it', ahead[0] === containers[2], true);
	check(
		'nothing at start-up, nothing ahead',
		startupAheadContainers({
			startup: [],
			containers,
			exclude: new Set(),
			startsInPlace: () => true,
		}),
		[],
	);
}

console.log('2. a mount ahead draws nothing');
{
	const seeded = (seed: number) => () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};
	const random = Math.random;
	try {
		Math.random = seeded(7);
		const before = [Math.random(), Math.random()];
		let inside: number[] = [];
		mountWithoutRandomDraws(() => {
			inside = [Math.random(), Math.random(), Math.random()];
		});
		const after = [Math.random(), Math.random()];
		const fresh = seeded(7);
		check('inside, a constant', inside, [0, 0, 0]);
		check(
			'after, the sequence goes on where it was',
			[...before, ...after],
			[fresh(), fresh(), fresh(), fresh()],
		);

		Math.random = seeded(11);
		const own = Math.random;
		let thrown: unknown;
		try {
			mountWithoutRandomDraws(() => {
				Math.random();
				throw new Error('mount failed');
			});
		} catch (error) {
			thrown = error instanceof Error ? error.message : error;
		}
		check('a throwing mount throws on', thrown, 'mount failed');
		check('…and gives the sequence back', Math.random === own, true);
		check('…undrawn', Math.random(), seeded(11)());
	} finally {
		Math.random = random;
	}
}

console.log('3. mounted ahead, kept at the show');
{
	const mounts = createAheadMounts();
	const ahead = [c('pots', 10), c('jackpotBar', 20), c('hudBar', 30)];
	const loading = c('loading', 90);
	check(
		'before the tap: the screens ahead, under the start screen',
		ids(mounts.plan([loading], ahead)),
		['pots', 'jackpotBar', 'hudBar', 'loading'],
	);
	check('…each one mounted ahead', ids(ahead).map(mounts.mountedAhead), [true, true, true]);
	check('…the start screen not', mounts.mountedAhead('loading'), false);

	const shown = [c('basegame', 0), c('pots', 10)];
	check('a show lists the screen once', ids(mounts.plan(shown, ahead)), [
		'basegame',
		'pots',
		'jackpotBar',
		'hudBar',
	]);
	check('…and it keeps its mount ahead', mounts.mountedAhead('pots'), true);
	check('…as do those still to show', [mounts.mountedAhead('jackpotBar'), mounts.mountedAhead('hudBar')], [true, true]); // prettier-ignore
	check('the base game, never ahead, is not', mounts.mountedAhead('basegame'), false);

	const tie = createAheadMounts();
	check('a tie in z: the shown one first', ids(tie.plan([c('a', 5)], [c('b', 5), c('c', 5)])), [
		'a',
		'b',
		'c',
	]);
}

console.log('4. hidden, unmounted; never ahead again');
{
	const mounts = createAheadMounts();
	const ahead = [c('pots', 10), c('hudBar', 30)];
	mounts.plan([c('loading', 90)], ahead);
	mounts.plan([c('pots', 10)], ahead);
	check('hidden after its show: unmounted', ids(mounts.plan([], ahead)), ['hudBar']);
	check('…and no longer the mount ahead', mounts.mountedAhead('pots'), false);
	check('shown again: mounted', ids(mounts.plan([c('pots', 10)], ahead)), ['pots', 'hudBar']);
	check('…afresh, not as the mount ahead', mounts.mountedAhead('pots'), false);

	check('dropped from the list before its show: unmounted', ids(mounts.plan([], [])), []);
	check('…and no longer the mount ahead', mounts.mountedAhead('hudBar'), false);
	check('…and a later show mounts it afresh', [ids(mounts.plan([c('hudBar', 30)], [])), mounts.mountedAhead('hudBar')], [['hudBar'], false]); // prettier-ignore
}

console.log('5. nothing ahead, nothing changes');
{
	const mounts = createAheadMounts();
	const shown = [c('basegame', 0), c('pots', 10), c('hudBar', 30)];
	check('the shown list as is', mounts.plan(shown, []), shown);
	check('none mounted ahead', ids(shown).map(mounts.mountedAhead), [false, false, false]);
}

console.log(failures ? `\n${failures} start-up-ahead check(s) failed.` : '\nstart-up ahead: ok');
if (failures > 0) throw new Error('start-up ahead fixture failed');
