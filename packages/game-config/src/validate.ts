/**
 * Invisible Game Config — the LOUD half. {@link normalizeGameConfigDoc} silently drops what cannot
 * be interpreted; this reports what is merely wrong, so the author sees it in the tool and the bake
 * can refuse to ship it.
 *
 * The split exists because a canonicalizer runs at SAVE time, when the author may be mid-edit —
 * deleting their half-typed payline would destroy work. A validator runs when it matters (on the
 * page, at bake, at boot) and only ever talks.
 *
 * Severity is the whole point of the return shape:
 *  - `error` — the game will visibly misbehave (a payline pointing off the grid draws off-board).
 *  - `warning` — a config that renders but lies (a paytable row for a symbol no strip deals is the
 *    `W` bug verbatim: an advertised payout nobody can win).
 * Phase 3 turns the boot-time symbol check into the "loud warning for a symbol with no art" the
 * design doc calls for; the same function serves it.
 */

import { symbolsInPlay } from './inPlay';
import { resolveWinLevels } from './winLevels';
import type { GameConfigDoc } from './types';
import { resolveWinModel } from './winModel';

export type GameConfigIssueSeverity = 'error' | 'warning';

export type GameConfigIssue = {
	severity: GameConfigIssueSeverity;
	/** Dotted path into the doc, e.g. `paylines.7` or `symbols.W.paytable` — the tool uses it to
	 *  jump to the offending field. */
	path: string;
	message: string;
};

/**
 * Check a normalized doc against itself. Everything here is INTERNAL consistency; nothing needs
 * the RGS, the art, or the network, which is what makes it runnable in a fixture and at boot.
 *
 * Deliberately NOT checked: whether a symbol has art. That needs the symbol/asset registry, lives
 * on the other side of the bake, and belongs to the Symbols SM's surface — one fact, one home.
 */
