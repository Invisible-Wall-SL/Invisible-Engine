import {
	betModeCardParamRefs,
	gameConfigErrors,
	normalizeGameConfigDoc,
	validateGameConfigDoc,
	type BetModePresentationMap,
	type GameConfigDoc,
	type GameConfigIssue,
} from 'game-config';
import { createAtlasRefResolver, needsAtlasRefRepair } from './manifestBasename';
import { gameConfigDocKey } from './projectPaths';
import { ConflictError, getObjectTextWithEtag, precondition, putObjectText } from './r2';

/**
 * Invisible Game Config doc — the per-project GAME MATH CONTRACT (symbol dictionary + paytable,
 * paylines, grid, bet modes, identity/RTP, cosmetic reel strips), authored online and shipped to
 * the game through the bake in place of the ONE `apps/lines/src/game/config.ts` compiled into the
 * shared `_runtime/lines` bundle.
 *
 * Pure config, no assets, so it needs no `deploy/` export step and travels verbatim (the
 * `symbols.winLine` / win-text precedent). **DENSE**, unlike every other doc in this pipeline: a
 * project either has a whole config or has none and falls through to the compiled template. There
 * is therefore no `emptyGameConfigDoc()` — an empty config has no symbols and no strips, so
 * shipping one would blank the board. "No doc" is represented as `null` and means "use the
 * template", which is the dev-parity contract.
 *
 * The TYPE, the canonicalizer and the validator all live in `packages/game-config` because the
 * game, the bake and this tool must agree, and that package is dependency-free so the contract is
 * fixture-verifiable offline (`tools/game-config-spike`).
 *
 * **Deliberate deviation from the design doc**, which called for a Zod schema here: a Zod mirror of
 * `GameConfigDoc` would be a SECOND answer to "what is a valid config", hand-copied beside the
 * canonicalizer, in an app whose `build` is not a type-check — the exact shape of the bug that
 * silently stripped author params twice (`COMPONENT_PARAM_KINDS`, see `apps/launcher-api/
 * CLAUDE.md`). `normalizeGameConfigDoc` + `validateGameConfigDoc` are that one answer, and they
 * produce better 400s than Zod would: field-pathed, severity-tagged, author-readable.
 *
 * See `docs/design/invisible-game-config.md`.
 */

/**
 * Thrown when a posted config cannot be shipped. Carries the issue list so the PUT endpoint can
 * hand the author the actual problems ("payline 7 points at row 4 on a 3-row reel") rather than a
 * bare 400 — the paste-in-from-the-math-team flow is exactly where these fire.
 */
export class InvalidGameConfigError extends Error {
	constructor(readonly issues: GameConfigIssue[]) {
		super(issues.map((i) => `${i.path}: ${i.message}`).join('; ') || 'Not a usable game config');
		this.name = 'InvalidGameConfigError';
	}
}

/**
 * Canonicalize + gate a posted config. Throws {@link InvalidGameConfigError} on anything that
 * cannot ship; WARNINGS are returned alongside the doc instead, because a config that renders but
 * lies (a paytable row for a symbol no strip deals) is exactly the state an author passes through
 * while editing, and refusing to save it would make the tool unusable.
 */
export function prepareGameConfigDoc(input: unknown): {
	doc: GameConfigDoc;
	warnings: GameConfigIssue[];
} {
	const doc = normalizeGameConfigDoc(input);
	if (!doc) {
		throw new InvalidGameConfigError([
			{
				severity: 'error',
				path: '',
				message: 'A config needs both a symbol dictionary and at least one reel strip.',
			},
		]);
	}
	const errors = gameConfigErrors(doc);
	if (errors.length) throw new InvalidGameConfigError(errors);
	return { doc, warnings: validateGameConfigDoc(doc) };
}

/**
 * Load a project's config doc WITH its ETag — the read half of the conditional-write contract
 * (`docs/design/multi-user-concurrency.md`).
 *
 * `existed` is reported separately from the doc, and that separation is load-bearing rather than
 * ceremony: a MISSING object and a PRESENT-but-unparseable one both yield `doc: null`, but they
 * need OPPOSITE preconditions. Collapsing them would give a corrupt `config.json` an
 * `ifNoneMatch: '*'` precondition forever ⇒ 412 forever ⇒ the project becomes permanently
 * unsaveable with no way out from the UI. Carrying the corrupt object's ETag lets it be
 * deliberately overwritten.
 */
export async function loadGameConfigDocWithEtag(
	clientKey: string,
	projectKey: string,
): Promise<{ doc: GameConfigDoc | null; etag: string | null; existed: boolean }> {
	const obj = await getObjectTextWithEtag(gameConfigDocKey(clientKey, projectKey));
	if (!obj) return { doc: null, etag: null, existed: false };
	try {
		return {
			doc: normalizeGameConfigDoc(JSON.parse(obj.text)) ?? null,
			etag: obj.etag,
			existed: true,
		};
	} catch {
		return { doc: null, etag: obj.etag, existed: true };
	}
}

