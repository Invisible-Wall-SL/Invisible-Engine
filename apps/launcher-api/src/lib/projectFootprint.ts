/**
 * Wire shape of `GET /api/admin/project-footprint`.
 *
 * Lives OUTSIDE `$lib/server/` so the endpoint and the admin page can share one
 * declaration — a `+server.ts` is a server-only module the page may not import, and
 * hand-copying the shape into the component is the exact pattern this app's own guidance
 * warns about: `build` strips types without checking them, so two copies drift silently.
 */
export interface ProjectFootprint {
	projectKey: string;
	/** The R2 roots the project owns — what a purge would delete. */
	roots: string[];
	objects: number;
	bytes: number;
	/** Other projects sharing a root. Non-empty ⇒ a purge is refused. */
	collidesWith: string[];
	/** This project's data OUTSIDE those roots. Non-empty ⇒ a purge is refused. */
	strayPrefixes: string[];
	/** Games the project OWNS, which a delete unregisters. Never global games. */
	games: { key: string; name: string }[];
}
