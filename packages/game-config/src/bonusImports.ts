/**
 * The `imports` record of a bonus IMPORTED from another project (`docs/design/pots-overlay.md` §5 A;
 * the import itself is `./imports`). Kept apart from the import so a game bundle that normalizes its
 * config never carries the presets the import builds on.
 */

import { GAME_MODE_ID, gameModeById } from './modes';
import type { GameConfigDoc } from './types';
import type { GameConfigIssue } from './validate';

/** Where an imported bonus came from. */
export type ImportedFrom = {
	/** The source project's key (same client). */
	project: string;
	/** The source feature's mode id in the source project. */
	mode: string;
	/** ISO time of the import or the last re-sync. */
	at: string;
};

/** One imported bonus, as the config records it. */
export type BonusImport = {
	/** The mode id it is in THIS project — what a pot's `bonus.mode` names. */
	mode: string;
	importedFrom: ImportedFrom;
	/** Every symbol the import brought: the source's name → its name here. A re-sync reuses it. */
	symbols: Record<string, string>;
	/** Added by "Add a bonus mode…" as a respin mode of its own (`importRespinMode`): a re-sync
	 *  updates that mode alone. Absent ⇒ the pots overlay's import, re-synced as it always was. */
	asMode?: true;
	/** With `asMode`: the mode id its screens, Flow tab and Win Text were last written under. A
	 *  `/config` rename moves `mode` but not those pieces, so the next re-sync clears them by this id
	 *  before it writes them again under `mode`. */
	wroteAs?: string;
};

/** This project's record of the bonus imported as `mode`, if it was imported. */
export const bonusImportOf = (
	doc: Pick<GameConfigDoc, 'imports'>,
	mode: string,
): BonusImport | undefined => doc.imports?.find((i) => i.mode === mode);

// ─── normalize + validate ───────────────────────────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const text = (v: unknown): string | undefined =>
	typeof v === 'string' && v.trim() ? v.trim() : undefined;

/** Normalize the `imports` records, or `undefined` when there are none. Structural only. */
export function normalizeBonusImports(raw: unknown): BonusImport[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const out: BonusImport[] = [];
	for (const entry of raw) {
		if (!isObject(entry) || !isObject(entry.importedFrom)) continue;
		const mode = text(entry.mode);
		const project = text(entry.importedFrom.project);
		const from = text(entry.importedFrom.mode);
		const at = text(entry.importedFrom.at);
		if (!mode || !GAME_MODE_ID.test(mode) || !project || !from || !at) continue;
		if (out.some((i) => i.mode === mode)) continue;
		const symbols: Record<string, string> = {};
		if (isObject(entry.symbols)) {
			for (const [name, local] of Object.entries(entry.symbols)) {
				const value = text(local);
				if (name.trim() && value) symbols[name] = value;
			}
		}
		const wroteAs = text(entry.wroteAs);
		out.push({
			mode,
			importedFrom: { project, mode: from, at },
			symbols,
			...(entry.asMode === true ? { asMode: true as const } : {}),
			...(entry.asMode === true && wroteAs && GAME_MODE_ID.test(wroteAs) ? { wroteAs } : {}),
		});
	}
	return out.length ? out : undefined;
}

/** A record whose mode or symbols are gone means a hand edit left a re-sync with nothing to keep. */
export function validateBonusImports(doc: GameConfigDoc): GameConfigIssue[] {
	const issues: GameConfigIssue[] = [];
	(doc.imports ?? []).forEach((record, i) => {
		const path = `imports.${i}`;
		if (!gameModeById(doc, record.mode)) {
			issues.push({
				severity: 'warning',
				path: `${path}.mode`,
				message: `"${record.mode}" was imported from "${record.importedFrom.project}", but this project has no such bonus any more.`,
			});
		}
		const missing = Object.values(record.symbols).filter((name) => !doc.symbols[name]);
		if (missing.length) {
			issues.push({
				severity: 'warning',
				path: `${path}.symbols`,
				message: `The import brought ${missing.join(', ')}, which the dictionary no longer has; a re-sync adds them back.`,
			});
		}
	});
	return issues;
}
