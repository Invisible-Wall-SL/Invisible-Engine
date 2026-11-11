/**
 * A partner launch that failed, said so a person can act on it.
 *
 * `/api/partner-session` is opened from a card button in a new tab, so its refusal is the page the
 * user sees. Raw JSON (`{"error":"Partner RGS refused the session: Player is banned: player4"}`)
 * names the cause but not the fix; this names both. `json=1` keeps the JSON for scripts.
 *
 * Every message here is built from our own text and the partner's error sentence — never from the
 * mint URL, which carries the admin credentials (`partnerRgs.ts` scrubs them from the partner's
 * text too). The player id IS shown: it is a test account name, and the fix needs it.
 */

export interface PartnerRefusalAdvice {
	title: string;
	/** What happened, in one sentence. */
	cause: string;
	/** What to do about it, in order. */
	steps: string[];
}

const POOL_STEP =
	'Or add another player the partner has already created to the `players` list of this partner in ' +
	'the launcher\'s `PARTNER_RGS` variable (Railway, service "launcher"). Note that changing the ' +
	'list can move other users to different players.';

export function partnerRefusalAdvice(message: string, status: number): PartnerRefusalAdvice {
	const banned = /player is banned:?\s*([^\s,;"]+)/i.exec(message);
	if (banned) {
		const player = banned[1];
		return {
			title: 'The partner has banned your test player',
			cause: `The partner RGS refused to open a session for "${player}", the pooled test player your launcher account plays as: it is banned on their side.`,
			steps: [`Ask the partner to unban the player "${player}".`, POOL_STEP],
		};
	}
	if (/player not found/i.test(message)) {
		return {
			title: 'The partner does not know your test player',
			cause: 'The partner RGS has no player with the id your launcher account plays as.',
			steps: [
				'Ask the partner to create the players listed for this partner in `PARTNER_RGS.players`.',
				POOL_STEP,
			],
		};
	}
	if (/No game id for profile/i.test(message)) {
		return {
			title: 'No partner game ID',
			cause: 'Neither the link, this game nor the partner profile says which partner game to open.',
			steps: [
				'Set the Partner game ID on the game\'s card in Invisible Game Maker (the "Partner…" button).',
				"A link naming another partner with `?profile=` uses none of the card's setting: add `&game=<their game id>` to it.",
			],
		};
	}
	if (/No partner RGS configured for profile|PARTNER_RGS|No partner is configured/i.test(message)) {
		return {
			title: 'This partner is not configured',
			cause: message,
			steps: [
				'Pick a partner this launcher knows on the game\'s card in Invisible Game Maker ("Partner…").',
				"Or ask an admin to add it to the launcher's `PARTNER_RGS` variable.",
			],
		};
	}
	if (/Could not reach the partner RGS|answered \d+ when creating/i.test(message)) {
		return {
			title: 'The partner RGS did not answer',
			cause: message,
			steps: [
				'Try again in a minute.',
				'If it keeps failing from Spain during a football match, it may be the LaLiga Cloudflare block rather than the partner: try from outside Spain (or a VPN) before reporting an outage.',
				'Otherwise tell the partner their session endpoint is not answering.',
			],
		};
	}
	if (status === 401) {
		return {
			title: 'Sign in first',
			cause: 'You are not signed in to the Studio launcher.',
			steps: ['Sign in at app.invisiblewall.org, then use the button again.'],
		};
	}
	if (status === 404) {
		return {
			title: 'No such game',
			cause: message,
			steps: [
				'Publish the game from Invisible Game Maker, or check you have access to its project.',
			],
		};
	}
	return {
		title: 'The partner launch was refused',
		cause: message,
		steps: [
			'If this is unexpected, send this message to whoever looks after the partner integration.',
		],
	};
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** `code` spans for backticked words; everything else escaped. */
const inline = (s: string) => escapeHtml(s).replace(/`([^`]+)`/g, '<code>$1</code>');

export function partnerRefusalPage(options: {
	message: string;
	status: number;
	gameName?: string;
}): string {
	const advice = partnerRefusalAdvice(options.message, options.status);
	const what = options.gameName ? ` — ${escapeHtml(options.gameName)}` : '';
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Partner launch refused</title>
<style>
:root { color-scheme: dark; }
body { margin: 0; background: #0f1115; color: #e6e8ee; font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 640px; margin: 64px auto; padding: 0 16px; }
h1 { font-size: 20px; margin: 0 0 4px; }
.sub { color: #9aa1b2; margin: 0 0 20px; font-size: 13px; }
.cause { background: #1a1d24; border-left: 3px solid #e5484d; padding: 12px 14px; border-radius: 4px; }
ol { padding-left: 20px; }
li { margin: 6px 0; }
code { background: #232733; padding: 1px 5px; border-radius: 3px; font-size: 13px; }
details { margin-top: 24px; color: #9aa1b2; font-size: 13px; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(advice.title)}</h1>
<p class="sub">Partner launch${what} · HTTP ${options.status}</p>
<p class="cause">${inline(advice.cause)}</p>
<h2 style="font-size:15px">What to do</h2>
<ol>${advice.steps.map((s) => `<li>${inline(s)}</li>`).join('')}</ol>
<details><summary>The exact message</summary><p>${escapeHtml(options.message)}</p></details>
</main>
</body>
</html>`;
}
