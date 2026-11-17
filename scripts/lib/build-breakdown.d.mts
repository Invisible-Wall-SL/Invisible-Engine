/** The breakdown's schema version (`build-breakdown.json` `version`). */
export declare const BREAKDOWN_VERSION: number;
/** A texture side above this is reported as oversized. */
export declare const MAX_TEXTURE_SIDE: number;
/** Category id → its label. */
export declare const CATEGORY_LABELS: Readonly<Record<string, string>>;
/** Files whose text is scanned for references. */
export declare const SCANNED_EXT: RegExp;
export declare function formatBytes(n: number): string;
/** The breakdown of a finished desktop build (see the `.mjs` for the input's fields). */
export declare function analyzeDesktopBuild(
	input: Record<string, unknown>,
): Record<string, unknown>;
/** One self-contained HTML page — no network — that renders a `build-breakdown.json`. */
export declare function renderBreakdownHtml(breakdown: unknown): string;
