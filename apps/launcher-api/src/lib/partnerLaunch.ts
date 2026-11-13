/**
 * A project's PARTNER LAUNCH: which game on a partner RGS it is played as.
 *
 * Stored sparse on the project row (`projects.partner_launch`, null = none), set on the Game Maker
 * card, and read by `/api/partner-session` when its query names no `game`/`profile` — so the card's
 * ▶ Partner buttons pass only the game key. Plain functions with no server imports: the page, the
 * route and the `check:partner-launch` gate all use these same ones.
 *
 * Nothing here is a credential. The profile is only the KEY of a `PARTNER_RGS` entry; the entry
 * itself (admin user + password) never leaves the server.
 */

export interface PartnerLaunch {
	/** The partner's own id for the game, e.g. `8`. */
	gameId: string;
	/** The `PARTNER_RGS` profile id. Absent ⇒ the only profile there is. */
	profile?: string;
	/** The delivery alias `on=partner` looks up. Absent ⇒ the card's name without spaces. */
	alias?: string;
	/** The partner player id this game launches as. Absent ⇒ the pool assignment in `PARTNER_RGS`
	 *  (`partnerRemoteId`). For when the partner bans or retires a pooled player. */
	player?: string;
}

/** A partner game id, profile id, alias or player id: one plain segment (it lands in a query and an
 *  R2 key). */
export const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** The partner's alias convention: the game's display name with the spaces removed. */
export function defaultPartnerAlias(cardName: string): string {
	return cardName.replace(/\s+/g, '');
}

/** The stored value, or null when it is absent or not one we wrote. Never throws. */
export function normalizePartnerLaunch(raw: unknown): PartnerLaunch | null {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
	const { gameId, profile, alias, player } = raw as Record<string, unknown>;
	if (typeof gameId !== 'string' || !SEGMENT_RE.test(gameId)) return null;
	return {
		gameId,
		...(typeof profile === 'string' && SEGMENT_RE.test(profile) ? { profile } : {}),
		...(typeof alias === 'string' && SEGMENT_RE.test(alias) ? { alias } : {}),
		...(typeof player === 'string' && SEGMENT_RE.test(player) ? { player } : {}),
	};
}

/**
 * What the card's form saves. An empty game id CLEARS the setting (null). The profile must be one
 * `PARTNER_RGS` has, and is written explicitly even when it was defaulted, so adding a second
 * partner later never silently moves this project to it.
 */
export function parsePartnerLaunchInput(
	input: { gameId?: unknown; profile?: unknown; alias?: unknown; player?: unknown },
	profiles: readonly string[],
): { ok: true; value: PartnerLaunch | null } | { ok: false; error: string } {
	const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
	const gameId = text(input.gameId);
	if (!gameId) return { ok: true, value: null };
	if (!SEGMENT_RE.test(gameId)) {
		return { ok: false, error: 'The partner game ID is letters, digits, "_" and "-" only.' };
	}
	const profile = text(input.profile) || (profiles.length === 1 ? profiles[0] : '');
	if (!profile) {
		return {
			ok: false,
			error: profiles.length
				? 'Pick which partner this game is on.'
				: 'No partner is configured on this launcher (PARTNER_RGS is empty).',
		};
	}
	if (!profiles.includes(profile)) {
		return { ok: false, error: `No partner "${profile}" is configured on this launcher.` };
	}
	const alias = text(input.alias);
	if (alias && !SEGMENT_RE.test(alias)) {
		return { ok: false, error: 'The delivery alias is letters, digits, "_" and "-" only.' };
	}
	const player = text(input.player);
	if (player && !SEGMENT_RE.test(player)) {
		return { ok: false, error: 'The partner player is letters, digits, "_" and "-" only.' };
	}
	return {
		ok: true,
		value: { gameId, profile, ...(alias ? { alias } : {}), ...(player ? { player } : {}) },
	};
}

export interface ResolvedPartnerLaunch {
	profileId: string;
	/** Undefined ⇒ the profile's own `gameId` in `PARTNER_RGS` (the env default). */
	gameId?: string;
	alias: string;
	/** The alias was named (query or stored) rather than derived from the card's name. */
	aliasNamed: boolean;
	/** Undefined ⇒ the profile's player pool decides (`partnerRemoteId`). */
	player?: string;
}

/**
 * Who `/api/partner-session` launches: the query beats the project's stored setting, which beats
 * the env default. The stored game id, alias and player belong to the stored profile, so a query
 * naming a DIFFERENT profile does not borrow them (that would mint game 8 of one partner on
 * another). A `player` that is not one plain segment is an error rather than ignored: it would
 * otherwise silently fall back to the banned pool player the caller was routing around.
 */
export function resolvePartnerLaunch(options: {
	query: URLSearchParams;
	stored: PartnerLaunch | null;
	/** The profile ids `PARTNER_RGS` holds. */
	profiles: readonly string[];
	cardName: string;
}): ResolvedPartnerLaunch | { error: string } {
	const { query, stored, profiles } = options;
	const asked = (name: string) => query.get(name)?.trim() || undefined;
	const sole = profiles.length === 1 ? profiles[0] : undefined;
	const storedProfile = stored ? (stored.profile ?? sole) : undefined;

	const profileId = asked('profile') ?? storedProfile ?? sole;
	if (!profileId) {
		return {
			error: profiles.length
				? 'Name the partner with ?profile= — this launcher has more than one, and this game has none set.'
				: 'No partner is configured on this launcher (PARTNER_RGS is empty).',
		};
	}
	const own = stored && storedProfile === profileId ? stored : null;
	const alias = asked('alias') ?? own?.alias;
	const player = asked('player') ?? own?.player;
	if (player !== undefined && !SEGMENT_RE.test(player)) {
		return { error: 'The partner player (?player=) is letters, digits, "_" and "-" only.' };
	}
	return {
		profileId,
		gameId: asked('game') ?? own?.gameId,
		alias: alias ?? defaultPartnerAlias(options.cardName),
		aliasNamed: alias !== undefined,
		...(player !== undefined ? { player } : {}),
	};
}

export interface PartnerButton {
	href: string;
	/** Why it cannot be used yet; the button is disabled when set. */
	disabled?: string;
}

/**
 * The Game Maker card's ▶ Partner / ▶ Partner page buttons, or null when the card shows neither:
 * no partner game ID set, or its partner is not one this launcher can mint on (which is also what
 * decides whether the signed-in user may mint at all — a card they can see is a project they reach).
 */
export function partnerButtons(options: {
	key: string;
	partner: PartnerLaunch | null;
	profiles: readonly string[];
	published: boolean;
	/** The newest sealed delivery for the project's alias, or null. */
	latestDelivery: string | null;
}): { card: PartnerButton; page: PartnerButton } | null {
	const { partner, profiles } = options;
	if (!partner) return null;
	const profile = partner.profile ?? (profiles.length === 1 ? profiles[0] : undefined);
	if (!profile || !profiles.includes(profile)) return null;

	const base = `/api/partner-session?key=${encodeURIComponent(options.key)}`;
	const unpublished = options.published ? undefined : 'Publish the game first.';
	return {
		card: { href: base, ...(unpublished ? { disabled: unpublished } : {}) },
		page: {
			href: `${base}&on=partner`,
			...(unpublished
				? { disabled: unpublished }
				: options.latestDelivery
					? {}
					: {
							disabled:
								'Nothing delivered to the partner yet — 📦 Deliver it from the desktop launcher first.',
						}),
		},
	};
}