export const validateGameConfigDoc = (doc: GameConfigDoc): GameConfigIssue[] => {
	const issues: GameConfigIssue[] = [];
	const inPlay = new Set(symbolsInPlay(doc));
	const maxRows = Math.max(...doc.numRows, 0);

	if (doc.numReels <= 0) {
		issues.push({ severity: 'error', path: 'numReels', message: 'Grid has no reels.' });
	}

	for (const [gameType, strips] of Object.entries(doc.paddingReels)) {
		if (strips.length !== doc.numReels) {
			issues.push({
				severity: 'error',
				path: `paddingReels.${gameType}`,
				message: `${gameType} has ${strips.length} reel strips but the grid is ${doc.numReels} reels wide.`,
			});
		}
		strips.forEach((strip, reel) => {
			// A strip shorter than the visible window cannot fill the column while spinning.
			if (strip.length && strip.length < maxRows) {
				issues.push({
					severity: 'error',
					path: `paddingReels.${gameType}.${reel}`,
					message: `Reel ${reel + 1} strip has ${strip.length} cells, fewer than the ${maxRows} visible rows.`,
				});
			}
		});
	}

	const winModel = resolveWinModel(doc);

	// Non-`lines` win models are not decided by paylines, so a leftover payline table is inert
	// rather than wrong — the checks below would report errors about a field the game never reads.
	// Each other arm gets the bounds check that IS meaningful for it.
	if (winModel.type !== 'lines') {
		const cells = doc.numRows.reduce((sum, rows) => sum + rows, 0);
		if (winModel.type === 'ways' && winModel.minKind > doc.numReels) {
			issues.push({
				severity: 'error',
				path: 'winModel.minKind',
				message: `Ways wins need ${winModel.minKind} adjacent reels but the grid is only ${doc.numReels} wide, so nothing can ever pay.`,
			});
		}
		if (winModel.type === 'cluster' && winModel.minCluster > cells) {
			issues.push({
				severity: 'error',
				path: 'winModel.minCluster',
				message: `A cluster needs ${winModel.minCluster} cells but the grid only has ${cells}, so nothing can ever pay.`,
			});
		}
		if (winModel.type === 'scatter' && winModel.minCount > cells) {
			issues.push({
				severity: 'error',
				path: 'winModel.minCount',
				message: `A scatter win needs ${winModel.minCount} symbols but the grid only has ${cells} cells, so nothing can ever pay.`,
			});
		}
	}

	for (const [id, rows] of winModel.type === 'lines' ? Object.entries(doc.paylines) : []) {
		if (rows.length !== doc.numReels) {
			issues.push({
				severity: 'error',
				path: `paylines.${id}`,
				message: `Payline ${id} covers ${rows.length} reels but the grid is ${doc.numReels} wide.`,
			});
			continue;
		}
		rows.forEach((row, reel) => {
			const height = doc.numRows[reel] ?? 0;
			if (row >= height) {
				issues.push({
					severity: 'error',
					path: `paylines.${id}`,
					message: `Payline ${id} points at row ${row + 1} on reel ${reel + 1}, which has ${height} rows.`,
				});
			}
		});
	}

	// Reel behaviour — every one of these describes a config that SAVES and RENDERS but silently
	// does nothing, which is the class of problem this validator exists to say out loud.
	const behaviour = doc.reelBehaviour;
	if (behaviour && behaviour.swapInPlace !== true) {
		if (behaviour.clearBoard) {
			issues.push({
				severity: 'warning',
				path: 'reelBehaviour.clearBoard',
				message:
					'Clear the board before the drop-in is set, but the board still rolls — a rolling round has no drop-in to clear ahead of, so this does nothing until Swap symbols in place is on.',
			});
		}
		if (behaviour.swapStyle) {
			issues.push({
				severity: 'warning',
				path: 'reelBehaviour.swapStyle',
				message:
					'A swap style is set but the board still rolls — the style only picks HOW a swap presents, so it does nothing until Swap symbols in place is on.',
			});
		}
	}
	// A column cascade DRAINS each column, which is already that column emptying. Running the clear
	// as well would be two clears for one round, so the resolver ignores it — say why.
	if (behaviour?.clearBoard && behaviour.swapInPlace && behaviour.swapStyle === 'columnCascade') {
		issues.push({
			severity: 'warning',
			path: 'reelBehaviour.clearBoard',
			message:
				'A column cascade already empties each column by draining it, so the separate clear step is ignored. It applies to the drop-in style.',
		});
	}
	if (behaviour?.swapStyle === 'columnCascade' && typeof behaviour.columnStaggerMs === 'number') {
		// Not a range check — `normalizeReelBehaviour` already clamped the value. What is left to say
		// is what a LEGAL value costs.
		const total = behaviour.columnStaggerMs * Math.max(0, doc.numReels - 1);
		if (total > 1000) {
			issues.push({
				severity: 'warning',
				path: 'reelBehaviour.columnStaggerMs',
				message: `Each column starts ${behaviour.columnStaggerMs} ms after the one before it, so on ${doc.numReels} reels the last column only starts ${total} ms in — every round is that much slower.`,
			});
		}
	} else if (typeof behaviour?.columnStaggerMs === 'number' && behaviour.swapInPlace) {
		issues.push({
			severity: 'warning',
			path: 'reelBehaviour.columnStaggerMs',
			message:
				'A column stagger is set but the swap style is the drop-in, which lands the whole board at once. Choose the column cascade style for the columns to fall at different times.',
		});
	}

	// The `W` bug, generalized: a payout advertised for a symbol the game never deals.
	for (const [name, symbol] of Object.entries(doc.symbols)) {
		if (inPlay.has(name)) continue;
		if (symbol.paytable?.length) {
			issues.push({
				severity: 'warning',
				path: `symbols.${name}.paytable`,
				message: `${name} pays in the paytable but appears on no reel strip, so the payout can never be won.`,
			});
		} else {
			issues.push({
				severity: 'warning',
				path: `symbols.${name}`,
				message: `${name} is in the dictionary but appears on no reel strip.`,
			});
		}
	}

	// The inverse, and the more dangerous one: the strips deal something the board cannot draw.
	for (const name of inPlay) {
		if (!doc.symbols[name]) {
			issues.push({
				severity: 'error',
				path: `symbols.${name}`,
				message: `${name} appears on a reel strip but has no entry in the symbol dictionary.`,
			});
		}
	}

	if (!Object.keys(doc.betModes).length) {
		issues.push({
			severity: 'error',
			path: 'betModes',
			message: 'No bet modes — the bet selector would have nothing to offer.',
		});
	}

	// Bet-mode presentation is optional, but when authored it can contradict the math it decorates.
	for (const [mode, presentation] of Object.entries(doc.betModePresentation ?? {})) {
		const math = doc.betModes[mode];
		// normalize already drops presentation for a non-existent mode, so `math` is present here.
		if (presentation.kind === 'buy' && math && !math.buyBonus) {
			issues.push({
				severity: 'warning',
				path: `betModePresentation.${mode}.kind`,
				message: `${mode} is shown as a "buy" card but its math is not a buyBonus mode — the purchase would not trigger the feature.`,
			});
		}
		if (presentation.kind === 'ante' && !presentation.text?.title) {
			issues.push({
				severity: 'warning',
				path: `betModePresentation.${mode}.text`,
				message: `${mode} is an ante mode with no title — it will fall back to its id in the menu.`,
			});
		}
	}

	// Win tiers are optional; when authored, the ladder must be internally consistent — the facade
	// emits a level by walking ascending thresholds, and the escalation start must name a real tier.
	const winTiers = resolveWinLevels(doc);
	if (winTiers) {
		const aliases = new Set<string>();
		let previous = -Infinity;
		for (const tier of winTiers) {
			if (aliases.has(tier.alias)) {
				issues.push({
					severity: 'error',
					path: `winLevels.${tier.level}.alias`,
					message: `Duplicate win-tier alias "${tier.alias}" — each tier needs a unique id.`,
				});
			}
			aliases.add(tier.alias);
			if (tier.threshold < previous) {
				issues.push({
					severity: 'error',
					path: `winLevels.${tier.level}.threshold`,
					message: `Tier "${tier.alias}" threshold ${tier.threshold} is below the previous tier — thresholds must ascend.`,
				});
			}
			previous = tier.threshold;
			if (tier.type === 'big' && !tier.animation) {
				issues.push({
					severity: 'warning',
					path: `winLevels.${tier.level}.animation`,
					message: `Big-win tier "${tier.alias}" has no intro/idle/outro animation — it will present as a plain number.`,
				});
			}
		}
		if (doc.escalateFrom && !aliases.has(doc.escalateFrom)) {
			issues.push({
				severity: 'error',
				path: 'escalateFrom',
				message: `escalateFrom "${doc.escalateFrom}" is not a win-tier alias.`,
			});
		}
		if (doc.escalateTiers && !doc.escalateFrom && !winTiers.some((tier) => tier.type === 'big')) {
			issues.push({
				severity: 'warning',
				path: 'escalateTiers',
				message:
					'Escalation is on but no tier is a big-win tier and no escalateFrom is set — nothing will escalate.',
			});
		}
	}

	return issues;
};

/** Only the blocking issues — what a bake or a publish refuses to ship. */
export const gameConfigErrors = (doc: GameConfigDoc): GameConfigIssue[] =>
	validateGameConfigDoc(doc).filter((issue) => issue.severity === 'error');
