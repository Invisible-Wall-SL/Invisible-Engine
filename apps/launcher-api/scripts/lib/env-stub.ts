/**
 * A stand-in for SvelteKit's `$env/dynamic/private`, so a Node script can import a `src/lib/server`
 * module for its PURE parts (a Zod schema, a prune rule) without SvelteKit's virtual modules.
 *
 * Reached only through the `paths` mapping in `tsconfig.scripts.json`, which no build uses — the app
 * itself always gets the real virtual module. It reads `process.env` so a script that genuinely
 * needs a variable still gets one, rather than being handed an empty object that fails later and
 * further away.
 */
export const env: Record<string, string | undefined> = process.env;
