import { sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';

/**
 * Read-only inspector for the launcher's Railway Postgres, powering the admin
 * "Railway" tab of the FTP browser. Only the `public` schema's base tables are
 * exposed, table names are validated against the live catalogue before they ever
 * reach a query, and secret-bearing columns are redacted server-side so a browse
 * can never leak password hashes or live session tokens.
 */

/**
 * Columns whose value is always masked (case-insensitive substring match). This
 * is deny-by-substring, so it's intentionally broad — anything that smells like a
 * credential never reaches the grid. Add patterns here when the schema grows.
 */
const SECRET_COLUMN_PATTERN = /password|secret|hash|token|salt|credential|api_?key/i;

/** Per-table columns to partially mask (hashed/opaque ids — show a short prefix). */
const PARTIAL_MASK: Record<string, Set<string>> = {
	sessions: new Set(['id']),
	login_attempts: new Set(['key']),
};

function redact(table: string, column: string, value: unknown): unknown {
	if (SECRET_COLUMN_PATTERN.test(column)) return value == null ? value : '••••••';
	if (PARTIAL_MASK[table]?.has(column) && typeof value === 'string' && value.length > 8) {
		return `${value.slice(0, 8)}…`;
	}
	return value;
}

/** Coerce a drizzle/postgres-js result into a plain array of row objects. */
function rows<T = Record<string, unknown>>(result: unknown): T[] {
	return Array.from(result as Iterable<T>);
}

/** All base table names in the `public` schema — the only browsable set. */
export async function listTables(): Promise<string[]> {
	const result = await getDb().execute(sql`
		select table_name from information_schema.tables
		where table_schema = 'public' and table_type = 'BASE TABLE'
		order by table_name
	`);
	return rows<{ table_name: string }>(result).map((r) => r.table_name);
}

/** Column names of a public-schema table, in declaration order. */
async function tableColumns(table: string): Promise<string[]> {
	const result = await getDb().execute(sql`
		select column_name from information_schema.columns
		where table_schema = 'public' and table_name = ${table}
		order by ordinal_position
	`);
	return rows<{ column_name: string }>(result).map((r) => r.column_name);
}

export interface TablePage {
	columns: string[];
	rows: Record<string, unknown>[];
	total: number;
}

/**
 * One page of rows from `table` (which MUST already be validated against
 * `listTables()` by the caller). Identifiers are quoted via `sql.identifier`;
 * limit/offset are bound params. Secret columns are redacted before return.
 */
export async function readTable(table: string, limit: number, offset: number): Promise<TablePage> {
	const db = getDb();
	const id = sql.identifier(table);

	const columns = await tableColumns(table);
	const countResult = await db.execute(sql`select count(*)::int as count from ${id}`);
	const total = rows<{ count: number }>(countResult)[0]?.count ?? 0;
	// Order by every column for stable limit/offset pagination — composite-PK join
	// tables (user_project_access, role_tool_access, …) have no single unique col,
	// so `order by 1` could repeat/skip rows across pages.
	const orderBy = sql.join(
		columns.map((c) => sql.identifier(c)),
		sql`, `,
	);
	const dataResult = await db.execute(
		sql`select * from ${id} order by ${orderBy} limit ${limit} offset ${offset}`,
	);

	const redacted = rows(dataResult).map((row) => {
		const out: Record<string, unknown> = {};
		for (const col of Object.keys(row)) out[col] = redact(table, col, row[col]);
		return out;
	});

	return { columns, rows: redacted, total };
}
