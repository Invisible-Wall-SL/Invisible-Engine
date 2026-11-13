/**
 * Offline fixture for THE BASE GAME, MOUNTED AHEAD — the board and the base game's layers are mounted
 * under the loading bar, dormant, and start in place at the start screen's tap; the reels' filler
 * views are built with them, so the first spin builds none.
 *
 *   pnpm --filter launcher-api exec tsx ../lines/src/game/basegameAhead.fixture.ts
 *
 * Claims:
 *
 *  1. THE FILLER VIEWS, BUILT AT ONCE. Handed a seed, every filler view not built yet is built,
 *     vacant on the seed; a cell then starts its first entry, and going vacant keeps the cell it
 *     drew, never the seed again. Without a seed, a view is built when first handed a cell, as
 *     before. An unchanged list is handed back.
 *  2. THE BASE GAME IS MOUNTED AHEAD. `Game.svelte` mounts it under the bar when a start-up chain
 *     shows it, as the last warm-up step and without drawing a random number, keeps it at its first
 *     show, and unmounts it on a later hide as before; until the show it is dormant (`<Dormant>`),
 *     its board, win line and reel Element FX hidden. Only a reel board: a play field, a card table
 *     and a match-3 board start their loop, match or session as they mount. Not when the tap turns
 *     the anticipation mode on: that moves the reel stack into the camera's branch, which builds it
 *     again.
 *  3. EVERYTHING UNDER IT SLEEPS AND STARTS AT THE SHOW. `<Dormant>` hands down dormancy and a
 *     restart key the show changes; a `<LayoutScene>` inside sleeps with it, and only there does its
 *     own restart key change at the show (a start-up screen given `dormant` keeps its key as is); a
 *     kept rig (a reel view's) is put away and its show is a new play; the filler pool is seeded
 *     only on a board mounted ahead.
 */

import { createPoolViews } from './reelViewPool.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (ok) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};

type C = { id: string };
const cell = (id: string): C => ({ id });
const shape = (views: readonly { cell: C | undefined; vacant: boolean }[]) =>
	views.map((v) => `${v.cell?.id ?? '-'}${v.vacant ? '/v' : ''}`).join(' ');

console.log('1. the filler views, built at once');
{
	const seed = cell('seed');
	const pool = createPoolViews<C>();
	const rest = pool([undefined, undefined, undefined], seed);
	check(
		'every view built, vacant on the seed',
		shape(rest) === 'seed/v seed/v seed/v',
		shape(rest),
	);
	check('the same again: the same list', pool([undefined, undefined, undefined], seed) === rest);
	const f1 = cell('f1');
	const rolling = pool([f1, undefined, undefined], seed);
	check('a cell: drawn by its view', shape(rolling) === 'f1 seed/v seed/v', shape(rolling));
	check('…the others unchanged', rolling[1] === rest[1] && rolling[2] === rest[2]);
	const after = pool([undefined, undefined, undefined], seed);
	check(
		'vacant again: keeps the cell it drew',
		shape(after) === 'f1/v seed/v seed/v',
		shape(after),
	);
	const later = pool([undefined, undefined, undefined], cell('other'));
	check('a new seed changes no view', later === after);

	const unseeded = createPoolViews<C>();
	const before = unseeded([undefined, undefined]);
	check(
		'no seed: no view built until it is handed a cell',
		shape(before) === '-/v -/v',
		shape(before),
	);
	const first = unseeded([undefined, f1]);
	check('…then built on it', shape(first) === '-/v f1', shape(first));
}

