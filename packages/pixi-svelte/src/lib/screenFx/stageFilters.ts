/**
 * The ONE owner of `app.stage.filters` and `app.stage.filterArea` (Invisible Shader Graph step 8e,
 * `docs/design/shader-graph-screens.md` §6.1). Three writers put a filter on the whole stage: a
 * screen transition's In route, the post FX, and the camera's chromatic wobble. Each claims its own
 * slot here instead of writing the list, so none overwrites another; the list is always, in order:
 *
 *  1. the **transition**: it composites the raw screens;
 *  2. the **post FX**: they grade the result once;
 *  3. the **camera**: the lens wobble comes last.
 *
 * A filter someone else put on the stage stays in front of them, and is what the stage gets back.
 * The transition's and the camera's filters pad nothing, so the input the post FX see is padded by
 * their own padding alone.
 *
 * THE AREA. Every stage filter is bounded to the viewport rather than to the stage's children
 * (slower, and larger than the screen: padding reels sit outside it). `filterArea` is LOCAL to the
 * stage, which the camera moves, so it is the viewport under the stage's current transform,
 * recomputed each frame just before the app renders: a shake never drags a blank edge into view.
 *
 * Zero cost at rest: with every slot empty the stage's list and area are as they were before the
 * first claim, and there is no ticker callback.
 */

import { Rectangle, UPDATE_PRIORITY, type Application, type Filter } from 'pixi.js';

export type StageFilterSlot = 'transition' | 'post' | 'camera';

const SLOTS: readonly StageFilterSlot[] = ['transition', 'post', 'camera'];

/**
 * How the post FX fill their slot: called when their list changes; `null` when the last ends,
 * before those filters are destroyed. Their box is the viewport, as every stage filter's is (design
 * §6.5): one `filterArea` bounds the whole list.
 */
export type StagePostFxSlot = (filters: readonly Filter[] | null) => void;

/**
 * What the stage's runtime reads of an app: its root, its viewport, its clock and its renderer. A
 * Pixi `Application` is one; a tool that draws through a renderer it shares (the Scene Editor's ▶
 * on the stage) gives its own.
 */
export type StageApp = Pick<Application, 'stage' | 'screen' | 'ticker' | 'renderer'>;

/** Apps whose stage filters keep the canvas's anti-aliasing (`settings.stageFxAntialias`, §16.10). */
const antialiased = new WeakSet<StageApp>();

/** Every stage filter draws without MSAA (Pixi's default, as the chromatic wobble always has), or,
 *  where the project asks, with the canvas's own. */
const antialiasFor = (app: StageApp): 'inherit' | 'off' =>
	antialiased.has(app) ? 'inherit' : 'off';

/** After every NORMAL-priority callback (the camera writes the stage's transform there), before
 *  the app's render (LOW). */
export const BEFORE_RENDER = UPDATE_PRIORITY.LOW + 1;

const NONE: readonly Filter[] = Object.freeze([]);

interface Owner {
	app: StageApp;
	slots: Record<StageFilterSlot, readonly Filter[]>;
	/** What was on the stage, and anything put there since that is not a slot's: kept in front. */
	external: readonly Filter[];
	/** The stage's own `filterArea`, given back at rest. */
	priorArea: Rectangle | undefined;
	area: Rectangle;
	/** The list this owner last set, to notice someone else replacing it. */
	last: readonly Filter[];
	tick: () => void;
}

const owners = new WeakMap<StageApp, Owner>();

/**
 * How far inside the viewport's edges the area is drawn, in screen pixels. Mapped back through a
 * moved stage, the viewport's edges land a rounding error off whole pixels, and Pixi rounds a
 * filter's frame outwards: a pixel wider, a pixel off, and the screen shell's still read across it
 * would shift. Drawn this far in, the frame always rounds to the viewport.
 */
const INSET_PX = 1 / 256;

/** The viewport in the stage's own space, under its transform now. */
const fitArea = (owner: Owner): void => {
	const { app, area } = owner;
	const stage = app.stage;
	area.x = (INSET_PX - stage.position.x) / stage.scale.x;
	area.y = (INSET_PX - stage.position.y) / stage.scale.y;
	area.width = (app.screen.width - 2 * INSET_PX) / stage.scale.x;
	area.height = (app.screen.height - 2 * INSET_PX) / stage.scale.y;
};

