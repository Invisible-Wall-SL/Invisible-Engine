// Seed / invite a user. Run after `pnpm db:push` has created the tables.
//   DATABASE_URL=... node scripts/seed.mjs <email> [role] [name]
// role defaults to "admin". Roles: admin | developer | artist | animator
import postgres from 'postgres';

const [email, role = 'admin', name = null] = process.argv.slice(2);

if (!email) {
	console.error('Usage: node scripts/seed.mjs <email> [role] [name]');
	process.exit(1);
}
if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL is not set.');
	process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL);

try {
	const [row] = await sql`
		insert into users (id, email, role, name)
		values (${crypto.randomUUID()}, ${email.toLowerCase().trim()}, ${role}, ${name})
		on conflict (email) do update set role = excluded.role, active = true
		returning email, role
	`;
	console.info(`Seeded user: ${row.email} (${row.role})`);
} finally {
	await sql.end();
}
