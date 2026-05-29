import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { games } from './db/schema';
import type { Game } from './db/schema';

/** Game key slug: same rule as project/client keys (`^[a-z0-9][a-z0-9_-]{0,63}$`). */
const GAME_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isValidGameKey(value: string): boolean {
	return GAME_KEY_RE.test(value);
}

export async function listGames(): Promise<Game[]> {
	return getDb().select().from(games).orderBy(games.name);
}

export async function gameExists(key: string): Promise<boolean> {
	const [row] = await getDb().select({ key: games.key }).from(games).where(eq(games.key, key));
	return Boolean(row);
}

export async function createGame(key: string, name: string, url: string): Promise<void> {
	await getDb().insert(games).values({ key, name, url });
}

export async function renameGame(key: string, name: string): Promise<void> {
	await getDb().update(games).set({ name }).where(eq(games.key, key));
}

export async function setGameUrl(key: string, url: string): Promise<void> {
	await getDb().update(games).set({ url }).where(eq(games.key, key));
}

export async function deleteGame(key: string): Promise<void> {
	await getDb().delete(games).where(eq(games.key, key));
}
