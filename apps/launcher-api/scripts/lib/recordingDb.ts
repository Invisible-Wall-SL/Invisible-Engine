import { getTableName, type SQL } from 'drizzle-orm';
import { PgDialect, type PgTable } from 'drizzle-orm/pg-core';

/**
 * A stand-in for the launcher's Drizzle client that answers nothing and RECORDS everything: each
 * query is one entry — its kind, its table and every builder call with its arguments, in order. A
 * check reads the log to see what a route or helper did to the database (which tables it read, which
 * rows it wrote, the condition a write was limited to) without a database.
 *
 * Every query resolves to the rows `answer` returns for it (none by default), so a read finds
 * nothing and a write succeeds.
 */
export interface DbCall {
	op: 'select' | 'insert' | 'update' | 'delete';
	table: string;
	calls: [method: string, args: unknown[]][];
}

export type Answer = (call: DbCall) => unknown[];

const dialect = new PgDialect();

/** A Drizzle condition as `{ sql, params }`, rendered by Drizzle's own Postgres dialect. */
export function renderSql(condition: unknown): { sql: string; params: unknown[] } {
	return dialect.sqlToQuery(condition as SQL);
}

export function recordingDb(answer: Answer = () => []) {
	const log: DbCall[] = [];

	const query = (op: DbCall['op'], table: PgTable): unknown => {
		const call: DbCall = { op, table: getTableName(table), calls: [] };
		log.push(call);
		const builder: object = new Proxy(
			{},
			{
				get(_, method) {
					if (method === 'then') {
						return (resolve: (rows: unknown[]) => void, reject: (e: unknown) => void) =>
							Promise.resolve()
								.then(() => answer(call))
								.then(resolve, reject);
					}
					return (...args: unknown[]) => {
						call.calls.push([String(method), args]);
						return builder;
					};
				},
			},
		);
		return builder;
	};

	const db = {
		select: () => ({ from: (table: PgTable) => query('select', table) }),
		insert: (table: PgTable) => query('insert', table),
		update: (table: PgTable) => query('update', table),
		delete: (table: PgTable) => query('delete', table),
	};
	return { db, log };
}

/** The arguments of the first `method` call a query made, or `undefined`. */
export function argsOf(call: DbCall, method: string): unknown[] | undefined {
	return call.calls.find(([m]) => m === method)?.[1];
}
