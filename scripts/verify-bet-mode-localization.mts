/**
 * Offline fixture for the buy-feature-card localization gap.
 *
 * The cards' title/description/button live in Invisible Game Config (`betModePresentation`), NOT in
 * a scene: one `featureCard` def whose text nodes bind `engineProvided` params, fed a different
 * string per mode by the repeater at runtime. The Localization tool's scene walk deliberately skips
 * `engineProvided` binds, so this copy was never harvested and stayed English in every locale.
 *
 * Proves, against the REAL collectors:
 *   Part 1 — `harvestBetModeText` emits every rendered bet-mode string (incl. the derived `BUY`
 *            default) as a source-as-key row, and emits nothing a player never sees.
 *   Part 2 — the scene walk still does NOT see them (i.e. Part 1 is load-bearing, not a duplicate).
 *   Part 3 — a translated+reviewed row keys the runtime catalog by the SAME literal the card renders,
 *            so `resolveLocalizedText(title)` hits.
 *
 * Run: node_modules/.bin/tsx scripts/verify-bet-mode-localization.mts
 */

import type { GameConfigDoc } from '../packages/game-config/src/types';
import {
	harvestBetModeText,
	harvestSceneText,
	harvestUiText,
} from '../apps/launcher-api/src/lib/server/localizationHarvest';
import { UI_INFO_RULES, UI_TEXT } from '../packages/engine-layout/src/lib/uiText';
import { FEATURE_CARD_DEF } from '../packages/engine-layout/src/lib/builtinComponents';
import type { LayoutDoc } from '../packages/engine-layout/src/lib/types';

let failures = 0;
const assert = (label: string, got: unknown, want: unknown) => {
	const ok = got === want;
	if (!ok) failures += 1;
	console.log(
		`${ok ? 'PASS' : 'FAIL'}  ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`,
	);
};

/** A Borut-shaped config: a base mode + three buy modes, exactly the screenshot's three cards. */
const config = {
	version: 1,
	providerName: 'invisible',
	gameName: 'Fixture',
	gameID: 'fixture',
	rtp: 0.96,
	numReels: 5,
	numRows: [3, 3, 3, 3, 3],
	betModes: {
		base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: 5000 },
		bonus: { cost: 25, feature: true, buyBonus: true, rtp: 0.96, max_win: 5000 },
		bullchase: { cost: 50, feature: true, buyBonus: true, rtp: 0.96, max_win: 5000 },
		goldrush: { cost: 100, feature: true, buyBonus: true, rtp: 0.96, max_win: 5000 },
	},
	betModePresentation: {
		bonus: {
			text: {
				title: 'High Noon Spin',
				description: 'Shoot your way through 10 free spins.',
				button: 'BUY FEATURE',
				dialog: 'Buy High Noon Spin?',
			},
		},
		bullchase: {
			text: {
				title: 'Bull Chase',
				description: 'Chase your way around 10 free spins.',
				button: 'BUY FEATURE',
			},
		},
		// Deliberately half-authored: no `button`, so the DERIVED default ("BUY") must still harvest —
		// an unauthored default is copy the player reads just the same.
		goldrush: { text: { title: 'Gold Rush', description: 'Rush your way around 10 free spins.' } },
		// A base-mode badge: shown on the HUD bet readout for the ACTIVE mode, base included.
		base: { text: { betAmountLabel: 'TOTAL BET' } },
	},
	paylines: {},
	symbols: {},
	paddingReels: {},
} as unknown as GameConfigDoc;

// ── Part 1 — the harvest ────────────────────────────────────────────────────────────────────────
const [section] = harvestBetModeText(config);
const keys = section?.items.map((i) => i.key) ?? [];

assert('section id', section?.sceneId, '__betModes');
assert('section origin (read-only, config-owned)', section?.origin, 'gameConfig');
for (const want of [
	'High Noon Spin',
	'Bull Chase',
	'Gold Rush',
	'Shoot your way through 10 free spins.',
	'Chase your way around 10 free spins.',
	'Rush your way around 10 free spins.',
	'BUY FEATURE',
	'Buy High Noon Spin?',
	'TOTAL BET',
]) {
	assert(`harvested "${want}"`, keys.includes(want), true);
}
// The derived default a config never typed still renders on the card ⇒ still translatable.
assert('harvested the DERIVED button default', keys.includes('BUY'), true);
// Source-as-key: the row's key IS the literal the card renders (no trim, no re-keying).
assert(
	'source-as-key',
	section?.items.every((i) => i.key === i.source),
	true,
);
// Deduped: two modes share "BUY FEATURE" ⇒ one row, one translation.
assert('deduped shared string', keys.filter((k) => k === 'BUY FEATURE').length, 1);
// The base mode has no card and no dialog — its title default ("BASE") must never become a row.
assert('no base-mode title row', keys.includes('BASE'), false);
// An unauthored description resolves to '' ⇒ never a row.
assert('no empty rows', keys.includes(''), false);
// An unconfigured project harvests nothing rather than throwing.
assert('null config ⇒ no section', harvestBetModeText(null).length, 0);