/**
 * Whether any `cardParams` value is an atlas-scoped frame ref the RUNTIME cannot scope by — gates
 * the R2 lookups below so a correctly-authored config pays nothing.
 */
function anyRepairableCardParamRef(doc: GameConfigDoc): boolean {
	return betModeCardParamRefs(doc).some(({ cardParams }) =>
		Object.values(cardParams).some((value) => {
			if (typeof value !== 'string') return false;
			const i = value.indexOf('::');
			return i > 0 && needsAtlasRefRepair(value.slice(0, i));
		}),
	);
}

/**
 * Repair the per-mode `cardParams` frame refs to full manifest keys — the config's half of the
 * shared atlas-ref repair (`manifestBasename.ts`), and the exact counterpart of what
 * `loadFlipbookDoc` does for clips.
 *
 * A card's `image`-kind param stores `<atlas>::<frame>`, and the region picker can write the atlas
 * as a Sheet-Maker OUTPUT PREFIX (`<client>/<project>/sheets/S_Gem/`) rather than the full
 * `<path>/<name>.json` manifest key. The editor-art export registers each sheet's frames under the
 * MANIFEST key, so an output-prefix ref names a namespace that is never registered: the sprite
 * resolves nothing and the card's art is simply absent in-game. Repairing here — the one loader
 * every ship-path reader goes through (`runtimeBundle`, `editorArtExport`, `publishGame`) — makes
 * the export ship the right sheet AND the runtime look it up under the same key.
 *
 * A ref that cannot be resolved comes back untouched (the resolver only ever makes a ref MORE
 * specific), and `parseScopedFrameRef` then degrades it to the bare frame name rather than dropping
 * the art. The editor's own read path is `loadGameConfigDocWithEtag`, which is deliberately NOT
 * repaired: it backs the conditional-write contract, and a save must round-trip what was loaded.
 */
async function repairCardParamAtlasRefs(
	doc: GameConfigDoc,
	clientKey: string,
	projectKey: string,
): Promise<GameConfigDoc> {
	if (!anyRepairableCardParamRef(doc)) return doc;
	const resolve = createAtlasRefResolver(clientKey, projectKey);
	const presentation: BetModePresentationMap = {};
	for (const [mode, entry] of Object.entries(doc.betModePresentation ?? {})) {
		if (!entry.cardParams) {
			presentation[mode] = entry;
			continue;
		}
		const cardParams: Record<string, string | number | boolean> = {};
		for (const [key, value] of Object.entries(entry.cardParams)) {
			const i = typeof value === 'string' ? value.indexOf('::') : -1;
			if (typeof value !== 'string' || i <= 0) {
				cardParams[key] = value;
				continue;
			}
			const prefix = value.slice(0, i);
			const full = await resolve(prefix);
			cardParams[key] = full === prefix ? value : `${full}::${value.slice(i + 2)}`;
		}
		presentation[mode] = { ...entry, cardParams };
	}
	return { ...doc, betModePresentation: presentation };
}

/**
 * The doc alone — for readers with nothing to write back (the bake export, the runtime bundle).
 * `null` means "this project has not authored a config", which every consumer must treat as
 * "fall through to the compiled template", NOT as "no symbols".
 *
 * Ship-path only, so this is also where un-scopeable atlas refs are repaired — see
 * {@link repairCardParamAtlasRefs}.
 */
export async function loadGameConfigDoc(
	clientKey: string,
	projectKey: string,
): Promise<GameConfigDoc | null> {
	const { doc } = await loadGameConfigDocWithEtag(clientKey, projectKey);
	return doc ? repairCardParamAtlasRefs(doc, clientKey, projectKey) : doc;
}

/**
 * Persist a project's config doc to R2 (canonicalizes, gates, stamps `updatedAt`).
 *
 * `baseEtag` is the precondition: a string ⇒ `If-Match` (fail if it changed since the author
 * loaded it), `null` ⇒ `If-None-Match: *` (fail if someone created it meanwhile), `undefined` ⇒
 * unconditional last-writer-wins. Throws {@link ConflictError} when the precondition loses — the
 * endpoint MUST map that to a 409 via `json()`, never `error()`.
 *
 * Without this, two authors on one project silently clobber each other's ENTIRE config: the page
 * loads the whole doc and PUTs the whole doc, so the second save erases the first's work, not just
 * the conflicting field. `updatedAt` alone can't catch it — it's stamped, never compared.
 */
export async function saveGameConfigDoc(
	clientKey: string,
	projectKey: string,
	input: unknown,
	baseEtag?: string | null,
): Promise<{ doc: GameConfigDoc; etag: string | null; warnings: GameConfigIssue[] }> {
	const { doc, warnings } = prepareGameConfigDoc(input);
	const stamped: GameConfigDoc = { ...doc, updatedAt: new Date().toISOString() };
	const etag = await putObjectText(
		gameConfigDocKey(clientKey, projectKey),
		JSON.stringify(stamped, null, 2),
		'application/json',
		precondition(baseEtag),
	);
	return { doc: stamped, etag, warnings };
}

export { ConflictError };
