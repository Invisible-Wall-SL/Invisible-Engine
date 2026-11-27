import type { ReportFacts } from '$lib/profilerFindings/facts';
import { redactReportText, redactValue, type NetworkSummary } from '$lib/profilerNetwork';

/**
 * The one-off clean of readings kept before the launcher redacted route tokens on receipt
 * (`profilerNetwork.ts` `redactReportText`, #1949): a `perf: 9` reading's network block could carry
 * a published game's read token in a file path. Each such reading's R2 file is rewritten with its
 * tokens read `…`, and so are its row's `network` and `facts`. Idempotent: a clean reading is left
 * exactly as it is, so a second pass, or two instances at once, only re-read. Pure over a store, so
 * `check:profiler` runs it on a fake one.
 */
export interface ScrubRow {
	id: string;
	r2Key: string;
	network: NetworkSummary | null;
	facts: ReportFacts | null;
}

export interface TokenScrubStore {
	/** Readings that can hold a network block, by id after `afterId`, `limit` at most. */
	rows(afterId: string | null, limit: number): Promise<ScrubRow[]>;
	read(key: string): Promise<{ text: string; etag: string | null } | null>;
	/** Writes only while the file is the one read; false when it changed or went (a purge). */
	write(key: string, text: string, etag: string | null): Promise<boolean>;
	updateRow(
		id: string,
		set: { network?: NetworkSummary | null; facts?: ReportFacts | null },
	): Promise<void>;
}

export interface TokenScrubResult {
	scanned: number;
	files: number;
	rows: number;
	/** Files that changed or went while read, or a file or row that failed: left for the next pass. */
	skipped: number;
}

const PAGE = 200;

const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);

export async function scrubStoredReadings(store: TokenScrubStore): Promise<TokenScrubResult> {
	const result: TokenScrubResult = { scanned: 0, files: 0, rows: 0, skipped: 0 };
	let after: string | null = null;
	for (;;) {
		const page = await store.rows(after, PAGE);
		for (const row of page) {
			result.scanned += 1;
			try {
				const file = await store.read(row.r2Key);
				if (file) {
					const clean = redactReportText(file.text);
					if (clean !== file.text) {
						if (await store.write(row.r2Key, clean, file.etag)) result.files += 1;
						else result.skipped += 1;
					}
				}
			} catch {
				result.skipped += 1;
			}
			try {
				// Only strings change, so each column keeps its shape.
				const network = redactValue(row.network) as NetworkSummary | null;
				const facts = redactValue(row.facts) as ReportFacts | null;
				const set = {
					...(changed(network, row.network) ? { network } : {}),
					...(changed(facts, row.facts) ? { facts } : {}),
				};
				if (Object.keys(set).length) {
					await store.updateRow(row.id, set);
					result.rows += 1;
				}
			} catch {
				result.skipped += 1;
			}
			// An 8 MB report is parsed and written whole: let the launcher's requests in between.
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
		if (page.length < PAGE) return result;
		after = page[page.length - 1].id;
	}
}
