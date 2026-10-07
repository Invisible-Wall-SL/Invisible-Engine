/**
 * The blueprint catalogue as the Pipeline Changes Catalogue tab shows it: every image pipeline
 * atlas-tool knows (`GET /blueprints?kind=image&all=1`), each with the state of its card. The
 * agents' `atlas.list_blueprints` is the subset `offered` marks — a reviewed card that still
 * matches its graph and still validates, the same rule `cards.list_entries` applies to an agent.
 *
 * Shared by the endpoint (which maps atlas-tool's answer) and the page (which renders it); no
 * server import, so the check script runs it as is.
 */

export const CARD_STATUSES = ['reviewed', 'draft', 'stale', 'none'] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export interface CatalogueRow {
	id: string;
	name: string;
	builtin: boolean;
	status: CardStatus;
	/** What `atlas.list_blueprints` serves: reviewed, current and valid. */
	offered: boolean;
	purpose: string;
	rev: number | null;
	reviewedBy: string;
	reviewedAt: string;
	/** Why the card fails against the live blueprint; a reviewed card with any is withheld. */
	problems: string[];
}

export interface CatalogueView {
	gpu: string;
	rows: CatalogueRow[];
}

/** Blueprint ids as atlas-tool slugs them (`r2_slug`), so a deep link cannot carry anything else. */
export const BLUEPRINT_ID = /^[a-z0-9_]{1,60}$/;

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

const record = (v: unknown): Record<string, unknown> | null =>
	typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function statusOf(raw: unknown, hasCard: boolean): CardStatus {
	if (!hasCard) return 'none';
	return raw === 'reviewed' || raw === 'stale' ? raw : 'draft';
}

const ORDER: Record<CardStatus, number> = { reviewed: 0, stale: 1, draft: 2, none: 3 };

/**
 * atlas-tool's `/blueprints?all=1` answer → the tab's rows. Offered first, then what needs the
 * owner (stale, draft, no card), built-ins ahead of library blueprints, then by name. Anything
 * not shaped like an entry is dropped rather than guessed at.
 */
export function toCatalogueView(body: unknown): CatalogueView {
	const top = record(body);
	const list = Array.isArray(top?.blueprints) ? top.blueprints : [];
	const rows: CatalogueRow[] = [];
	for (const item of list) {
		const b = record(item);
		if (!b || !BLUEPRINT_ID.test(text(b.id))) continue;
		if (text(b.kind) && b.kind !== 'image') continue;
		const card = record(b.card);
		const status = statusOf(b.status, card !== null);
		const problems = Array.isArray(b.problems) ? b.problems.map(String) : [];
		rows.push({
			id: text(b.id),
			name: text(b.name) || text(b.id),
			builtin: b.builtin === true,
			status,
			offered: status === 'reviewed' && problems.length === 0,
			purpose: text(card?.purpose),
			rev: typeof card?.rev === 'number' ? card.rev : null,
			reviewedBy: text(card?.reviewedBy),
			reviewedAt: text(card?.reviewedAt),
			problems,
		});
	}
	rows.sort(
		(a, b) =>
			Number(b.offered) - Number(a.offered) ||
			ORDER[a.status] - ORDER[b.status] ||
			Number(b.builtin) - Number(a.builtin) ||
			a.name.localeCompare(b.name),
	);
	return { gpu: text(top?.gpu), rows };
}

/** The pill and the one line that says where a row stands with the agents. */
export function catalogueState(row: CatalogueRow): {
	label: string;
	tone: 'green' | 'amber' | 'red' | 'muted';
	why: string;
} {
	if (row.offered) return { label: 'offered', tone: 'green', why: 'Agents can use it.' };
	if (row.status === 'reviewed') {
		return {
			label: 'withheld',
			tone: 'red',
			why: 'Reviewed, but the card no longer matches the blueprint: fix it and review again.',
		};
	}
	if (row.status === 'stale') {
		return {
			label: 'stale',
			tone: 'red',
			why: 'The blueprint changed after its card was reviewed. Review it again to offer it.',
		};
	}
	if (row.status === 'draft') {
		return { label: 'draft', tone: 'amber', why: 'Not offered until the card is reviewed.' };
	}
	return {
		label: 'no card',
		tone: 'muted',
		why: 'Not offered. Add a card — it starts prefilled from the blueprint.',
	};
}

/** The Atlas Maker, opened on this blueprint's card editor (the launcher re-gates and re-launches). */
export const cardEditorUrl = (id: string): string => `/atlas?card=${encodeURIComponent(id)}`;
