/**
 * A per-deploy id used to CACHE-BUST the launcher's stable-name static tool assets — the Rigger /
 * Spine `view.html` and their vendored `*.js`. Unlike SvelteKit's content-hashed `_app/immutable`
 * output, those keep the SAME filename across deploys and are served (by adapter-node's static
 * handler) with no `Cache-Control`, so a browser serves the OLD file after a redeploy — the recurring
 * "I don't see the change on the other computer" trap.
 *
 * The `/rigger` + `/spine` routes append `?v=BUILD_ID` to their redirect, and each `view.html`
 * propagates it onto its `<script src>` loads, so a new deploy is always fetched fresh. Railway
 * injects `RAILWAY_GIT_COMMIT_SHA` and restarts the process on every deploy, so this changes exactly
 * when the assets can change; the module-load timestamp is a fallback for local / non-Railway hosts.
 */
export const BUILD_ID: string =
	process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) || String(Date.now());
