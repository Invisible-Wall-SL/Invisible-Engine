/**
 * A PARTNER SHARE LINK: `/play/<token>` opens a project's published game on its partner RGS for
 * someone with no launcher account, minting a fresh partner session on every open. Made and revoked
 * from the project's Game Maker card. Plain values and functions with no server imports: the card,
 * the routes and the `check:partner-share` gate use these same ones. The server half is
 * `$lib/server/partnerShare.ts`.
 */
import type { PartnerButton } from './partnerLaunch';

/** How long a new link lives, in days — the card's choices. */
export const SHARE_EXPIRY_DAYS = [1, 7, 30] as const;
export const DEFAULT_SHARE_EXPIRY_DAYS = 7;

/** Opens one link may spend per minute. Each open mints a session on the partner's ADMIN endpoint,
 *  so a leaked link must not be able to hammer it. */
export const SHARE_OPENS_PER_MINUTE = 5;
export const SHARE_OPEN_WINDOW_MS = 60_000;

/** The share link's path: `/play/<token>`, a 43-char base64url token (32 random bytes). */
export const SHARE_PATH = '/play/';
export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** The lifetime a create request asked for, or null when it is not one of the card's choices. */
export function parseShareExpiryDays(raw: unknown): number | null {
	const days = raw === undefined || raw === null || raw === '' ? DEFAULT_SHARE_EXPIRY_DAYS : raw;
	const n = typeof days === 'string' ? Number(days) : days;
	return (SHARE_EXPIRY_DAYS as readonly unknown[]).includes(n) ? (n as number) : null;
}

/** A live link as the card lists it. The token is not here: only its hash is stored. */
export interface PartnerShareLinkView {
	id: string;
	/** Who made it (name, else email); null once that account is deleted. */
	createdBy: string | null;
	createdAt: string;
	expiresAt: string;
	lastOpenedAt: string | null;
	openCount: number;
}

/**
 * The card's "Share link…" control, or null when the card shows none: only beside ▶ Partner (the
 * project has a partner launch this launcher can mint on — `partnerButtons`), and only for a user
 * who may Publish. Disabled, with ▶ Partner's reason, until the game is published: the link opens
 * the published card.
 */
export function shareLinkButton(options: {
	partner: { card: PartnerButton } | null;
	canPublish: boolean;
}): { disabled?: string } | null {
	if (!options.partner || !options.canPublish) return null;
	const reason = options.partner.card.disabled;
	return reason ? { disabled: reason } : {};
}
