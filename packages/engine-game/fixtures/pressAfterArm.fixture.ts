/**
 * Repro fixture for "one tap skipped the free-spin outro's count-up AND dismissed the outro".
 *
 * Found in review when the coded outro gate was retired (2026-09-28, `docs/status/flow.md`): with
 * `tapToSkip` on, `<CountUpInteraction>` skips on pointer-DOWN, so the count lands INSIDE the press.
 * The landing arms the outro screen's `tapToContinue` (`tapArmAfterSignal:
 * 'freeSpinOutroCountUpComplete'`), `PressToContinue` registers, `<ContinuePressMask>` mounts on top
 * of everything — and that same press's pointer-UP lands on the mask, which ran the newest press:
 * `complete('freeSpinOutro')`, LATCHED by the `showContainer{awaitComplete}` holding the round. The
 * player never saw the total. The win overlay's post-count-up dismiss press had the same shape, and
 * so did any press held while a count-up landed on its own.
 *
 * The rule under test: a press surface acts only on a press that STARTED after it armed. Modelled
 * over the REAL pieces the components wire — `createPressStarts` (components-layout), the
 * continue-press registry (state-shared) and `resolveWinTap` — with the input stack `apps/lines`
 * mounts, top-most first:
 *   - `<ContinuePressMask>`: mounted once; its rect exists while a continue press is live.
 *   - `<CountUpInteraction>` with `tapToSkip` alone: skips on pointer-DOWN while the count runs.
 * `mask: 'shipped'` replays the mask as it was (every release ran the newest press), so each
 * scenario also shows the regression it guards against.
 *
 * Run: node --experimental-strip-types packages/engine-game/fixtures/pressAfterArm.fixture.ts
 */
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lfReaderFrom } from '../../../scripts/lib/read-lf.mjs';

import { createPressStarts } from '../../components-layout/src/pressStarts.ts';
import {
	registerContinuePress,
	runContinuePress,
	topContinuePress,
} from '../../state-shared/src/continuePress.ts';
import { resolveWinTap } from '../src/game/winEscalation.ts';

type MaskMode = 'fixed' | 'shipped';

/** The pointer input stack of one presentation. A pointer event goes to the top-most surface. */
const createStage = (mask: MaskMode) => {
	// Per `<ContinuePressMask>` instance, exactly as the component holds it.
	const presses = createPressStarts<number | undefined>();
	let live = 0;
	let countUpDown: (() => void) | undefined;
	const unmounts: (() => void)[] = [];

	const stage = {
		/** A `PressToContinue` mounting — its `continuePressCount` bump and registration. */
		mountPress(onpress: () => void): () => void {
			live += 1;
			const unregister = registerContinuePress(onpress);
			let mounted = true;
			const unmount = () => {
				if (!mounted) return;
				mounted = false;
				live -= 1;
				unregister();
			};
			unmounts.push(unmount);
			return unmount;
		},
		/** `<CountUpInteraction>` mounted (its DOWN handler) or unmounted (`undefined`). */
		setCountUp(onDown: (() => void) | undefined): void {
			countUpDown = onDown;
		},
		down(pointerId = 1): void {
			if (live === 0) return countUpDown?.();
			if (mask === 'fixed') presses.down(pointerId, topContinuePress());
		},
		up(pointerId = 1): void {
			// Tap-only `<CountUpInteraction>` does nothing on release; with no mask nothing else listens.
			if (live === 0) return;
			if (mask === 'shipped') return runContinuePress(topContinuePress());
			const press = presses.up(pointerId);
			if (press) runContinuePress(press.startedOn);
		},
		/** Released off the canvas: Pixi sends `pointerupoutside` to the press's target. */
		upOutside(pointerId = 1): void {
			if (live > 0 && mask === 'fixed') presses.cancel(pointerId);
		},
		tap(pointerId = 1): void {
			stage.down(pointerId);
			stage.up(pointerId);
		},
		teardown(): void {
			unmounts.forEach((unmount) => unmount());
			assert.equal(topContinuePress(), undefined, 'expected every press to unregister');
		},
	};
	return stage;
};

// --- The free-spin outro: `FreeSpinOutroDriver` + the scaffold screen's armed-after tap -----------

const playOutro = (mask: MaskMode, { tapToSkip }: { tapToSkip: boolean }) => {
	const stage = createStage(mask);
	const outro = { landed: false, completed: false };
	const land = () => {
		outro.landed = true;
		// `{#if !countUpCompleted}` unmounts the count-up surface...
		stage.setCountUp(undefined);
		// ...and `freeSpinOutroCountUpComplete` arms the screen's tap: `TapToContinue` → `PressToContinue`.
		stage.mountPress(() => (outro.completed = true));
	};
	stage.setCountUp(tapToSkip ? land : undefined);
	return { stage, outro, land };
};

