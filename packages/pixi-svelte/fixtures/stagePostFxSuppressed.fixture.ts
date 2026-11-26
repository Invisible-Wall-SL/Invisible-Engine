/**
 * Offline fixture for leaving the post FX out of the stage's filters (`screenFx/stageFilters.ts`
 * `setStagePostFxSuppressed`, the render-quality ladder's last step) — run with:
 *   pnpm check:all --only stagePostFxSuppressed
 *
 * Pins, on a stand-in app: without the switch the list is transition, post, camera as always; left
 * out, the post FX are off the list while the transition's and the camera's stay, in order, and a
 * filter someone else put on the stage stays in front; the slot keeps its filters (and takes new
 * ones while left out), all back in their place when put back; left out with no other slot filled
 * the stage has no filters; switching before any slot is claimed holds for the first claim;
 * emptying every slot gives the stage back its own list and area; one app's switch is not
 * another's.
 */

import type { Filter, Rectangle } from 'pixi.js';

import {
	setStageFilters,
	setStagePostFxSuppressed,
	stageFilters,
	stagePostFxSlot,
	stagePostFxSuppressed,
	type StageApp,
} from '../src/lib/screenFx/stageFilters.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (ok) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
	}
};

type FakeFilter = Filter & { name: string };
const filter = (name: string): FakeFilter => ({ name, antialias: 'off' }) as unknown as FakeFilter;

type FakeStage = {
	filters: readonly Filter[] | null;
	filterArea: Rectangle | undefined;
	destroyed: boolean;
	position: { x: number; y: number };
	scale: { x: number; y: number };
};

/** A stand-in app: a stage that keeps what it is given, and a ticker that counts its callbacks. */
function app() {
	const ticks = new Set<() => void>();
	const stage: FakeStage = {
		filters: null,
		filterArea: undefined,
		destroyed: false,
		position: { x: 0, y: 0 },
		scale: { x: 1, y: 1 },
	};
	const ticker = {
		add: (fn: () => void) => ticks.add(fn),
		remove: (fn: () => void) => ticks.delete(fn),
	};
	const fake = {
		stage,
		screen: { width: 800, height: 600 },
		ticker,
		renderer: {},
	} as unknown as StageApp;
	return {
		app: fake,
		stage,
		ticks,
		tick: () => ticks.forEach((fn) => fn()),
		list: () => (stage.filters ?? []).map((f) => (f as FakeFilter).name).join(' '),
	};
}

console.log('without the switch');
{
	const s = app();
	setStageFilters(s.app, 'camera', [filter('camera')]);
	stagePostFxSlot(s.app)([filter('grade'), filter('bloom')]);
	setStageFilters(s.app, 'transition', [filter('wipe')]);
	check('transition, post, camera in order', s.list() === 'wipe grade bloom camera', s.list());
	check('not left out', !stagePostFxSuppressed(s.app));
}

console.log('\nleft out');
{
	const s = app();
	const external = filter('theirs');
	s.stage.filters = [external];
	setStageFilters(s.app, 'transition', [filter('wipe')]);
	stagePostFxSlot(s.app)([filter('grade'), filter('bloom')]);
	setStageFilters(s.app, 'camera', [filter('camera')]);
	const before = s.list();
	setStagePostFxSuppressed(s.app, true);
	check(
		'the post FX are off the list at once; the rest stay, in order',
		before === 'theirs wipe grade bloom camera' && s.list() === 'theirs wipe camera',
		`${before} → ${s.list()}`,
	);
	check(
		'the slot keeps its filters',
		stageFilters(s.app, 'post')
			.map((f) => (f as FakeFilter).name)
			.join(' ') === 'grade bloom',
	);
	s.tick();
	check('a frame keeps them out', s.list() === 'theirs wipe camera', s.list());
	stagePostFxSlot(s.app)([filter('vignette')]);
	check('new post FX while left out stay off the list', s.list() === 'theirs wipe camera');
	setStagePostFxSuppressed(s.app, false);
	check(
		'put back, the slot is in its place again with what it holds now',
		s.list() === 'theirs wipe vignette camera',
		s.list(),
	);
	check('and the switch reads off', !stagePostFxSuppressed(s.app));
}
{
	const s = app();
	stagePostFxSlot(s.app)([filter('grade')]);
	setStagePostFxSuppressed(s.app, true);
	check('the post FX alone, left out: no filters on the stage', s.stage.filters === null);
	setStagePostFxSuppressed(s.app, false);
	check('put back: the post FX again', s.list() === 'grade', s.list());
	stagePostFxSlot(s.app)(null);
	check(
		'every slot emptied: the stage gets its own list and area back, no ticker callback',
		s.stage.filters === null && s.stage.filterArea === undefined && s.ticks.size === 0,
	);
}
{
	const s = app();
	setStagePostFxSuppressed(s.app, true);
	stagePostFxSlot(s.app)([filter('grade')]);
	setStageFilters(s.app, 'camera', [filter('camera')]);
	check('left out before any claim holds for the first', s.list() === 'camera', s.list());
	const other = app();
	stagePostFxSlot(other.app)([filter('grade')]);
	check('another app is not left out', other.list() === 'grade', other.list());
	setStagePostFxSuppressed(s.app, false);
	check('put back', s.list() === 'grade camera', s.list());
}

if (failures) throw new Error(`stagePostFxSuppressed fixture: ${failures} check(s) FAILED`);
console.log('\nstagePostFxSuppressed fixture: ok');
