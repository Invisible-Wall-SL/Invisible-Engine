/**
 * Offline fixture for the default-HUD fallback (§ default-HUD initiative).
 *
 * Proves `normalizeHudScenes` rewrites a legacy coded-`bind` `hudBar` (the seeded
 * `UiLabel*`/`UiButton*` nodes — what every pre-parametric project, e.g. Test2, has)
 * into the parametric `componentInstance` HUD that renders under a flow-v2-driven game,
 * WHILE:
 *   - preserving each node's transform byte-for-byte (id / x / y / anchor / scale / overrides),
 *   - mapping labels → `hudReadout` (balance/win/bet, `countUp` only for win) and buttons →
 *     `button` (action + icon; spin has no icon), and
 *   - being a strict no-op (SAME object returned) for a doc already parametric or with no `hudBar`
 *     (parity: new projects + fully-authored `hud_*` HUDs are untouched).
 *
 * Runs against the REAL reference layout (`referenceLayouts/hud.ts`) and the REAL normalizer, so
 * the fixture can't drift from what ships.
 *
 * Run: node_modules/.bin/tsx scripts/verify-hud-fallback.mts
 */

import { normalizeHudScenes } from '../packages/engine-layout/src/lib/normalizeHudScenes';
import { hudBarScene } from '../packages/engine-layout/src/lib/referenceLayouts/hud';
import type { ComponentInstanceNode, LayoutDoc, Scene } from '../packages/engine-layout/src/lib/types';

let failures = 0;
const assert = (label: string, got: unknown, want: unknown) => {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
};

const docWith = (bar: Scene): LayoutDoc =>
	({
		version: 1,
		projectKey: 'fixture',
		mainSizesMap: {},
		scenes: [{ id: 'basegame', name: 'Base', nodes: [] }, bar],
		updatedAt: '',
	}) as unknown as LayoutDoc;

// --- 1. Legacy coded-bind HUD (default reference) → fully parametric ---
const legacyBar = hudBarScene(); // default = coded UiLabel*/UiButton* bind nodes
const legacyDoc = docWith(legacyBar);
const out = normalizeHudScenes(legacyDoc);
const outBar = out.scenes.find((s) => s.id === 'hudBar')!;

assert('a legacy hudBar produces a NEW doc object', out !== legacyDoc, true);
assert(
	'every hudBar node is now a componentInstance',
	outBar.nodes.every((n) => n.kind === 'componentInstance'),
	true,
);
assert('the non-hud scene is left untouched (same ref)', out.scenes[0] === legacyDoc.scenes[0], true);

const byId = (bar: Scene, id: string) => bar.nodes.find((n) => n.id === id)!;
const outNode = (id: string) => byId(outBar, id) as ComponentInstanceNode;

// Label mapping — source + countUp
assert('balance → hudReadout/balance, no count-up', {
	c: outNode('hud-balance').componentId,
	source: outNode('hud-balance').params?.source,
	countUp: outNode('hud-balance').params?.countUp,
}, { c: 'hudReadout', source: 'balance', countUp: false });
assert('win → hudReadout/win, count-up ON', {
	c: outNode('hud-win').componentId,
	source: outNode('hud-win').params?.source,
	countUp: outNode('hud-win').params?.countUp,
}, { c: 'hudReadout', source: 'win', countUp: true });
assert('bet → hudReadout/bet, no count-up', {
	source: outNode('hud-bet').params?.source,
	countUp: outNode('hud-bet').params?.countUp,
}, { source: 'bet', countUp: false });

// Button mapping — action + icon (spin has NONE)
assert('menu → button/menu icon', {
	c: outNode('hud-btn-menu').componentId,
	action: outNode('hud-btn-menu').params?.action,
	icon: outNode('hud-btn-menu').params?.icon,
}, { c: 'button', action: 'menu', icon: 'menu' });
assert('spin (UiButtonBet) → button/spin, NO icon', {
	action: outNode('hud-btn-bet').params?.action,
	icon: outNode('hud-btn-bet').params?.icon ?? null,
}, { action: 'spin', icon: null });

// Config-feature visibility gate — turbo / auto-spin carry it, the rest don't (parity with the
// coded `UIDefault` `{#if config.features.*}` wraps, so a disabled feature hides its button).
assert('turbo → visibleSource turboFeature', outNode('hud-btn-turbo').params?.visibleSource, 'turboFeature');
assert('autoSpin → visibleSource autoplayFeature', outNode('hud-btn-autospin').params?.visibleSource, 'autoplayFeature');
assert('menu → no visibleSource', outNode('hud-btn-menu').params?.visibleSource ?? null, null);

// Transform preservation — the converted node lands byte-for-byte where the coded one sat.
for (const id of ['hud-balance', 'hud-btn-menu', 'hud-btn-increase']) {
	const src = byId(legacyBar, id);
	const dst = byId(outBar, id);
	assert(`${id} transform preserved`, {
		x: dst.x, y: dst.y, anchor: dst.anchor, scale: dst.scale, overrides: dst.overrides, preview: dst.preview,
	}, {
		x: src.x, y: src.y, anchor: src.anchor, scale: src.scale, overrides: src.overrides, preview: src.preview,
	});
}

// --- 2. Already-parametric HUD → strict no-op (parity for new projects) ---
const paramDoc = docWith(hudBarScene({ readouts: true, buttons: true }));
assert('parametric hudBar is a strict no-op (same ref)', normalizeHudScenes(paramDoc) === paramDoc, true);

// --- 3. No hudBar scene → strict no-op ---
const noHudDoc = docWith({ id: 'other', name: 'Other', nodes: [] });
// (docWith names the 2nd scene 'other' here via bar arg id, so there's no hudBar)
assert('a doc with no hudBar is a strict no-op (same ref)', normalizeHudScenes(noHudDoc) === noHudDoc, true);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
