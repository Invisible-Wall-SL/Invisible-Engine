import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { ENV } from '../env';
import * as schema from './schema';

let instance: ReturnType<typeof drizzle<typeof schema>> | null = null;

/** Lazily create the Drizzle client (avoids touching DATABASE_URL at build time). */
export function getDb() {
	if (!instance) {
		instance = drizzle(postgres(ENV.DATABASE_URL), { schema });
	}
	return instance;
}

export { schema };