const ours = (owner: Owner): Set<Filter> => new Set(SLOTS.flatMap((slot) => owner.slots[slot]));

/**
 * Keep the stage's list as the slots say, after anything someone else put there since. Each frame
 * this is a comparison and nothing more, unless the list was replaced or a slot changed (`changed`).
 */
const apply = (owner: Owner, changed: boolean): void => {
	const stage = owner.app.stage;
	const current = stage.filters ?? NONE;
	if (stage.filterArea !== owner.area) stage.filterArea = owner.area;
	if (current === owner.last && !changed) return;
	if (current !== owner.last) {
		const mine = ours(owner);
		owner.external = current.filter((f) => !mine.has(f));
	}
	const stack = [...owner.external, ...SLOTS.flatMap((slot) => owner.slots[slot])];
	const same = owner.last.length === stack.length && stack.every((f, i) => owner.last[i] === f);
	if (!same) {
		stage.filters = stack;
		owner.last = stage.filters ?? NONE;
	}
};

const claim = (app: StageApp): Owner => {
	const stage = app.stage;
	const owner: Owner = {
		app,
		slots: { transition: NONE, post: NONE, camera: NONE },
		external: [...(stage.filters ?? NONE)],
		priorArea: stage.filterArea,
		area: new Rectangle(),
		last: stage.filters ?? NONE,
		tick: () => {},
	};
	owner.tick = () => {
		if (stage.destroyed) {
			release(owner);
			return;
		}
		fitArea(owner);
		apply(owner, false);
	};
	owners.set(app, owner);
	app.ticker.add(owner.tick, undefined, BEFORE_RENDER);
	return owner;
};

/** Every slot empty: give the stage back its own list and area, and stop. */
const release = (owner: Owner): void => {
	const { app } = owner;
	app.ticker?.remove(owner.tick);
	owners.delete(app);
	const stage = app.stage;
	if (!stage || stage.destroyed) return;
	const current = stage.filters ?? NONE;
	const mine = ours(owner);
	const external = current === owner.last ? owner.external : current.filter((f) => !mine.has(f));
	stage.filters = external.length ? [...external] : null;
	stage.filterArea = owner.priorArea;
};

/**
 * Put `filters` in `slot` of the stage's list (none: empty it), in place of what the slot held. The
 * list and its area are right at once, for the frame being drawn.
 */
export function setStageFilters(
	app: StageApp,
	slot: StageFilterSlot,
	filters: readonly Filter[],
): void {
	if (!app.stage || app.stage.destroyed) return;
	let owner = owners.get(app);
	if (!filters.length) {
		if (!owner) return;
		owner.slots[slot] = NONE;
		if (SLOTS.every((s) => !owner?.slots[s].length)) {
			release(owner);
			return;
		}
	} else {
		owner ??= claim(app);
		const antialias = antialiasFor(app);
		for (const filter of filters) filter.antialias = antialias;
		owner.slots[slot] = [...filters];
	}
	fitArea(owner);
	apply(owner, true);
}

/** What `slot` holds on `app`'s stage; every slot's filters, in order, without one. */
export const stageFilters = (app: StageApp, slot?: StageFilterSlot): readonly Filter[] => {
	const owner = owners.get(app);
	if (!owner) return NONE;
	return slot ? owner.slots[slot] : SLOTS.flatMap((s) => owner.slots[s]);
};

/**
 * The post FX slot of `app`'s stage, in the shape the post FX fill it (`StagePostFxSlot`): their
 * filters after the transition's and before the camera's.
 */
export const stagePostFxSlot =
	(app: StageApp): StagePostFxSlot =>
	(filters) =>
		setStageFilters(app, 'post', filters ?? NONE);

/**
 * Whether every filter on `app`'s stage keeps the canvas's anti-aliasing (`'inherit'`: MSAA where
 * the canvas has it, WebGL2) or draws without (`'off'`, the default). The game sets it from the
 * project's `settings.stageFxAntialias` (design §16.10); it reaches the filters on the stage now and
 * every one put there after.
 */
export function setStageFxAntialias(app: StageApp, on: boolean): void {
	if (on) antialiased.add(app);
	else antialiased.delete(app);
	const owner = owners.get(app);
	if (!owner) return;
	const antialias = antialiasFor(app);
	for (const slot of SLOTS) for (const filter of owner.slots[slot]) filter.antialias = antialias;
}
