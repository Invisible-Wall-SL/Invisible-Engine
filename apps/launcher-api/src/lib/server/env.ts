import { env } from '$env/dynamic/private';

function required(name: string): string {
	const value = env[name];
	if (!value) throw new Error(`Missing required env var: ${name}`);
	return value;
}

export const ENV = {
	get DATABASE_URL() {
		return required('DATABASE_URL');
	},
	get ORIGIN() {
		return env.ORIGIN ?? 'http://localhost:3010';
	},
	/** Session lifetime when "remember me" is checked (persistent cookie). */
	get REMEMBER_TTL_DAYS() {
		return Number(env.REMEMBER_TTL_DAYS ?? '30');
	},
	/** Session lifetime when "remember me" is unchecked (browser-session cookie). */
	get SESSION_TTL_HOURS() {
		return Number(env.SESSION_TTL_HOURS ?? '12');
	},
	// Cloudflare R2 (S3-compatible) — shared asset/model repository.
	get R2_ENDPOINT() {
		return required('R2_ENDPOINT');
	},
	get R2_BUCKET() {
		return required('R2_BUCKET');
	},
	get R2_ACCESS_KEY_ID() {
		return required('R2_ACCESS_KEY_ID');
	},
	get R2_SECRET_ACCESS_KEY() {
		return required('R2_SECRET_ACCESS_KEY');
	},
	// Atlas Maker (cloud) — the generation backend + default manifest/style ref.
	get ATLAS_BACKEND_URL() {
		// Code default to the current Railway service so the launcher works even
		// if the env var isn't applied (Railway vars stage); env overrides.
		return env.ATLAS_BACKEND_URL ?? 'https://atlas-backend-production-0a70.up.railway.app';
	},
	get ATLAS_MANIFEST_KEY() {
		return env.ATLAS_MANIFEST_KEY ?? 'atlas/manifests/loader.json';
	},
	get ATLAS_STYLE_REF_KEY() {
		return env.ATLAS_STYLE_REF_KEY ?? 'spines/hotfruits/loader/loader.png';
	},
	// Atlas Maker (cloud Python tool) — the re-hosted ui_server, embedded in
	// /atlas behind the launcher. URL of the atlas-tool Railway service; the
	// optional shared secret is appended as ?k= so the tool's gate lets the
	// authenticated iframe through.
	get ATLAS_TOOL_URL() {
		// Defaults to the known atlas-tool Railway service so /atlas works
		// without depending on a Railway env var being applied. Override via
		// the ATLAS_TOOL_URL env when the tool moves.
		return env.ATLAS_TOOL_URL ?? 'https://atlas-tool-production.up.railway.app';
	},
	get ATLAS_TOOL_SECRET() {
		return env.ATLAS_TOOL_SECRET ?? '';
	},
	// Shared secret gating blueprint PUBLISHING (write to the shared library).
	// Handed to the atlas tool as `bp=<secret>` only for users holding the
	// `blueprintPublish` capability; the tool requires the value to match. Unset
	// = publishing stays off in a deployed tool (fail safe). Must match the same
	// var set on the atlas-tool service.
	get ATLAS_BLUEPRINT_SECRET() {
		return env.ATLAS_BLUEPRINT_SECRET ?? '';
	},
	// Sheet Maker (cloud Python tool) — the re-hosted sheet_server, opened
	// full-page from /sheet behind the launcher (same pattern as the Atlas tool).
	// Code default to the current Railway service; env overrides.
	get SHEET_TOOL_URL() {
		return env.SHEET_TOOL_URL ?? 'https://sheet-tool-production.up.railway.app';
	},
	get SHEET_TOOL_SECRET() {
		return env.SHEET_TOOL_SECRET ?? '';
	},
	// Invisible Editor — shared read token for the public layout-doc endpoint
	// (`GET /api/editor/doc`). Standalone games (own origin, no launcher session)
	// pass it as `?k=`. Secret: no code default. When EMPTY the endpoint refuses
	// to serve (503) so the layout docs are never exposed unauthenticated.
	// NOTE: this is now the BOOTSTRAP/fallback for the deploy token — the effective
	// value is resolved by `$lib/server/appSettings.ts#getDeployToken()`, which
	// prefers the admin-managed DB value (`app_settings.deployToken`). Don't read
	// this directly for the deploy/editor/localization endpoints; call getDeployToken().
	get EDITOR_DOC_SECRET() {
		return env.EDITOR_DOC_SECRET ?? '';
	},
	// Invisible Localization — Claude (Anthropic) API key for auto-translation.
	// Secret: no code default. When empty the tool still loads; the `translate`
	// action returns a clear error instead of calling the API.
	get ANTHROPIC_API_KEY() {
		return env.ANTHROPIC_API_KEY ?? '';
	},
	// Cloudflare cache purge — auto-purges the edge cache for a game after it's
	// (re)published so a republish is immediately visible (game filenames are
	// stable). Token needs Zone → Cache Purge on the `invisiblewall.org` zone.
	// Secret: no code default. When EITHER is empty, purgeGameCache() is a no-op.
	get CF_API_TOKEN() {
		return env.CF_API_TOKEN ?? '';
	},
	get CF_ZONE_ID() {
		return env.CF_ZONE_ID ?? '';
	},
	// Public origin where published games are served (R2 `test_server/<key>/`
	// behind Cloudflare). Non-secret → code default; env overrides.
	get GAMES_BASE_URL() {
		return env.GAMES_BASE_URL ?? 'https://games.invisiblewall.org';
	},
	// GitHub read-only token the desktop launcher uses to clone PRIVATE game repos
	// (and their submodules) on any machine with no per-user GitHub login. Served by
	// GET /api/launcher/git-credentials to authenticated launchers. Use a fine-grained
	// PAT (read-only "Contents" on the org's game repos) or a GitHub App installation
	// token. Secret: no code default. Empty → the endpoint 404s and the launcher falls
	// back to interactive git auth. Treat it as a shared, rotatable deploy secret.
	get GIT_CLONE_TOKEN() {
		return env.GIT_CLONE_TOKEN ?? '';
	},
	// Username paired with GIT_CLONE_TOKEN in the clone URL. For a PAT or App token the
	// username is ignored by GitHub, so the conventional `x-access-token` is the default.
	get GIT_CLONE_USERNAME() {
		return env.GIT_CLONE_USERNAME ?? 'x-access-token';
	},
};
