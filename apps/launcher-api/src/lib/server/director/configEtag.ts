/**
 * What a run records of its template's math (`director_runs.template_config_etag`), the lock QA
 * proves unchanged (ADR-0010). Three meanings in one text column:
 *  - an ETag: the template's `config/config.json`, the same before and after the copy;
 *  - {@link NO_CONFIG}: it had none, before and after (the kind's committed config is the math);
 *  - null: it moved while being copied, or was never recorded. QA fails the run.
 */
export const NO_CONFIG = 'none';

interface ConfigRead {
	etag: string | null;
	existed: boolean;
}

/** The value to record from the template's config read before the copy and after it. */
export function templateConfigRecord(before: ConfigRead, after: ConfigRead): string | null {
	if (!before.existed && !after.existed) return NO_CONFIG;
	return before.etag !== null && before.etag === after.etag ? before.etag : null;
}
