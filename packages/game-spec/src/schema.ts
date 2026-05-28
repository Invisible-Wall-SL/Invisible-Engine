import { z } from 'zod';

/**
 * Game Spec — the single authoring document for a game's frontend.
 *
 * It captures the AUTHORING decisions (type, grid, symbols, paylines, bet
 * modes, layout, UI features, theme, info-page rules, locales, art) in one
 * validated file. The CLI generates / syncs the engine files from it
 * (game/config.ts, game/infoManifest.ts, theme tokens, Lingui catalogs), so
 * the engine itself stays unchanged and the Spec is the source of truth.
 *
 * Draft v1 — line-type games are fully covered; ways/cluster/scatter win
 * definitions are flagged below and will get their own typed sections.
 */

// Mirror packages/config-lingui locales.
export const LocaleSchema = z.enum([
	'ar', 'de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'pl', 'pt', 'ru', 'tr', 'vi', 'zh', 'fi', 'hi',
]);
export type Locale = z.infer<typeof LocaleSchema>;

// Mechanic / template the game starts from.
export const GameTypeSchema = z.enum(['lines', 'ways', 'cluster', 'scatter', 'bookOf']);

// Symbol role — drives engine behaviour AND info-page rendering.
export const SymbolKindSchema = z.enum([
	'high', 'low', 'wild', 'scatter', 'wildScatter', 'bonus', 'multiplier',
]);

export const SymbolAssetSchema = z.object({
	type: z.enum(['sprite', 'spine']),
	key: z.string(), // resolved from the loaded asset cache (e.g. 'h1.webp', 'M')
	animation: z.string().optional(), // for spine
	sizeRatios: z.object({ width: z.number(), height: z.number() }).default({ width: 1, height: 1 }),
});

export const SymbolSpecSchema = z.object({
	id: z.string(), // 'H1' | 'L1' | 'W' | 'S' …
	kind: SymbolKindSchema,
	name: z.string().optional(), // display name (also an i18n key)
	// pay multipliers keyed by match count, e.g. { '5': 5000, '4': 1000, '3': 100, '2': 10 }
	pay: z.record(z.string(), z.number()).optional(),
	asset: SymbolAssetSchema.optional(),
	// scatter/bonus may trigger a feature
	trigger: z.string().optional(),
});

export const BetModeSchema = z.object({
	key: z.string(), // 'base' | 'bonus' | 'ante' …
	type: z.enum(['default', 'activate', 'buy']),
	costMultiplier: z.number().default(1),
	feature: z.boolean().default(false),
	buyBonus: z.boolean().default(false),
	rtp: z.number().optional(),
	maxWin: z.number().optional(),
});

const SizesSchema = z.object({ width: z.number(), height: z.number() });
export const LayoutSchema = z
	.object({
		// reference sizes per device (mirror createLayout mainSizesMap)
		desktop: SizesSchema,
		landscape: SizesSchema,
		portrait: SizesSchema,
		tablet: SizesSchema,
	})
	.partial();

export const UiSchema = z.object({
	family: z.enum(['default']).default('default'),
	buyBonus: z.boolean().default(false),
	autoSpin: z.boolean().default(true),
	turbo: z.boolean().default(true),
	gamble: z.boolean().default(false),
});

export const ThemeSchema = z
	.object({
		fontFamily: z.string(),
		titleColor: z.number(), // 0xRRGGBB
		textColor: z.number(),
		accentColor: z.number(),
		dimColor: z.number(),
		dimAlpha: z.number(),
	})
	.partial();

export const InfoRuleSchema = z.object({ heading: z.string(), body: z.string() });

export const I18nSchema = z.object({
	sourceLocale: LocaleSchema.default('en'),
	locales: z.array(LocaleSchema).default(['en']),
});

// Art generation (step E — ComfyUI). Either a prompt to generate, or a file.
const ArtRefSchema = z.object({ prompt: z.string().optional(), file: z.string().optional() }).partial();
export const AssetsSchema = z
	.object({ background: ArtRefSchema, title: ArtRefSchema, symbols: z.record(z.string(), ArtRefSchema) })
	.partial();

export const GameSpecSchema = z
	.object({
		specVersion: z.literal(1),
		meta: z.object({
			id: z.string(), // '0_0_bookofborut'
			name: z.string(), // 'Book of Borut'
			provider: z.string(),
			client: z.string().optional(),
			version: z.string().default('0.0.0'),
		}),
		type: GameTypeSchema,
		grid: z.object({
			reels: z.number().int(),
			rows: z.array(z.number().int()), // per-reel rows, e.g. [3,3,3,3,3]
		}),
		bet: z.object({
			modes: z.array(BetModeSchema).nonempty(),
			numLines: z.number().int().optional(), // line games
			denominations: z.array(z.number()).optional(),
		}),
		symbols: z.array(SymbolSpecSchema).nonempty(),
		// line games: row index per reel, e.g. [[1,1,1,1,1],[0,0,0,0,0], …]
		paylines: z.array(z.array(z.number().int())).optional(),
		// TODO ways/cluster/scatter: add a typed `win` section (ways count,
		// cluster min-size, scatter-anywhere) instead of paylines.
		layout: LayoutSchema.optional(),
		ui: UiSchema.default({}),
		theme: ThemeSchema.default({}),
		info: z.object({ rules: z.array(InfoRuleSchema).default([]) }).default({ rules: [] }),
		i18n: I18nSchema.default({}),
		assets: AssetsSchema.optional(),
	})
	.strict();

export type GameSpec = z.infer<typeof GameSpecSchema>;

/** Parse + validate an unknown value into a GameSpec (throws on error). */
export const parseGameSpec = (value: unknown): GameSpec => GameSpecSchema.parse(value);
