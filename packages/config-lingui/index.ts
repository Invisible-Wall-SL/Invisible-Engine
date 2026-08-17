import type { LinguiConfig } from "@lingui/conf";

/**
 * Locales a game MAY be shipped in — the single source of truth for the runtime
 * `Language` type (`state-shared/stateUrl`) and the Game Spec's `LocaleSchema`.
 *
 * Declaring a locale is cheap and has no runtime cost: the game picks one via
 * `?lang=xx`, and a locale with no catalogue simply falls back to `en`
 * (`LoadI18n.svelte`). So this list is deliberately broader than any single
 * title — each game translates only the subset it sells into.
 *
 * ⚠️ Declared ≠ shippable. Before selling a title in a locale, confirm the
 * game's fonts actually carry that script's glyphs — a missing glyph can black
 * the screen (see `docs/` bitmap-font notes), and Arabic/Hebrew/Persian also
 * need RTL layout, which the HUD does not do automatically.
 *
 * Grouped by market below purely for review; the array is one flat list.
 */
export const locales = [
  // Western Europe
  "de", "en", "es", "fr", "it", "nl", "pt",
  // Nordics
  "da", "fi", "is", "no", "sv",
  // Central & Eastern Europe
  "bg", "cs", "el", "hr", "hu", "pl", "ro", "ru", "sk", "sl", "sr", "uk",
  // Baltics
  "et", "lt", "lv",
  // Caucasus & Central Asia
  "az", "hy", "ka", "kk", "uz",
  // Middle East & South Asia
  "ar", "bn", "fa", "he", "hi", "ur",
  // East & South-East Asia
  "id", "ja", "ko", "ms", "th", "tl", "vi", "zh",
  // Africa
  "sw",
  // Türkiye
  "tr",
] as const;

const config: LinguiConfig = {
  fallbackLocales: {
    default: "en",
  },
  "sourceLocale": "en",
  // @ts-ignore string[]
  locales,
};

export default config;
