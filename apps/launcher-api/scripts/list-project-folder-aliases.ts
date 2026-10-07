/**
 * READ-ONLY report of projects that already share an R2 folder (OPEN_QUESTIONS 17):
 *   DATABASE_URL=… pnpm --filter launcher-api list:project-folder-aliases
 *
 * A project's files live under `r2Slug(client)/r2Slug(key)`, so `my_game` beside `my-game` under
 * one client read and write the same tree. `createProject` refuses such a key now; rows made before
 * that are left exactly as they are. This lists them, live and soft-deleted, so an owner can decide
 * what to do. One SELECT; it writes nothing, to the database or to R2.
 */
import { asc } from 'drizzle-orm';
import { getDb } from '../src/lib/server/db/index.ts';
import { projects } from '../src/lib/server/db/schema.ts';
import { UNASSIGNED_CLIENT, projectPrefix } from '../src/lib/server/projectPaths.ts';

const rows = await getDb()
	.select({ key: projects.key, clientKey: projects.clientKey, deletedAt: projects.deletedAt })
	.from(projects)
	.orderBy(asc(projects.key));

const byFolder = new Map<string, typeof rows>();
for (const row of rows) {
	const folder = projectPrefix(row.clientKey ?? UNASSIGNED_CLIENT, row.key);
	byFolder.set(folder, [...(byFolder.get(folder) ?? []), row]);
}
const shared = [...byFolder]
	.filter(([, held]) => held.length > 1)
	.sort(([a], [b]) => a.localeCompare(b));

console.log(`${rows.length} projects, ${shared.length} R2 folder(s) held by more than one`);
for (const [folder, held] of shared) {
	const who = held.map(
		(p) => `${p.key} (${p.clientKey ?? 'unassigned'}${p.deletedAt ? ', deleted' : ''})`,
	);
	console.log(`  ${folder}/  ←  ${who.join(', ')}`);
}
process.exit(0);
