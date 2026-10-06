/** The recognized commit scopes. */
export declare const SCOPES: readonly string[];
/** A scoped subject: `scope: …`, `scope(detail): …` or `scope!: …`. */
export declare const SUBJECT_RE: RegExp;
/** A scoped subject, or a machinery one (merge, revert, fixup!/squash!/amend!) the hook skips. */
export declare function subjectHasScope(subject: string): boolean;
