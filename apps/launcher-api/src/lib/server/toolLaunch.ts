import { createHmac } from 'node:crypto';
import { BLUEPRINT_PUBLISH_CAPABILITY, roleHasCapability, type Role } from '$lib/roles';
import { ENV } from './env';
import { r2Slug } from './projectPaths';
import { getRoleOverrides } from './roleToolAccess';
import { getToolOverrides } from './userToolAccess';

/**
 * The launcher → cloud Python tool handoff (Atlas Maker, Sheet Maker, and the Flipbook video proxy
 * that forwards to the Atlas Maker).
 *
 * After its own access check the launcher mints a short-lived HMAC-signed launch token carrying
 * who the user is and which `(client, project)` they are in; the tool verifies it and takes those
 * values ONLY from the token. The format is a byte-for-byte contract with the Python verifier:
 *
 *   `v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256(secret, "v1." + payloadB64))>`
 *
 * base64url without padding, payload keys in the fixed order `mintToolLaunchToken` writes them.
 *
 * While a tool's signing secret is unset the legacy unsigned query handoff is sent instead, so
 * nothing changes until the matching secret is set on both services.
 */

export type LaunchAudience = 'atlas' | 'sheet';

export const LAUNCH_TOKEN_TTL_SECONDS = 120;
export const LAUNCH_QUERY_PARAM = 'iw_launch';
export const LAUNCH_HEADER = 'X-IW-Launch';

export interface LaunchClaims {
	aud: LaunchAudience;
	sub: string;
	/** The real `users.id` — what a person-level lease or an audit row keys on. */
	uid: string;
	name: string;
	role: Role;
	client: string;
	project: string;
	caps: string[];
	/**
	 * Who is acting for the user, on an `api` token only: an Invisible Director agent. atlas-tool
	 * stamps the manifests it saves with it (`saved_by.tool = 'director'`, `agent`, `runId`) and
	 * refuses it on any other token type.
	 */
	act?: LaunchActor;
}

export interface LaunchActor {
	tool: 'director';
	agent: string;
	run: string;
}

/**
 * `launch` rides a browser redirect and the tool accepts it once; `api` is only ever sent
 * server-to-server as a header, so a token read out of a URL can never be replayed as one.
 */
export type LaunchTokenType = 'launch' | 'api';

