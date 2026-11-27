/**
 * A finding that is already a bug (`docs/design/invisible-profiler.md` §5), as the Findings tab
 * lists it. Pure, so the page's server load and `scripts/check-profiler-archive.ts` run the same
 * function.
 *
 * - A bug follows its finding to a new build: the link stores the finding's `subject` (no build),
 *   so the next build's finding — a new `id` — finds the bug the old one filed. A link filed before
 *   subjects existed matches on its exact id until the page fills its subject in.
 * - A finding whose bug is **open or being fixed** (or closed as won't fix) is "filed": it shows
 *   "Filed: BUG-n (status)" and leaves the default list.
 * - A bug **resolved**, with the finding still firing on a reading or build made after it was
 *   resolved, is **regressed**: back in the list, flagged. A bug resolved while the finding is read
 *   only from older readings is still "filed" — nothing measured since says it is not fixed.
 */

import { BUG_ACTIVE_STATUSES, type BugKind } from '../bugReports';
import type { Finding } from './finding';

export interface FindingLinkRow {
	findingId: string;
	/** Null on a link filed before subjects; matched by `findingId` only. */
	subject: string | null;
	filedAt: string;
	bug: {
		number: number;
		kind: BugKind;
		status: string;
		/** When the status last changed (ISO); null when never set. */
		statusAt: string | null;
	};
}

export type FiledState = 'filed' | 'regressed';

export interface FiledView {
	number: number;
	kind: BugKind;
	status: string;
	state: FiledState;
	/** Left out of the default list: its bug is being dealt with. */
	hidden: boolean;
	/** The link is this very finding id: its bug cannot be filed again (a regressed one is reopened). */
	exact: boolean;
}

const isActive = (status: string) => (BUG_ACTIVE_STATUSES as readonly string[]).includes(status);

/** The link a finding has: its own id first, else the subject's — an active bug before a closed one, then the newest. */
function linkOf(finding: Finding, links: readonly FindingLinkRow[]): FindingLinkRow | undefined {
	const exact = links.find((l) => l.findingId === finding.id);
	if (exact) return exact;
	return links
		.filter((l) => l.subject === finding.subject)
		.sort(
			(a, b) =>
				Number(isActive(b.bug.status)) - Number(isActive(a.bug.status)) ||
				b.filedAt.localeCompare(a.filedAt),
		)[0];
}

/**
 * The filed view of each finding that has a bug, by finding id. `evidenceAt` gives when a reading or
 * build was taken (ISO), by id; one it does not know does not count as newer.
 */
export function filedViews(
	findings: readonly Finding[],
	links: readonly FindingLinkRow[],
	evidenceAt: (ref: { type: 'reading' | 'build'; id: string }) => string | null,
): Record<string, FiledView> {
	const out: Record<string, FiledView> = {};
	for (const finding of findings) {
		const link = linkOf(finding, links);
		if (!link) continue;
		const { bug } = link;
		const base = { number: bug.number, kind: bug.kind, status: bug.status };
		const exact = link.findingId === finding.id;
		if (bug.status !== 'resolved') {
			out[finding.id] = { ...base, state: 'filed', hidden: true, exact };
			continue;
		}
		const since = bug.statusAt ?? link.filedAt;
		const measuredSince = finding.evidence.some((e) => {
			const at = evidenceAt(e);
			return at !== null && at > since;
		});
		out[finding.id] = measuredSince
			? { ...base, state: 'regressed', hidden: false, exact }
			: { ...base, state: 'filed', hidden: true, exact };
	}
	return out;
}

/** The bug that already covers a finding while someone is dealing with it (open or working), if any. */
export function activeBugFor(
	finding: Pick<Finding, 'id' | 'subject'>,
	links: readonly FindingLinkRow[],
): number | null {
	const active = links.filter(
		(l) => isActive(l.bug.status) && (l.findingId === finding.id || l.subject === finding.subject),
	);
	return active.sort((a, b) => b.filedAt.localeCompare(a.filedAt))[0]?.bug.number ?? null;
}
