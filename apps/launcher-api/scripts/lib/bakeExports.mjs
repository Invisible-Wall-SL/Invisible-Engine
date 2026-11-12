/**
 * The exports `bake-editor-doc.mjs` POSTs, in order: one per launcher exporter
 * (`src/lib/server/exporters.ts`), each to `/api/editor/export/<asset>`. Kept as plain data in its
 * own module so `check:exporter-registry` can import it beside the registry and prove the two
 * name the same asset classes — a class the launcher exports and the bake never asks for ships
 * online and is missing from every standalone build.
 *
 *   asset   the registry id, and the URL segment.
 *   label   how the log names it: "(dry run) skipping the <label> …", "<Label> failed: HTTP …".
 *   policy  what a failure does:
 *             'required' — anything but a 2xx stops the bake;
 *             'optional' — a 404 (a launcher that predates the exporter) is skipped; anything
 *                          else stops the bake;
 *             'additive' — never stops the bake: a launcher that predates it answers 404, and
 *                          failing every game's build over a feature it does not use is worse
 *                          than building without it. Any other failure is warned about.
 */
export const BAKE_EXPORTS = [
	{ asset: 'art', label: 'editor-art export', policy: 'required' },
	{ asset: 'fonts', label: 'font export', policy: 'required' },
	{ asset: 'sounds', label: 'sound export', policy: 'required' },
	{ asset: 'symbols', label: 'symbols export', policy: 'required' },
	{ asset: 'flow', label: 'flow export', policy: 'required' },
	{ asset: 'boot', label: 'boot splash export', policy: 'additive' },
	{ asset: 'cinematics', label: 'cinematic export', policy: 'additive' },
	{ asset: 'effects', label: 'effects export', policy: 'required' },
	{ asset: 'shaders', label: 'shader export', policy: 'optional' },
	{ asset: 'clips', label: 'clips export', policy: 'required' },
];