for (const mask of ['fixed', 'shipped'] as const) {
	// (1) The press that skips the count straddles the tap arming.
	const { stage, outro } = playOutro(mask, { tapToSkip: true });
	stage.down();
	assert.ok(outro.landed, 'expected tap-to-skip to land the count on pointer-DOWN');
	stage.up();
	if (mask === 'shipped') {
		assert.ok(outro.completed, 'expected the shipped mask to reproduce the one-tap dismiss');
	} else {
		assert.ok(!outro.completed, 'expected the skip tap NOT to dismiss the total it just landed');
		// (2) A fresh press after arming continues — (3) the whole thing is the two-stage tap.
		stage.tap();
		assert.ok(outro.completed, 'expected the second, fresh tap to continue');
	}
	stage.teardown();
}

{
	// The count lands on its own; the player then taps once. Unchanged.
	const { stage, outro, land } = playOutro('fixed', { tapToSkip: false });
	land();
	stage.tap();
	assert.ok(outro.completed, 'expected a tap after a natural landing to continue');
	stage.teardown();
}

for (const mask of ['fixed', 'shipped'] as const) {
	// A press held while the count lands on its own (a hold-to-speed-up, or a finger resting on the
	// screen): its release is not a tap on the tap-to-continue that armed underneath it.
	const { stage, outro, land } = playOutro(mask, { tapToSkip: false });
	stage.setCountUp(() => {});
	stage.down();
	land();
	stage.up();
	assert.equal(outro.completed, mask === 'shipped', `${mask}: release after a natural landing`);
	stage.teardown();
}

{
	// Two fingers: the one that skipped is ignored, a finger that went down after arming continues.
	const { stage, outro } = playOutro('fixed', { tapToSkip: true });
	stage.down(1);
	stage.down(2);
	stage.up(1);
	assert.ok(!outro.completed, 'expected the straddling finger to be ignored');
	stage.up(2);
	assert.ok(outro.completed, 'expected the finger that pressed after arming to continue');
	stage.teardown();
}

{
	// A fresh press released off the canvas is forgotten: a later stray release does nothing.
	const { stage, outro, land } = playOutro('fixed', { tapToSkip: false });
	land();
	stage.down();
	stage.upOutside();
	stage.up();
	assert.ok(!outro.completed, 'expected a press released off the canvas not to continue');
	stage.tap();
	assert.ok(outro.completed, 'expected the next tap to continue');
	stage.teardown();
}

// --- The mask runs the press the press STARTED on --------------------------------------------------

{
	// A press arms on top mid-press: the release still belongs to the one it began on.
	const stage = createStage('fixed');
	const ran: string[] = [];
	stage.mountPress(() => ran.push('A'));
	stage.down();
	stage.mountPress(() => ran.push('B'));
	stage.up();
	assert.deepEqual(ran, ['A'], 'expected the press it started on to run, never the one that armed');
	stage.tap();
	assert.deepEqual(ran, ['A', 'B'], 'expected a fresh press to go to the new top');
	stage.teardown();
}

{
	// The press it started on leaves mid-press: nothing runs, not the overlay beneath it.
	const stage = createStage('fixed');
	const ran: string[] = [];
	stage.mountPress(() => ran.push('X'));
	const unmountA = stage.mountPress(() => ran.push('A'));
	stage.down();
	unmountA();
	stage.up();
	assert.deepEqual(ran, [], 'expected no handover to the overlay beneath');
	stage.teardown();
}

{
	// The mask's rect unmounts and remounts mid-press (one overlay out, the next in).
	const stage = createStage('fixed');
	const ran: string[] = [];
	const unmountA = stage.mountPress(() => ran.push('A'));
	stage.down();
	unmountA();
	stage.mountPress(() => ran.push('C'));
	stage.up();
	assert.deepEqual(ran, [], 'expected the remounted mask to ignore a press it never saw begin');
	stage.tap();
	assert.deepEqual(ran, ['C'], 'expected a fresh press to run the new overlay');
	stage.teardown();
}

// --- The win overlay (`WinGate`): tap-to-step / land / dismiss still work ---------------------------

/** `WinGate` on the flow path, NOT headless: `<CountUpInteraction onSkip={stepOrSkip}>` while the count
 *  runs, then `<PressToContinue hidePrompt onpress={dismissNow}>` once it lands. */
const playFlowWin = (mask: MaskMode, tierCount: number) => {
	const stage = createStage(mask);
	const win = { tier: 0, landed: false, holding: false, dismissed: false };
	stage.setCountUp(() => {
		const action = resolveWinTap({ escalating: tierCount > 0, tierIndex: win.tier, tierCount });
		if (action.kind === 'step') {
			win.tier = action.toTier;
			return;
		}
		win.landed = true;
		win.holding = action.hold;
		stage.setCountUp(undefined);
		stage.mountPress(() => (win.dismissed = true));
	});
	return { stage, win };
};

