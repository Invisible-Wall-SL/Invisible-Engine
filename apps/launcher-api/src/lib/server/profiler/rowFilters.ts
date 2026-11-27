import { and, eq, gte, isNull, lt, ne } from 'drizzle-orm';
import { perfBuilds, perfReports } from '../db/schema';

/**
 * The conditions the Profiler's lists and send-dedupe read rows by, apart from the stores so
 * `scripts/check-profiler-archive.ts` can render them (the stores import R2 and the games).
 */

/** The readings a page lists: not claimed by the purge, and not archived unless asked for. */
export const listedReports = (projectKey: string, archived: boolean) =>
	and(
		eq(perfReports.projectKey, projectKey),
		isNull(perfReports.purgingAt),
		archived ? undefined : isNull(perfReports.archivedAt),
	);

export const listedBuilds = (projectKey: string, archived: boolean) =>
	and(
		eq(perfBuilds.projectKey, projectKey),
		isNull(perfBuilds.purgingAt),
		archived ? undefined : isNull(perfBuilds.archivedAt),
	);

/** Readings of the same window (`sendKey`) of the same capture session, or the same no-session. */
const sameWindow = (projectKey: string, sendKey: string, session: string | null) =>
	and(
		eq(perfReports.projectKey, projectKey),
		eq(perfReports.sendKey, sendKey),
		session ? eq(perfReports.session, session) : isNull(perfReports.session),
		isNull(perfReports.purgingAt),
	);

/** A stored send of the window holding at least `frames`: what a later, no fuller send is. */
export const fullerSendOf = (
	projectKey: string,
	sendKey: string,
	session: string | null,
	frames: number,
) => and(sameWindow(projectKey, sendKey, session), gte(perfReports.sendFrames, frames));

/**
 * The sends of the window SHORTER than the one just stored: what it replaces. Strictly shorter, so
 * two sends racing past the stored-send check can each replace only the other's shorter one — never
 * the fuller; a tie stays (and the list folds it, `profilerDedupe.ts`).
 */
export const earlierSendsOf = (
	projectKey: string,
	sendKey: string,
	session: string | null,
	except: string,
	frames: number,
) =>
	and(
		sameWindow(projectKey, sendKey, session),
		ne(perfReports.id, except),
		lt(perfReports.sendFrames, frames),
	);
