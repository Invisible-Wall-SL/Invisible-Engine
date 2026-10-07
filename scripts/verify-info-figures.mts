// Offline fixture for the info page's RTP + max-win figures — `game-config`'s `infoPageFigures`
// (which figures, formatted, and the operator's RTP gate) and `engine-layout`'s rules copy
// (`infoRulesWithFigures`, the localization harvest).
//
//   pnpm check:info-figures
//
// WHAT IT PROVES:
//   1. RTP is stated ONLY when the operator allows it (`displayRTP`, from `showTheoreticalPayback`),
//      from the config's `rtp`, else the base mode's; a fraction prints as a percentage;
//   2. the max win comes from the BASE bet mode, not a buy mode, in the game's number format;
//   3. a figure rides BESIDE the heading, so every existing heading and body — and its translations —
//      is untouched, and an unstated figure leaves the page exactly as it was;
//   4. the operator's per-mode paybacks (buy / ante "high chance") and money blocks (bet range,
//      credit value) appear only when their own flag is stated, each after the RTP block;
//   5. free spins OFF, or a trigger other than 3 scatters, drops the SCATTER rule's free-spins
//      promise (a departing trigger also adds a FREE SPINS block, its count and symbol as the
//      figure), while the default leaves the page byte-identical;
//   6. no rules string carries a `{placeholder}`: the i18n resolver compiles a message with no values
//      by BLANKING its placeholders (a first cut shipped "The maximum win is × the total bet" that
//      way), and every new string is harvested for /localization.

import {
	UI_INFO_FREE_SPINS_RULE,
	UI_INFO_OPERATOR_RULES,
	UI_INFO_RULES,
	UI_INFO_RTP_RULE,
	UI_INFO_SCATTER_PAYS_ONLY_BODY,
	UI_TEXT,
	collectUiTextStrings,
	infoRulesWithFigures,
} from '../packages/engine-layout/src/lib/uiText.ts';
import { formatRtp, infoPageFigures } from '../packages/game-config/src/infoFigures.ts';
import type { GameConfigDoc } from '../packages/game-config/src/types.ts';

let failures = 0;
const check = (name: string, ok: boolean, extra = '') => {
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const en = (n: number) => new Intl.NumberFormat('en-US').format(n);
const de = (n: number) => new Intl.NumberFormat('de-DE').format(n);

const doc = (over: Partial<GameConfigDoc> = {}): GameConfigDoc =>
	({
		version: 1,
		providerName: '',
		gameName: '',
		gameID: '',
		rtp: 0.965,
		numReels: 5,
		numRows: [3, 3, 3, 3, 3],
		betModes: {
			bonus: { cost: 100, feature: false, buyBonus: true, rtp: 0.962, max_win: 20000 },
			base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: 5000 },
		},
		paylines: {},
		symbols: {},
		paddingReels: {},
		...over,
	}) as GameConfigDoc;

// --- 1. RTP -------------------------------------------------------------------------------------
{
	check('RTP hidden unless the operator allows it', infoPageFigures(doc(), false, en).rtp === undefined); // prettier-ignore
	check('RTP from the config, as a percentage', infoPageFigures(doc(), true, en).rtp === '96.50%');
	check('no config rtp ⇒ the base mode rtp', infoPageFigures(doc({ rtp: 0 }), true, en).rtp === '96.00%'); // prettier-ignore
	check('a value already in percent is not multiplied', formatRtp(96.2) === '96.20%');
	check('no rtp anywhere ⇒ no RTP figure', infoPageFigures(doc({ rtp: 0, betModes: {} }), true, en).rtp === undefined); // prettier-ignore
}

// --- 2. MAX WIN ----------------------------------------------------------------------------------
{
	check('max win from the BASE mode, not the buy', infoPageFigures(doc(), false, en).maxWin === '5,000'); // prettier-ignore
	check('…in the game locale', infoPageFigures(doc(), false, de).maxWin === '5.000');
	check('no bet modes ⇒ no max-win figure', infoPageFigures(doc({ betModes: {} }), false, en).maxWin === undefined); // prettier-ignore
}