// ── Part 2 — the scene walk genuinely cannot see this copy ───────────────────────────────────────
// A scene that mounts the real `featureCard`: the walk resolves the def, but every text node binds
// an `engineProvided` param, so it harvests NOTHING. This is why Part 1 has to exist.
const sceneDoc = {
	version: 1,
	scenes: [
		{
			id: 'buyFeature',
			name: 'Buy feature',
			nodes: [
				{
					id: 'card',
					kind: 'componentInstance',
					x: 0,
					y: 0,
					componentId: FEATURE_CARD_DEF.id,
					params: {},
				},
			],
		},
	],
} as unknown as LayoutDoc;
const sceneSections = await harvestSceneText(sceneDoc, async (id) =>
	id === FEATURE_CARD_DEF.id ? FEATURE_CARD_DEF : undefined,
);
const sceneKeys = sceneSections.flatMap((s) => s.items.map((i) => i.key));
assert('scene walk does NOT see the card title', sceneKeys.includes('High Noon Spin'), false);
assert('scene walk does NOT see the card button', sceneKeys.includes('BUY FEATURE'), false);

// ── Part 3 — the catalog key matches what the card renders ───────────────────────────────────────
// The runtime resolver (`registerTextResolver` in editor-scenes.ts) looks the catalog up by the
// FINAL string a text node renders — here the repeater's `title` value, verbatim from the config.
// Reproduce that lookup against a catalog built the way `loadLocalizationMessages` builds it.
const catalog: Record<string, string> = {};
for (const item of section?.items ?? []) {
	catalog[item.key] = `fr:${item.source}`; // stand-in for a reviewed French translation
}
const resolve = (text: string): string => catalog[text] ?? text;
const renderedTitle = config.betModePresentation!.bonus.text!.title!;
assert('card title resolves', resolve(renderedTitle), 'fr:High Noon Spin');
assert('card button resolves', resolve('BUY FEATURE'), 'fr:BUY FEATURE');
assert('unknown string renders verbatim', resolve('$1.00'), '$1.00');

// -- Part 4 -- the engine's coded UI chrome ------------------------------------------------------
// HUD captions, menus, modals and the info page's rules all render through `translate()`, but the
// tool never listed them -- so they were untranslatable for any language the code catalogs (en/zh
// only) don't ship. Harvested from the SAME registry `i18nDerived` reads, so it cannot drift.
const [uiSection] = harvestUiText();
const uiKeys = uiSection?.items.map((i) => i.key) ?? [];
assert('ui section id', uiSection?.sceneId, '__uiText');
assert('ui section origin', uiSection?.origin, 'uiText');
for (const want of [
	UI_TEXT.balance,
	UI_TEXT.win,
	UI_TEXT.bet,
	UI_TEXT.confirm,
	UI_TEXT.cancel,
	UI_TEXT.buyBonus,
	UI_TEXT.freeSpins,
	UI_TEXT.autoSpins,
	UI_TEXT.settings,
	UI_TEXT.insufficientFunds,
]) {
	assert(`ui harvested "${want.slice(0, 28)}"`, uiKeys.includes(want), true);
}
// The info page's rules copy travels with them.
assert('ui harvested a rule heading', uiKeys.includes(UI_INFO_RULES[0].heading), true);
assert('ui harvested a rule body', uiKeys.includes(UI_INFO_RULES[0].body), true);
// Source-as-key, deduped (SETTINGS is both a menu entry and the modal title), and no junk rows:
// `-`/`+` carry no letter, so they are dropped like every other non-prose string.
assert(
	'ui source-as-key',
	uiSection?.items.every((i) => i.key === i.source),
	true,
);
assert('ui deduped', uiKeys.length, new Set(uiKeys).size);
assert('ui drops non-prose', uiKeys.includes('-') || uiKeys.includes('+'), false);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