for (const mask of ['fixed', 'shipped'] as const) {
	const tierCount = 4;
	const { stage, win } = playFlowWin(mask, tierCount);
	for (let tap = 1; tap < tierCount; tap += 1) stage.tap();
	assert.equal(win.tier, tierCount - 1, 'expected each tap to step one tier');
	assert.ok(!win.landed, 'expected stepping not to land');
	stage.tap();
	assert.ok(win.landed && win.holding, 'expected the final-tier tap to land and hold the total');
	if (mask === 'shipped') {
		assert.ok(win.dismissed, 'expected the shipped mask to reproduce the landing tap dismissing');
	} else {
		assert.ok(!win.dismissed, 'expected the landing tap to leave the total on screen');
		stage.tap();
		assert.ok(win.dismissed, 'expected the next tap to dismiss');
	}
	stage.teardown();
}

{
	// The coded path: ONE press for the whole presentation — land, then dismiss. It armed before either
	// tap, so both are its own.
	const stage = createStage('fixed');
	const win = { landed: false, dismissed: false };
	stage.mountPress(() => {
		if (win.landed) win.dismissed = true;
		else win.landed = true;
	});
	stage.tap();
	assert.ok(win.landed && !win.dismissed, 'expected the first tap to land');
	stage.tap();
	assert.ok(win.dismissed, 'expected the second tap to dismiss');
	stage.teardown();
}

// --- The loading screen's tap ------------------------------------------------------------------------

{
	// Armed on arrival: the player's first tap starts the game.
	const stage = createStage('fixed');
	let started = false;
	stage.mountPress(() => (started = true));
	stage.tap();
	assert.ok(started, 'expected the loading tap to start the game');
	stage.teardown();
}

for (const mask of ['fixed', 'shipped'] as const) {
	// Pressed while loading, released after the tap armed: not a tap on it.
	const stage = createStage(mask);
	let started = false;
	stage.down();
	stage.mountPress(() => (started = true));
	stage.up();
	assert.equal(started, mask === 'shipped', `${mask}: a press begun during loading`);
	stage.tap();
	assert.ok(started, 'expected a fresh tap to start the game');
	stage.teardown();
}

// --- `OnPressFullScreen` on its own (a backdrop dismiss, or a game with no mask) ---------------------

{
	const presses = createPressStarts<true>();
	let fired = 0;
	const up = (pointerId: number) => {
		if (presses.up(pointerId)) fired += 1;
	};
	up(1);
	assert.equal(fired, 0, 'expected a release with no DOWN on the rect to be ignored');
	presses.down(1, true);
	up(1);
	up(1);
	assert.equal(fired, 1, 'expected one press to fire once');
	presses.down(2, true);
	presses.cancel(2);
	up(2);
	assert.equal(fired, 1, 'expected a press released off the rect not to fire');
}

// The components are Svelte templates Node cannot execute, so the wiring the model above stands in for
// is asserted against the SOURCE. Substrings, not patterns: prettier is free to wrap around them.
{
	const read = lfReaderFrom(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'));
	const mask = read('packages/engine-game/src/components/ContinuePressMask.svelte');
	for (const wiring of [
		'onpointerdown={(e) => presses.down(e.pointerId, topContinuePress())}',
		'const press = presses.up(e.pointerId);',
		'if (press) runContinuePress(press.startedOn);',
		'onpointerupoutside={(e) => presses.cancel(e.pointerId)}',
	]) {
		assert.ok(mask.includes(wiring), `expected ContinuePressMask to wire \`${wiring}\``);
	}
	const rect = read('packages/components-layout/src/components/OnPressFullScreen.svelte');
	for (const wiring of [
		'onpointerdown={(e) => presses.down(e.pointerId, true)}',
		'if (presses.up(e.pointerId)) props.onpress();',
		'onpointerupoutside={(e) => presses.cancel(e.pointerId)}',
	]) {
		assert.ok(rect.includes(wiring), `expected OnPressFullScreen to wire \`${wiring}\``);
	}
	// Space follows the same rule: a key held when the surface armed auto-repeats `keyDown`.
	assert.ok(
		read('packages/components-shared/src/components/EnableHotkey.svelte').includes(
			'repeat: e.repeat',
		),
		'expected the hotkey event to carry `repeat`',
	);
	const hotkey = read('packages/components-shared/src/components/OnHotkey.svelte');
	for (const wiring of [
		'if (emitterEvent.repeat) return;',
		"if (emitterEvent.action === 'keyUp' && !pressSeen) return;",
	]) {
		assert.ok(hotkey.includes(wiring), `expected OnHotkey's opt-in gate to wire \`${wiring}\``);
	}
	for (const surface of ['PressToContinue', 'CountUpInteraction']) {
		assert.ok(
			read(`packages/engine-game/src/components/${surface}.svelte`).includes(
				'ignorePressInProgress',
			),
			`expected ${surface}'s Space hotkey to ignore a press in progress`,
		);
	}
}

console.log(
	'\nOK — a press surface acts only on a press that started after it armed: the skip tap lands the outro total and a second tap continues; win step/land/dismiss and the loading tap are unchanged.',
);