// --- 2b. PER-MODE PAYBACKS ----------------------------------------------------------------------
{
	const withAnte = doc({
		betModes: {
			base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: 5000 },
			bonus: { cost: 100, feature: false, buyBonus: true, rtp: 0.962, max_win: 20000 },
			super: { cost: 200, feature: false, buyBonus: true, rtp: 0.966, max_win: 20000 },
			ante: { cost: 1.25, feature: true, buyBonus: false, rtp: 0.961, max_win: 5000 },
		},
		betModePresentation: { ante: { kind: 'ante' } },
	} as Partial<GameConfigDoc>);
	const none = infoPageFigures(withAnte, true, en);
	check('no gates ⇒ no buy or ante figure', none.buyRtp === undefined && none.anteRtp === undefined); // prettier-ignore
	const both = infoPageFigures(withAnte, false, en, { buy: true, ante: true });
	check('buy RTP spans every buy mode', both.buyRtp === '96.20% – 96.60%', both.buyRtp);
	check('ante RTP from the ante mode', both.anteRtp === '96.10%', both.anteRtp);
	check('…independent of the theoretical-payback gate', both.rtp === undefined);
	const one = infoPageFigures(doc(), false, en, { buy: true });
	check('one buy mode ⇒ one figure', one.buyRtp === '96.20%', one.buyRtp);
	check('an ante gate with no ante mode ⇒ absent', infoPageFigures(doc(), false, en, { ante: true }).anteRtp === undefined); // prettier-ignore
	check('a buy mode with no rtp ⇒ absent', infoPageFigures(doc({ betModes: { base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: 1 }, bonus: { cost: 100, feature: false, buyBonus: true, rtp: 0, max_win: 1 } } } as Partial<GameConfigDoc>), false, en, { buy: true }).buyRtp === undefined); // prettier-ignore
}

// --- 3. THE RULES PAGE ---------------------------------------------------------------------------
{
	check('no figures ⇒ the default rules, untouched', same(infoRulesWithFigures({}), UI_INFO_RULES));
	const rules = infoRulesWithFigures({ rtp: '96.50%', maxWin: '5,000' });
	const maxWin = rules.find((r) => r.heading === 'MAX WIN');
	check('MAX WIN carries the cap beside its heading, × the BET', same(maxWin?.figure, { value: '5,000×', unit: UI_TEXT.bet })); // prettier-ignore
	check('…and keeps its default body, so its translation still applies', maxWin?.body === UI_INFO_RULES[3].body); // prettier-ignore
	check('the RTP block is appended last with its figure', rules.at(-1)?.heading === UI_INFO_RTP_RULE.heading && same(rules.at(-1)?.figure, { value: '96.50%' }) && rules.length === UI_INFO_RULES.length + 1); // prettier-ignore
	check('every other rule is the default, unchanged', same(rules.slice(0, 3), UI_INFO_RULES.slice(0, 3))); // prettier-ignore
	check(
		'the defaults are not mutated',
		UI_INFO_RULES.every((r) => !r.figure),
	);
	const all = infoRulesWithFigures({ rtp: '96.50%', buyRtp: '96.20%', anteRtp: '96.10%', betRange: '€0.20 – €100.00', creditValue: '€0.01' }); // prettier-ignore
	check('operator blocks follow the RTP, in a fixed order', same(all.slice(UI_INFO_RULES.length).map((r) => r.heading), ['RTP', 'BUY FEATURE RTP', 'HIGH CHANCE RTP', 'BET RANGE', 'CREDIT VALUE'])); // prettier-ignore
	check('each operator block carries its figure', same(all.at(-2)?.figure, { value: '€0.20 – €100.00' })); // prettier-ignore
	check('an operator block needs no RTP to appear', same(infoRulesWithFigures({ creditValue: '€0.01' }).at(-1)?.heading, 'CREDIT VALUE')); // prettier-ignore
}

