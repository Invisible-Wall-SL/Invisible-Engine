import type { GameSpec } from '../src/schema';

/**
 * Example Game Spec for Book of Thermopylae / Borut, built from the existing
 * apps/Borut config + infoManifest. Shows how the current data maps onto the
 * authoring Spec. This is the kind of file the Studio UI edits and the CLI
 * turns into game/config.ts + game/infoManifest.ts + Lingui catalogs.
 */
export const bookOfThermopylae: GameSpec = {
	specVersion: 1,
	meta: {
		id: '0_0_bookofborut',
		name: 'Book of Thermopylae',
		provider: 'play4fun',
		client: 'borut',
		version: '0.0.0',
	},
	type: 'bookOf',
	grid: { reels: 5, rows: [3, 3, 3, 3, 3] },
	bet: {
		modes: [
			{ key: 'base', type: 'default', costMultiplier: 1, feature: true, buyBonus: false, rtp: 0.96, maxWin: 10000 },
			{ key: 'bonus', type: 'buy', costMultiplier: 100, feature: false, buyBonus: true, rtp: 0.96, maxWin: 10000 },
		],
		numLines: 10,
	},
	symbols: [
		{ id: 'H1', kind: 'high', pay: { '5': 5000, '4': 1000, '3': 100, '2': 10 } },
		{ id: 'H2', kind: 'high', pay: { '5': 2000, '4': 400, '3': 30, '2': 10 } },
		{ id: 'H3', kind: 'high', pay: { '5': 750, '4': 100, '3': 30, '2': 5 } },
		{ id: 'H4', kind: 'high', pay: { '5': 750, '4': 100, '3': 20, '2': 5 } },
		{ id: 'L1', kind: 'low', pay: { '5': 150, '4': 50, '3': 5 } },
		{ id: 'L2', kind: 'low', pay: { '5': 150, '4': 50, '3': 5 } },
		{ id: 'L3', kind: 'low', pay: { '5': 100, '4': 20, '3': 5 } },
		{ id: 'L4', kind: 'low', pay: { '5': 100, '4': 20, '3': 5 } },
		{ id: 'L5', kind: 'low', pay: { '5': 100, '4': 20, '3': 5 } },
		// The Book: scatter + wild; pays anywhere on the total bet, triggers free spins.
		{ id: 'S', kind: 'wildScatter', pay: { '5': 200, '4': 20, '3': 2 }, trigger: 'feature' },
	],
	paylines: [
		[1, 1, 1, 1, 1],
		[0, 0, 0, 0, 0],
		[2, 2, 2, 2, 2],
		[0, 1, 2, 1, 0],
		[2, 1, 0, 1, 2],
		[0, 0, 1, 2, 2],
		[2, 2, 1, 0, 0],
		[1, 2, 2, 2, 1],
		[1, 0, 0, 0, 1],
		[1, 0, 1, 2, 1],
	],
	ui: { family: 'default', buyBonus: true, autoSpin: true, turbo: true, gamble: false },
	theme: { fontFamily: 'proxima-nova', accentColor: 0xffd24a },
	info: {
		rules: [
			{
				heading: 'THE BOOK — WILD & SCATTER',
				body: 'The Book is paid anywhere on the reels and substitutes for all symbols. Landing 3 or more Books triggers the Freespins Bonus.',
			},
			{
				heading: 'FREESPINS BONUS',
				body: 'Awards 10 free spins with a special Mystery Symbol. Before the spins begin, the Book opens to reveal which symbol becomes the Mystery Symbol for the whole bonus.',
			},
			{
				heading: 'MYSTERY SYMBOL',
				body: 'During free spins, line wins are paid normally first; then the Mystery Symbol expands to cover every reel where it appears and pays on all lines, as long as it lands enough times for a win.',
			},
			{
				heading: 'PAYLINES & BET',
				body: '10 fixed paylines. Line wins pay left to right on adjacent reels. Total bet = bet per line × 10.',
			},
			{
				heading: 'MAX WIN',
				body: 'The maximum win is 10,000× the bet. If a round reaches the cap it ends immediately and the win is awarded up to the cap.',
			},
		],
	},
	i18n: {
		sourceLocale: 'en',
		locales: ['ar', 'de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'pl', 'pt', 'ru', 'tr', 'vi', 'zh', 'fi', 'hi'],
	},
	assets: {
		background: { prompt: 'epic ancient Greek battlefield at the Gates of Fire, Thermopylae, dramatic dusk, cinematic' },
		title: { prompt: 'ornate golden game logo "Book of Thermopylae", Spartan helmet, fire embers' },
	},
};
