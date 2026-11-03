/** The scanner's `[label, regex]` pairs: a vendor prefix, a well-known variable name, or both. */
export declare const PATTERNS: readonly (readonly [string, RegExp])[];
/** Whether the scanner never reads a file (binaries, lockfiles, itself, `.env.example`). */
export declare function skipFile(file: string): boolean;
/** The label of the first pattern a line matches, or null (the allowlist pragma and placeholders pass). */
export declare function scanLine(line: string): string | null;
/** Findings for a whole file's content. */
export declare function scanContent(
	file: string,
	content: string,
): { file: string; line: number; label: string }[];