export function mintToolLaunchToken(
	secret: string,
	claims: LaunchClaims,
	now: number = Date.now(),
	typ: LaunchTokenType = 'launch',
): string {
	if (claims.act && typ !== 'api') throw new Error('An acting claim rides an api token only');
	const iat = Math.floor(now / 1000);
	// Fixed key order keeps the shared test vector byte-exact; the verifier checks the bytes it
	// received and never re-serialises.
	const payload = {
		v: 1,
		typ,
		aud: claims.aud,
		sub: claims.sub,
		uid: claims.uid,
		name: claims.name,
		role: claims.role,
		client: claims.client,
		project: claims.project,
		caps: claims.caps,
		...(claims.act ? { act: claims.act } : {}),
		iat,
		exp: iat + LAUNCH_TOKEN_TTL_SECONDS,
	};
	const signingInput = `v1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
	const sig = createHmac('sha256', secret).update(signingInput).digest('base64url');
	return `${signingInput}.${sig}`;
}

export type LaunchUser = Pick<NonNullable<App.Locals['user']>, 'id' | 'email' | 'name' | 'role'>;

export interface HandoffSecrets {
	signingSecret: string;
	legacySecret: string;
	blueprintSecret: string;
}

export interface HandoffInput {
	tool: LaunchAudience;
	user: LaunchUser;
	clientKey: string;
	projectKey: string;
	canPublishBlueprints: boolean;
}

/** `query` puts the token on the redirect URL; `header` is for a server-to-server fetch. */
export type HandoffTransport = 'query' | 'header';

export interface ToolHandoff {
	params: URLSearchParams;
	headers: Record<string, string>;
	signed: boolean;
	canPublishBlueprints: boolean;
}

export function buildToolHandoff(
	input: HandoffInput,
	secrets: HandoffSecrets,
	via: HandoffTransport = 'query',
	now: number = Date.now(),
): ToolHandoff {
	const { tool, user, clientKey, projectKey, canPublishBlueprints } = input;
	const params = new URLSearchParams();
	const headers: Record<string, string> = {};

	if (secrets.signingSecret) {
		const token = mintToolLaunchToken(
			secrets.signingSecret,
			{
				aud: tool,
				sub: r2Slug(user.id),
				uid: user.id,
				// Shown to colleagues ("Name is rendering"), so never the full email address.
				name: user.name || user.email.split('@')[0],
				role: user.role,
				client: clientKey,
				project: projectKey,
				caps: tool === 'atlas' && canPublishBlueprints ? [BLUEPRINT_PUBLISH_CAPABILITY] : [],
			},
			now,
			via === 'header' ? 'api' : 'launch',
		);
		if (via === 'header') headers[LAUNCH_HEADER] = token;
		else params.set(LAUNCH_QUERY_PARAM, token);
		return { params, headers, signed: true, canPublishBlueprints };
	}

	if (secrets.legacySecret) params.set('k', secrets.legacySecret);
	params.set('client', clientKey);
	params.set('project', projectKey);
	// Per-user ComfyUI routing (docs/design/per-user-comfyui-routing.md) — only the Atlas Maker
	// generates, so only it is told who is logged in.
	if (tool === 'atlas') params.set('user', r2Slug(user.id));
	// Blueprint publishing is gated by knowledge of a secret, not a flag: every atlas user already
	// holds `k`, so a bare `bp=1` would gate nothing.
	if (tool === 'atlas' && secrets.blueprintSecret && canPublishBlueprints) {
		params.set('bp', secrets.blueprintSecret);
	}
	return { params, headers, signed: false, canPublishBlueprints };
}

function handoffSecrets(tool: LaunchAudience): HandoffSecrets {
	return tool === 'atlas'
		? {
				signingSecret: ENV.ATLAS_TOOL_SIGNING_SECRET,
				legacySecret: ENV.ATLAS_TOOL_SECRET,
				blueprintSecret: ENV.ATLAS_BLUEPRINT_SECRET,
			}
		: {
				signingSecret: ENV.SHEET_TOOL_SIGNING_SECRET,
				legacySecret: ENV.SHEET_TOOL_SECRET,
				blueprintSecret: '',
			};
}

/**
 * The handoff for one launch of `tool`, AFTER the caller has made its own access check.
 *
 * The `blueprintPublish` capability (the token's `caps`, or the legacy `bp`) is looked up only when
 * `withPublish` is set — the Flipbook proxy sets it on its publish route alone, so a status poll
 * costs no DB queries. Otherwise `canPublishBlueprints` is `false` without a lookup.
 */
export async function toolHandoff({
	tool,
	user,
	clientKey,
	projectKey,
	via = 'query',
	withPublish = true,
}: {
	tool: LaunchAudience;
	user: LaunchUser;
	clientKey: string;
	projectKey: string;
	via?: HandoffTransport;
	withPublish?: boolean;
}): Promise<ToolHandoff> {
	const secrets = handoffSecrets(tool);
	let canPublishBlueprints = false;
	if (tool === 'atlas' && withPublish && (secrets.signingSecret || secrets.blueprintSecret)) {
		const [roleOverrides, userOverrides] = await Promise.all([
			getRoleOverrides(user.role),
			getToolOverrides(user.id),
		]);
		canPublishBlueprints = roleHasCapability(
			user.role,
			BLUEPRINT_PUBLISH_CAPABILITY,
			roleOverrides,
			userOverrides,
		);
	}
	return buildToolHandoff(
		{ tool, user, clientKey, projectKey, canPublishBlueprints },
		secrets,
		via,
	);
}
