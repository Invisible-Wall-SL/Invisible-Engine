// The screen-script interpreter: plays one scenario of `screens/<gameType>.json` against a booted
// page through `window.__IE_DETERMINISM__` (apps/lines/src/game/determinism.ts). Every wait is on a
// state the game reports, never on wall time, so both runtimes reach each screen at the frame their
// own game logic puts it on.
//
// Ops (one object per step, `op` names it):
//   waitFor  { until, maxFrames, fallback }   the page's own waitFor (`until`: screen/inSet/idle/
//                                   loaded/playerIn/winLevel), stepped in-page with one draw
//   until    { until, maxFrames, batch = 10, fallback }   step in `batch`-frame slices until a
//                                   harness-side test holds — adds `winLevelIn: [..]`, `winAbove: n`,
//                                   `cue: name` (a Flow v2 cue the probe records after this op
//                                   starts; the cue's own frame becomes the anchor), `anyOf: [..]`.
//                                   `fallback: true` carries on at `maxFrames` instead of failing
//                                   (a project whose win ladder has other aliases): still the same
//                                   frame on both sides, and for a `cue` that frame is the anchor
//   step     { frames, from }       N frames; `from: 'cue'` steps to the last `until` cue's anchor
//                                   + N, failing if that frame is already behind
//   space                           a two-frame Space tap (spin from idle, tap past a hold)
//   tapToStart                      a Space tap only while a tap-to-start screen covers the board
//   force    { beat }               hold a forced beat for this session's next round (`…/force`)
//   settle   { maxFrames, tapEvery }   step until idle, tapping every `tapEvery` frames
//   spinUntilWin { maxSpins }      spin until a spin shows a win (the seed decides which); stops
//                                   on the first frame the win is on show
//   capture  { screen }             screenshot + the probe state at that frame

const DEFAULT_MAX_FRAMES = 3600;

class ScriptError extends Error {}

// Cues the probe recorded after `since` (the state an `until` op started from): later frames, and
// any at its frame past the ones it already listed (an I/O answer between frames records there).
export const cuesSince = (since, s) => {
	const seenAtFrame = (since.cues ?? []).filter((c) => c.frame === since.frame).length;
	let atFrame = 0;
	return (s.cues ?? []).filter(
		(c) => c.frame > since.frame || (c.frame === since.frame && ++atFrame > seenAtFrame),
	);
};

const matches = (until, s) =>
	(until.anyOf === undefined || until.anyOf.some((c) => matches(c, s))) &&
	(until.screen === undefined ||
		(until.inSet
			? s.screens.includes(until.screen)
			: s.screens[s.screens.length - 1] === until.screen)) &&
	(until.idle === undefined || s.idle === until.idle) &&
	(until.loaded === undefined || s.loaded === until.loaded) &&
	(until.playerIn === undefined || s.playerIn === until.playerIn) &&
	(until.winLevel === undefined || (s.winLevel ?? null) === until.winLevel) &&
	(until.winLevelIn === undefined || until.winLevelIn.includes(s.winLevel)) &&
	(until.winAbove === undefined || s.win > until.winAbove) &&
	(until.cue === undefined || s.fresh.some((c) => c.cue === until.cue));

/**
 * `page` is `openPage()`'s handle, `draw` the scenario's draw mode (`last` or the canary's
 * `every`), `force(beat)` posts to the game's mock, `capture(screen, state)` stores a screenshot,
 * `note(text)` reports how a `cue` anchor was set (the cue's frame, or the fallback's).
 */
export async function playScenario(scenario, { page, draw, force, capture, trace, note }) {
	const api = (call) => page.evaluate(`window.__IE_DETERMINISM__.${call}`);
	const state = () => api('state()');
	const step = (frames) => api(`step(${Number(frames)}, { draw: '${draw}' })`);
	const space = async () => {
		await page.key('keyDown');
		await step(2);
		await page.key('keyUp');
	};
	const waitFor = async (until, maxFrames = DEFAULT_MAX_FRAMES) => {
		const r = await api(`waitFor(${JSON.stringify({ ...until, maxFrames, draw })})`);
		return r.ok ? r.state : null;
	};
	const until = async (test, maxFrames = DEFAULT_MAX_FRAMES, batch = 10) => {
		const since = await state();
		for (let ran = 0; ; ran += batch) {
			const s = ran ? await state() : since;
			s.fresh = cuesSince(since, s);
			if (matches(test, s)) return s;
			if (ran >= maxFrames) return null;
			await step(batch);
		}
	};
	let anchor;
	const fail = (i, op, s) =>
		new ScriptError(
			`step ${i + 1} (${op.op}${op.screen ? ` ${op.screen}` : ''}): not reached — ` +
				JSON.stringify(s ?? {}),
		);

	for (const [i, op] of scenario.steps.entries()) {
		switch (op.op) {
			case 'waitFor': {
				if (!(await waitFor(op.until, op.maxFrames)) && !op.fallback)
					throw fail(i, op, await state());
				break;
			}
			case 'until': {
				const s = await until(op.until, op.maxFrames, op.batch);
				if (!s && !op.fallback) throw fail(i, op, await state());
				if (op.until.cue === undefined) break;
				const cue = s?.fresh.find((c) => c.cue === op.until.cue);
				anchor = cue ? cue.frame : (await state()).frame;
				note?.(
					cue
						? `cue \`${op.until.cue}\` at frame ${anchor}`
						: `cue \`${op.until.cue}\` not fired: fallback at frame ${anchor}`,
				);
				break;
			}
			case 'step': {
				if (op.from === undefined) {
					await step(op.frames);
					break;
				}
				if (op.from !== 'cue' || anchor === undefined)
					throw new ScriptError(
						`step ${i + 1}: \`from: '${op.from}'\` needs a \`cue\` until before it`,
					);
				const left = anchor + op.frames - (await state()).frame;
				if (left < 0)
					throw new ScriptError(
						`step ${i + 1}: cue frame ${anchor} + ${op.frames} is ${-left} frame(s) behind`,
					);
				if (left) await step(left);
				break;
			}
			case 'space':
				await space();
				break;
			case 'tapToStart':
				if (!(await state()).playerIn) await space();
				break;
			case 'force':
				await force(op.beat);
				break;
			case 'settle': {
				const max = op.maxFrames ?? 7200;
				const every = op.tapEvery ?? 600;
				let settled = false;
				for (let ran = 0; ran < max && !settled; ran += every) {
					settled = Boolean(await waitFor({ idle: true }, every));
					if (!settled) await space();
				}
				if (!settled) throw fail(i, op, await state());
				break;
			}
			case 'spinUntilWin': {
				let won = false;
				for (let n = 0; n < (op.maxSpins ?? 12) && !won; n++) {
					await space();
					if (!(await waitFor({ idle: false }, 600))) throw fail(i, op, await state());
					const s = await until({ anyOf: [{ idle: true }, { winAbove: 0 }] }, 3600);
					if (!s) throw fail(i, op, await state());
					won = s.win > 0;
				}
				if (!won) throw fail(i, op, await state());
				break;
			}
			case 'capture':
				await capture(op.screen, await state());
				break;
			default:
				throw new ScriptError(`step ${i + 1}: unknown op "${op.op}"`);
		}
		if (trace) trace(i, op, await state());
	}
}
