import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, isNull, lt, lte, or, sql } from 'drizzle-orm';
import {
	SHARE_OPEN_WINDOW_MS,
	SHARE_OPENS_PER_MINUTE,
	SHARE_TOKEN_RE,
	type PartnerShareLinkView,
} from '$lib/partnerShare';
import { getDb } from './db';
import { partnerShareLinks, users, type PartnerShareLink } from './db/schema';
import { getGame } from './games';
import { launchOnPartner } from './partnerSessionLaunch';
import { projectIsDeleted } from './projects';

/**
 * Storage + opening for PARTNER SHARE LINKS (`$lib/partnerShare.ts`).
 *
 * The token is the session-cookie pattern (`auth.ts`): 32 CSPRNG bytes, base64url, and only its
 * SHA-256 stored — a database read never yields a working link, and the link is shown once, when
 * it is made. A plain hash (no salt, no HMAC) is enough because the token is 256 random bits, not a
 * guessable secret.
 *
 * Opening never trusts the caller beyond the token: no query param reaches the launch, so a link
 * holder cannot pick another game, partner or player (`/api/partner-session` lets a SIGNED-IN user
 * do that). And the partner's admin credentials stay inside `launchOnPartner` → `partnerRgs.ts`.
 */

export const hashShareToken = (token: string): string =>
	createHash('sha256').update(token).digest('hex');

export async function createShareLink(options: {
	projectKey: string;
	userId: string;
	days: number;
	now?: Date;
}): Promise<{ id: string; token: string; expiresAt: Date }> {
	const now = options.now ?? new Date();
	const token = randomBytes(32).toString('base64url');
	const id = randomBytes(8).toString('hex');
	const expiresAt = new Date(now.getTime() + options.days * 86_400_000);
	await getDb()
		.insert(partnerShareLinks)
		.values({
			id,
			tokenHash: hashShareToken(token),
			projectKey: options.projectKey,
			createdBy: options.userId,
			createdAt: now,
			expiresAt,
		});
	return { id, token, expiresAt };
}

/** A project's LIVE links (not revoked, not expired), newest first. */
export async function listShareLinks(
	projectKey: string,
	now: Date = new Date(),
): Promise<PartnerShareLinkView[]> {
	const t = partnerShareLinks;
	const rows = await getDb()
		.select({
			id: t.id,
			createdAt: t.createdAt,
			expiresAt: t.expiresAt,
			lastOpenedAt: t.lastOpenedAt,
			openCount: t.openCount,
			name: users.name,
			email: users.email,
		})
		.from(t)
		.leftJoin(users, eq(users.id, t.createdBy))
		.where(and(eq(t.projectKey, projectKey), isNull(t.revokedAt), gt(t.expiresAt, now)))
		.orderBy(desc(t.createdAt));
	return rows.map((r) => ({
		id: r.id,
		createdBy: r.name || r.email || null,
		createdAt: r.createdAt.toISOString(),
		expiresAt: r.expiresAt.toISOString(),
		lastOpenedAt: r.lastOpenedAt?.toISOString() ?? null,
		openCount: r.openCount,
	}));
}

/** Revoke one of a project's links. False when it is not that project's, or already revoked. */
export async function revokeShareLink(options: {
	projectKey: string;
	id: string;
	userId: string;
	now?: Date;
}): Promise<boolean> {
	const t = partnerShareLinks;
	const rows = await getDb()
		.update(t)
		.set({ revokedAt: options.now ?? new Date(), revokedBy: options.userId })
		.where(and(eq(t.id, options.id), eq(t.projectKey, options.projectKey), isNull(t.revokedAt)))
		.returning({ id: t.id });
	return rows.length > 0;
}

export type ShareRefusal = 'unknown' | 'revoked' | 'expired' | 'busy';

/** Why a link that is NOT live (or out of opens) cannot be used, read from its row. */
export function shareRefusalOf(
	row: Pick<PartnerShareLink, 'revokedAt' | 'expiresAt'> | undefined,
	now: Date,
): ShareRefusal {
	if (!row) return 'unknown';
	if (row.revokedAt) return 'revoked';
	if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
	return 'busy';
}

async function findByToken(token: string): Promise<PartnerShareLink | undefined> {
	if (!SHARE_TOKEN_RE.test(token)) return undefined;
	const [row] = await getDb()
		.select()
		.from(partnerShareLinks)
		.where(eq(partnerShareLinks.tokenHash, hashShareToken(token)));
	return row;
}

/** The link a token names while it is live, else why not. Spends nothing. */
export async function peekShareLink(
	token: string,
	now: Date = new Date(),
): Promise<{ ok: true; link: PartnerShareLink } | { ok: false; refusal: ShareRefusal }> {
	const row = await findByToken(token);
	if (row && !row.revokedAt && row.expiresAt.getTime() > now.getTime()) {
		return { ok: true, link: row };
	}
	return { ok: false, refusal: shareRefusalOf(row, now) };
}

