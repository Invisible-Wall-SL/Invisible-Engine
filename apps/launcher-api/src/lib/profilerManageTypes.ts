/** What `/api/profiler/manage` and the page share: the rows it acts on and a refused delete. */
export type RowType = 'reading' | 'build';

export interface Refusal {
	id: string;
	reason: string;
}
