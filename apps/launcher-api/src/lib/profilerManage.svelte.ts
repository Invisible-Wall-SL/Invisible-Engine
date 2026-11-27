import { askConfirm } from '$lib/dialogs.svelte';
import { PERF_RETENTION_DAYS } from '$lib/profiler';

/**
 * The page side of archiving and deleting readings and build records (`/api/profiler/manage`): the
 * selection, the calls and what they said. One per list, so the header's icon buttons and the
 * table's checkboxes read the same state.
 */

export type RowType = 'reading' | 'build';

export interface Refusal {
	id: string;
	reason: string;
}

interface Answer {
	done?: string[];
	refused?: Refusal[];
	count?: number;
}

export interface ManagedRow {
	id: string;
	archived: boolean;
	/** Unkept and past its 15 days: unarchived, the next daily purge takes it. */
	lapsed: boolean;
}

const WORDS: Record<RowType, [string, string]> = {
	reading: ['reading', 'readings'],
	build: ['build record', 'build records'],
};

async function answerOf(res: Response): Promise<string> {
	const body = (await res.json().catch(() => null)) as { message?: string } | null;
	return body?.message ?? `the launcher answered HTTP ${res.status}`;
}

export class ManagedList {
	/** The ids ticked in the table. */
	selected = $state<string[]>([]);
	busy = $state(false);
	note = $state('');
	error = $state('');
	/** What a Delete refused, and why. */
	refusals = $state<Refusal[]>([]);

	constructor(
		private readonly type: RowType,
		private readonly project: () => string,
		private readonly rows: () => ManagedRow[],
		/** Re-reads the page's data. */
		private readonly refresh: () => Promise<void>,
	) {}

	private word(n: number): string {
		return `${n} ${WORDS[this.type][n === 1 ? 0 : 1]}`;
	}

	/** The ticked rows that are still listed (a reload may have taken some). */
	get ticked(): ManagedRow[] {
		return this.rows().filter((r) => this.selected.includes(r.id));
	}

	isTicked(id: string): boolean {
		return this.selected.includes(id);
	}

	toggle(id: string): void {
		this.selected = this.isTicked(id)
			? this.selected.filter((s) => s !== id)
			: [...this.selected, id];
	}

	get allTicked(): boolean {
		const rows = this.rows();
		return rows.length > 0 && rows.every((r) => this.isTicked(r.id));
	}

	toggleAll(): void {
		this.selected = this.allTicked ? [] : this.rows().map((r) => r.id);
	}

	clear(): void {
		this.selected = [];
	}

	private async call(body: Record<string, unknown>): Promise<Answer> {
		const res = await fetch('/api/profiler/manage', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ project: this.project(), type: this.type, ...body }),
		});
		if (!res.ok) throw new Error(await answerOf(res));
		return (await res.json()) as Answer;
	}

	private async run(work: () => Promise<string>): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		this.note = '';
		this.error = '';
		this.refusals = [];
		try {
			this.note = await work();
			await this.refresh();
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
		} finally {
			this.busy = false;
		}
	}

	archive(ids: string[]): Promise<void> {
		return this.run(async () => {
			const { done = [] } = await this.call({ action: 'archive', ids });
			this.selected = this.selected.filter((s) => !done.includes(s));
			return `Archived ${this.word(done.length)}.`;
		});
	}

	async unarchive(ids: string[]): Promise<void> {
		const lapsed = this.rows().filter((r) => ids.includes(r.id) && r.lapsed).length;
		if (lapsed) {
			const sure = await askConfirm({
				title: `Unarchive ${this.word(ids.length)}`,
				message:
					`${this.word(lapsed)} ${lapsed === 1 ? 'is' : 'are'} older than ${PERF_RETENTION_DAYS} days and not kept: ` +
					`unarchived, the daily purge deletes ${lapsed === 1 ? 'it' : 'them'} tonight. Tick Keep afterwards to pin.`,
				confirmLabel: 'Unarchive',
			});
			if (!sure) return;
		}
		return this.run(async () => {
			const { done = [] } = await this.call({ action: 'unarchive', ids });
			this.selected = this.selected.filter((s) => !done.includes(s));
			return `Unarchived ${this.word(done.length)}.`;
		});
	}

	/** Asks first; the files go with the rows. */
	async remove(ids: string[]): Promise<void> {
		const sure = await askConfirm({
			title: `Delete ${this.word(ids.length)}`,
			message:
				`Deletes ${ids.length === 1 ? 'it' : 'them'} and the file${ids.length === 1 ? '' : 's'} in storage, for good. ` +
				`Archive instead to keep ${ids.length === 1 ? 'it' : 'them'} out of the way.\n` +
				`A ${WORDS[this.type][0]} an open bug cites, or one that is kept, is not deleted: it says why.`,
			confirmLabel: 'Delete',
			danger: true,
		});
		if (!sure) return;
		await this.run(async () => {
			const { done = [], refused = [] } = await this.call({ action: 'delete', ids });
			this.selected = this.selected.filter((s) => !done.includes(s));
			this.refusals = refused;
			return `Deleted ${this.word(done.length)}${refused.length ? `; ${refused.length} not deleted:` : '.'}`;
		});
	}

	/** Everything older than a date, or taken by a probe older than `perfBefore`; asks with the count. */
	async archiveBefore(
		what: { before: string } | { perfBefore: number },
		describe: string,
	): Promise<void> {
		if (this.busy) return;
		let count: number;
		try {
			count = (await this.call({ action: 'count', ...what })).count ?? 0;
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
			return;
		}
		if (!count) {
			this.error = '';
			this.note = `Nothing to archive ${describe}.`;
			return;
		}
		const sure = await askConfirm({
			title: `Archive ${this.word(count)}`,
			message:
				`Archives every ${WORDS[this.type][0]} ${describe} (${count}). They stay stored but leave the lists, ` +
				`verdicts and findings until you Show archived; unarchive brings them back.`,
			confirmLabel: 'Archive',
		});
		if (!sure) return;
		await this.run(async () => {
			const { done = [] } = await this.call({ action: 'archive', ...what });
			return `Archived ${this.word(done.length)} ${describe}.`;
		});
	}
}