type Fs = { readFileSync(path: URL, encoding: 'utf8'): string };
// Imported by name at run time: this package's tsconfig carries no Node types.
void import('node:' + 'fs').then(({ readFileSync }: Fs) => {
	const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
	const game = read('../components/Game.svelte');

	console.log('2. the base game is mounted ahead');
	check(
		'mounted while up, or ahead',
		game.includes('{#if !isFlowDriven || isBasegameActive || basegameAhead}'),
	);
	const screensStep = game.indexOf('flowV2Ahead = [...flowV2Ahead, container];');
	const boardStep = game.indexOf('basegameAhead = true;');
	check('ahead under the bar, after the screens', screensStep > 0 && boardStep > screensStep);
	check(
		'…only a reel board, when a start-up chain shows it, its tap leaves the anticipation mode and it is not up yet, drawing no random number',
		/flowV2DrivesScreens &&\s*mechanic\.id === 'reels' &&\s*flowV2Handle\?\.startupShown\.includes\(basegameScreenId\) &&\s*!flowV2Handle\.chainCallsAction\('tapToStart', 'enableAnticipationMode'\) &&\s*!isBasegameActive\s*\?\s*\[\s*\(\) =>\s*mountWithoutRandomDraws\(\(\) =>\s*flushSync\(\(\) => \{\s*basegameAhead = true;/.test(
			game,
		),
	);
	check(
		'kept at its first show: no longer ahead from then on',
		/\$effect\.pre\(\(\) => \{\s*if \(isBasegameActive\) untrack\(\(\) => \(basegameAhead = false\)\);\s*\}\);/.test(
			game,
		),
	);
	check(
		'dormant until the show, decided once when it mounts',
		/const basegameDormant = \(\): boolean => untrack\(\(\) => basegameAhead && !isBasegameActive\);/.test(
			game,
		) &&
			/\{#if basegameDormant\(\)\}\s*<Dormant shown=\{\(\) => isBasegameActive\}>\s*\{@render basegame\(\)\}\s*<\/Dormant>\s*\{:else\}\s*\{@render basegame\(\)\}\s*\{\/if\}/.test(
				game,
			),
	);
	check(
		'the board and the win line hidden until it is up',
		(game.match(/<MainContainer visible=\{basegameUp\}>/g) ?? []).length === 1 &&
			game.includes('<Container zIndex={LAYER_BAND_WIN_PRESENTATION} visible={basegameUp}>') &&
			game.includes('const basegameUp = $derived(!isFlowDriven || isBasegameActive);'),
	);
	check(
		'the reels’ Element FX start when it is up',
		game.includes('{#if reelFx.length && basegameUp}'),
	);

	console.log('3. everything under it sleeps and starts at the show');
	const dormant = read('../../../../packages/pixi-svelte/src/lib/components/Dormant.svelte');
	check(
		'<Dormant>: dormant until shown, a restart key the show changes, no container',
		dormant.includes('setContextDormantScope(() => !shown());') &&
			dormant.includes('setContextRestart(() => shown());') &&
			dormant.trim().endsWith('{@render props.children()}') &&
			!dormant.includes('<Container'),
	);
	const scene = read('../../../../packages/engine-layout/src/lib/LayoutScene.svelte');
	check(
		'a <LayoutScene> inside sleeps with it, its own restart key changing at the show too; one given `dormant` keeps its key',
		scene.includes('const scope = ownDormant ? undefined : getContextDormantScope();') &&
			scene.includes('const dormantOf = ownDormant ?? scope;') &&
			/ownRestart && scope\s*\? \(\) => `\$\{scope\(\) \? 'ahead' : 'shown'\}:\$\{String\(ownRestart\(\)\)\}`\s*: ownRestart;/.test(
				scene,
			),
	);
	const provider = read('../../../../packages/pixi-svelte/src/lib/components/RigProvider.svelte');
	check(
		'a kept rig is put away while dormant, and the show is a new play',
		provider.includes('setContextRigParked(() => !!parked || !!dormant?.());') &&
			provider.includes(
				'setContextRestart(dormant ? () => (dormant() ? ASLEEP : restart) : () => restart);',
			),
	);
	const filler = read('../components/ReelPaddingPool.svelte');
	check(
		'the filler pool is seeded only on a board mounted ahead',
		filler.includes('const ahead = getContextDormant()?.() ?? false;') &&
			filler.includes('poolViews(shown, ahead ? props.column[0] : undefined)'),
	);

	console.log(
		failures ? `\n${failures} base-game-ahead check(s) failed.` : '\nbase game ahead: ok',
	);
	if (failures > 0) throw new Error('base game ahead fixture failed');
});
