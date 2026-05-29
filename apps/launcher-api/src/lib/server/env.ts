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
	// Sheet Maker (cloud Python tool) — the re-hosted sheet_server, opened
	// full-page from /sheet behind the launcher (same pattern as the Atlas tool).
	// Code default to the current Railway service; env overrides.
	get SHEET_TOOL_URL() {
		return env.SHEET_TOOL_URL ?? 'https://sheet-tool-production.up.railway.app';
	},
	get SHEET_TOOL_SECRET() {
		return env.SHEET_TOOL_SECRET ?? '';
	},
	// Invisible Localization — Claude (Anthropic) API key for auto-translation.
	// Secret: no code default. When empty the tool still loads; the `translate`
	// action returns a clear error instead of calling the API.
	get ANTHROPIC_API_KEY() {
		return env.ANTHROPIC_API_KEY ?? '';
	},
};
