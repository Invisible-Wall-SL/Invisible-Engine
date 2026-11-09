/**
 * A stand-in for SvelteKit's `$app/environment`, so a Node check can import a route that reads it
 * (the `/login` action's cookie `secure` flag reads `dev`). Reached only through the `paths` mapping
 * in `tsconfig.scripts.json`, like `env-stub.ts`; the app always gets the real module.
 */
export const browser = false;
export const building = false;
export const dev = false;
export const version = 'check';