/**
 * Spend one open of a live link, or say why not. ONE conditional UPDATE does the check and the
 * spend, so parallel opens cannot all read "4 of 5 used" and each mint: the row is live, and its
 * minute window is either over (it restarts at 1) or still has room (+1). Every SET expression reads
 * the row as it was before this statement, so the window test means the same thing in each.
 */
export async function claimShareOpen(
	token: string,
	now: Date = new Date(),
): Promise<
	| { ok: true; link: Pick<PartnerShareLink, 'id' | 'projectKey'> }
	| { ok: false; refusal: ShareRefusal; retryAfterSeconds?: number }
> {
	if (!SHARE_TOKEN_RE.test(token)) return { ok: false, refusal: 'unknown' };
	const t = partnerShareLinks;
	const hash = hashShareToken(token);
	const windowOver = or(
		isNull(t.windowStartedAt),
		lte(t.windowStartedAt, new Date(now.getTime() - SHARE_OPEN_WINDOW_MS)),
	);
	const at = sql`${now.toISOString()}::timestamptz`;
	const [claimed] = await getDb()
		.update(t)
		.set({
			windowOpens: sql`case when ${windowOver} then 1 else ${t.windowOpens} + 1 end`,
			windowStartedAt: sql`case when ${windowOver} then ${at} else ${t.windowStartedAt} end`,
			lastOpenedAt: now,
			openCount: sql`${t.openCount} + 1`,
		})
		.where(
			and(
				eq(t.tokenHash, hash),
				isNull(t.revokedAt),
				gt(t.expiresAt, now),
				or(windowOver, lt(t.windowOpens, SHARE_OPENS_PER_MINUTE)),
			),
		)
		.returning({ id: t.id, projectKey: t.projectKey });
	if (claimed) return { ok: true, link: claimed };

	const [row] = await getDb().select().from(t).where(eq(t.tokenHash, hash));
	const refusal = shareRefusalOf(row, now);
	if (refusal !== 'busy') return { ok: false, refusal };
	const since = row?.windowStartedAt?.getTime() ?? now.getTime();
	const retryAfterSeconds = Math.max(
		1,
		Math.ceil((since + SHARE_OPEN_WINDOW_MS - now.getTime()) / 1000),
	);
	return { ok: false, refusal, retryAfterSeconds };
}

export const SHARE_REFUSAL_TEXT: Record<
	ShareRefusal,
	{ status: number; title: string; message: string }
> = {
	unknown: {
		status: 404,
		title: 'Link not found',
		message: 'This game link does not exist. Check you copied all of it, or ask for a new one.',
	},
	revoked: {
		status: 410,
		title: 'Link revoked',
		message: 'This game link has been turned off. Ask whoever sent it for a new one.',
	},
	expired: {
		status: 410,
		title: 'Link expired',
		message: 'This game link has expired. Ask whoever sent it for a new one.',
	},
	busy: {
		status: 429,
		title: 'Opened too often',
		message:
			'This game link was opened several times in the last minute. Wait a minute and try again.',
	},
};

export type ShareOpenOutcome =
	| { ok: true; url: string; gameName: string }
	| {
			ok: false;
			status: number;
			title: string;
			message: string;
			gameName?: string;
			detail?: string;
			retryAfterSeconds?: number;
	  };

/**
 * Open a share link: spend one open, then mint a fresh partner session for its project's published
 * card, exactly as `/api/partner-session` would for that project's stored partner launch — but with
 * no query (nothing the holder sends reaches the launch) and with a stored partner launch required.
 * The session plays as the link's own pool slot (`share-<id>`), so two links never share a wallet
 * through the pool, while one link keeps the same player from open to open.
 */
export async function openShareLink(
	token: string,
	now: Date = new Date(),
): Promise<ShareOpenOutcome> {
	const claim = await claimShareOpen(token, now);
	if (!claim.ok) {
		return {
			ok: false,
			...SHARE_REFUSAL_TEXT[claim.refusal],
			...(claim.retryAfterSeconds ? { retryAfterSeconds: claim.retryAfterSeconds } : {}),
		};
	}
	const { id, projectKey } = claim.link;
	const game = (await projectIsDeleted(projectKey)) ? undefined : await getGame(projectKey);
	if (!game || game.projectKey !== projectKey) {
		console.info(`[partner-share] ${projectKey}: link ${id} refused — no published game`);
		return {
			ok: false,
			status: 410,
			title: 'Game not available',
			message: 'This game is not published any more. Ask whoever sent the link.',
		};
	}
	const launched = await launchOnPartner({
		game,
		query: new URLSearchParams(),
		userId: `share-${id}`,
		requireStored: true,
	});
	if (!launched.ok) {
		console.info(
			`[partner-share] ${projectKey}: link ${id} refused (${launched.status}) — ${launched.message}`,
		);
		return {
			ok: false,
			status: launched.status,
			title: 'The game could not be started',
			message:
				"The partner's server did not open a session for this game. Try again in a minute; if it keeps failing, tell whoever sent the link.",
			gameName: game.name,
			detail: launched.message,
		};
	}
	console.info(`[partner-share] ${projectKey}: link ${id} opened a fresh partner session`);
	return { ok: true, url: launched.url, gameName: game.name };
}
