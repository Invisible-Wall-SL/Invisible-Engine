// The launcher's `r2Slug` (`apps/launcher-api/src/lib/server/projectPaths.ts`), which names every
// R2 key segment it reads: lowercased, every other character `_`, 60 at most. The export writes
// its keys with it so the launcher finds them; `check:salmons-export` holds the two equal.
export const r2Slug = (name) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '_')
		.slice(0, 60) || 'default';
