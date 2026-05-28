// Create / invite a user with a password. Run after `pnpm db:push`.
//   DATABASE_URL=... node scripts/seed.mjs <email> <password> [role] [name]
// role defaults to "admin". Roles: admin | developer | artist | animator
import { randomBytes, scrypt as _scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import postgres from 'postgres';

const scrypt = promisify(_scrypt);

const [email, password, role = 'admin', name = null] = process.argv.slice(2);

if (!email || !password) {
	console.error('Usage: node scripts/seed.mjs <email> <password> [role] [name]');
	process.exit(1);
}
if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL is not set.');
	process.exit(1);
}

async function hashPassword(plain) {
	const salt = randomBytes(16).toString('hex');
	const derived = await scrypt(plain, salt, 64);
	return `${salt}:${derived.toString('hex')}`;
}

const sql = postgres(process.env.DATABASE_URL);

try {
	const passwordHash = await hashPassword(password);
	const [row] = await sql`
		insert into users (id, email, role, name, password_hash)
		values (${crypto.randomUUID()}, ${email.toLowerCase().trim()}, ${role}, ${name}, ${passwordHash})
		on conflict (email) do update
			set role = excluded.role, name = excluded.name,
			    password_hash = excluded.password_hash, active = true
		returning email, role
	`;
	console.info(`Seeded user: ${row.email} (${row.role})`);
} finally {
	await sql.end();
}
