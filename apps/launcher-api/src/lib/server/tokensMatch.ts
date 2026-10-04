import { createHash, timingSafeEqual } from 'node:crypto';

/** Constant-time secret comparison over equal-length digests, so the time taken does not depend
 *  on how much of the presented value matched or on its length. */
export function tokensMatch(presented: string, configured: string): boolean {
	const digest = (value: string) => createHash('sha256').update(value).digest();
	return timingSafeEqual(digest(presented), digest(configured));
}