// --- 3b. FREE SPINS ------------------------------------------------------------------------------
{
	const scatterAt = UI_INFO_RULES.findIndex((r) => r.heading === 'SCATTER');
	const figures = { rtp: '96.50%', maxWin: '5,000' };
	check('free spins on (the default) ⇒ the page is unchanged', same(infoRulesWithFigures(figures, { freeSpins: true }), infoRulesWithFigures(figures))); // prettier-ignore
	check('…and the scatter still promises them', infoRulesWithFigures({})[scatterAt].body === UI_INFO_RULES[scatterAt].body && UI_INFO_RULES[scatterAt].body.includes('Free Spins')); // prettier-ignore
	const off = infoRulesWithFigures(figures, { freeSpins: false });
	const on = infoRulesWithFigures(figures);
	check('free spins OFF ⇒ the SCATTER body pays only', off[scatterAt].body === UI_INFO_SCATTER_PAYS_ONLY_BODY && !off[scatterAt].body.includes('Free Spins'), off[scatterAt].body); // prettier-ignore
	check('…and every other rule is untouched', same(off.filter((_r, i) => i !== scatterAt), on.filter((_r, i) => i !== scatterAt))); // prettier-ignore
	check('…with no FREE SPINS block', !off.some((r) => r.heading === UI_INFO_FREE_SPINS_RULE.heading)); // prettier-ignore
	check('…even if a trigger is passed', same(infoRulesWithFigures(figures, { freeSpins: false, freeSpinsTrigger: { count: 4, symbol: 'H1' } }), off)); // prettier-ignore

	const custom = infoRulesWithFigures(figures, { freeSpinsTrigger: { count: 4, symbol: 'H1' } });
	check('a departing trigger ⇒ the SCATTER body pays only', custom[scatterAt].body === UI_INFO_SCATTER_PAYS_ONLY_BODY); // prettier-ignore
	check('…followed by FREE SPINS with the count and symbol as its figure', same(custom[scatterAt + 1], { ...UI_INFO_FREE_SPINS_RULE, figure: { value: '4+ H1' } })); // prettier-ignore
	check('…and the rest in order, one longer', same([...custom.slice(0, scatterAt), ...custom.slice(scatterAt + 2)], on.filter((_r, i) => i !== scatterAt))); // prettier-ignore
	const scatter4 = infoRulesWithFigures({}, { freeSpinsTrigger: { count: 4, symbol: 'S', role: 'scatter' } }); // prettier-ignore
	check('a scatter trigger is named by the translated SCATTER heading', same(scatter4[scatterAt + 1].figure, { value: '4+', unit: 'SCATTER' })); // prettier-ignore
	const wild5 = infoRulesWithFigures({}, { freeSpinsTrigger: { count: 5, symbol: 'W', role: 'wild' } }); // prettier-ignore
	check('…a wild one by the WILD heading', same(wild5[scatterAt + 1].figure, { value: '5+', unit: 'WILD' })); // prettier-ignore
}

// --- 4. TRANSLATION SAFETY + HARVEST -------------------------------------------------------------
{
	const operatorRules = Object.values(UI_INFO_OPERATOR_RULES);
	const strings = [...UI_INFO_RULES, UI_INFO_RTP_RULE, ...operatorRules, UI_INFO_FREE_SPINS_RULE].flatMap((r) => [r.heading, r.body]).concat(UI_INFO_SCATTER_PAYS_ONLY_BODY); // prettier-ignore
	check('no rules string carries a {placeholder} the resolver would blank', strings.every((s) => !/[{}]/.test(s))); // prettier-ignore
	const keys = new Set(collectUiTextStrings().map((s) => s.key));
	check('the RTP heading and body are harvested', keys.has(UI_INFO_RTP_RULE.heading) && keys.has(UI_INFO_RTP_RULE.body)); // prettier-ignore
	check('the figure unit is an already-harvested string', keys.has(UI_TEXT.bet));
	check('every operator block is harvested', operatorRules.every((r) => keys.has(r.heading) && keys.has(r.body))); // prettier-ignore
	check('every default rule stays harvested', UI_INFO_RULES.every((r) => keys.has(r.heading) && keys.has(r.body))); // prettier-ignore
	check('the pays-only SCATTER body is harvested', keys.has(UI_INFO_SCATTER_PAYS_ONLY_BODY));
	check('the FREE SPINS heading and body are harvested', keys.has(UI_INFO_FREE_SPINS_RULE.heading) && keys.has(UI_INFO_FREE_SPINS_RULE.body)); // prettier-ignore
	check('the figure units are already-harvested headings', keys.has('SCATTER') && keys.has('WILD'));
	check('the FREE SPINS heading IS the HUD string, so it shares that translation', UI_INFO_FREE_SPINS_RULE.heading === UI_TEXT.freeSpins); // prettier-ignore
	const fresh = [UI_INFO_FREE_SPINS_RULE.body, UI_INFO_SCATTER_PAYS_ONLY_BODY];
	check('the new rows are appended — every existing row keeps its place', same(collectUiTextStrings().slice(-fresh.length).map((s) => s.key), fresh)); // prettier-ignore
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
