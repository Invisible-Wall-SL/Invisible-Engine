/**
 * Invisible Flipbook — group region names into consecutively-numbered runs, i.e. candidate
 * clips (design doc `invisible-flipbook.md`).
 *
 * A packed sheet states its animations in its filenames — `anim-sym-pic1_00 … _48` is 49
 * frames of one animation — and making an author click 49 thumbnails to rebuild what the
 * names already say is the wrong default.
 *
 * Runs over REGION NAMES, so it works for any sheet: one imported verbatim from a `.plist`,
 * or one packed in the Sheet Maker from a dropped image sequence. (The plist importer also
 * records what it found in the manifest's `sequences`, but that is provenance — the tool does
 * not depend on it, so an authored sheet gets the same offer.)
 *
 * Mirrors `services/sheet-tool/plist_import.py`'s `detect_sequences`; the two are checked
 * against the same cases so a sheet groups identically whichever side looks at it.
 */

/** One consecutively-numbered run of frames sharing a stem. */
export interface DetectedSequence {
	/** The shared prefix, with any trailing separator stripped — a natural clip name. */
	stem: string;
	/** Frame names in NUMERIC order. */
	frames: string[];
}

/** One sheet's region names, for cross-sheet detection. */
export interface SheetRegions {
	assetKey: string;
	regions: string[];
}

/** A run that may span sheets, with its frames already encoded as clip entries. */
export interface DetectedSequenceAcross {
	stem: string;
	/** Suggested `clip.assetKey` — the sheet contributing the MOST frames, so the stored doc
	 * carries as few scoped refs as possible. */
	primary: string;
	/** Frame entries in numeric order: a bare region name when it lives on `primary`, otherwise
	 * a scoped `<assetKey>::<region>` ref. Ready to drop straight into `clip.frames`. */
	frames: string[];
	/** Every sheet the run draws from. Length 1 ⇒ an ordinary single-sheet clip. */
	sheets: string[];
}

const SEQ = /^(.*?)[_-]?(\d+)$/;

/**
 * Group `names` into consecutively-numbered runs of at least `minLength`.
 *
 * Two rules that are easy to get wrong:
 * - Ordering is NUMERIC, not lexicographic, so `f2` precedes `f10`. The same bug the Sheet
 *   Maker's `natural_key` fixes on upload; getting it wrong here would silently author a
 *   scrambled animation.
 * - A gap SPLITS a run. A hole in the numbering almost always means two animations packed on
 *   one sheet, not one animation missing a frame — and silently bridging the gap would
 *   produce a clip that jumps.
 *
 * Longest runs first, so the most likely clip is offered first.
 */
export function detectSequences(names: string[], minLength = 3): DetectedSequence[] {
	const groups = new Map<string, { num: number; name: string }[]>();
	for (const name of names) {
		const m = typeof name === 'string' ? SEQ.exec(name) : null;
		if (!m) continue;
		const stem = m[1];
		const list = groups.get(stem);
		if (list) list.push({ num: Number(m[2]), name });
		else groups.set(stem, [{ num: Number(m[2]), name }]);
	}

	const out: DetectedSequence[] = [];
	for (const [stem, items] of groups) {
		items.sort((a, b) => a.num - b.num);
		let run: { num: number; name: string }[] = [];
		const flush = (): void => {
			if (run.length >= minLength) out.push({ stem, frames: run.map((i) => i.name) });
		};
		for (const item of items) {
			// `!==  + 1` rather than `>` so a DUPLICATE number also breaks the run: two frames
			// claiming the same index are ambiguous, not a sequence.
			if (run.length > 0 && item.num !== run[run.length - 1].num + 1) {
				flush();
				run = [];
			}
			run.push(item);
		}
		flush();
	}
	out.sort((a, b) => b.frames.length - a.frames.length || a.stem.localeCompare(b.stem));
	return out;
}

/**
 * The same detection run across SEVERAL sheets at once — the form an author actually needs.
 *
 * A multipacked export scatters one animation over its pages, so per-sheet detection finds only
 * fragments. On a real 4-page export of a 49-frame sequence, the pages individually offered runs
 * of 6, then 7/4/3, then 3/3/3, then nothing — while the union is the single 49-frame animation
 * that was authored. Detecting per sheet is technically correct and practically useless.
 *
 * Frames come back as clip entries (bare on `primary`, scoped elsewhere), so the result drops
 * straight into `clip.frames`.
 */
export function detectSequencesAcross(
	sheets: SheetRegions[],
	minLength = 3,
): DetectedSequenceAcross[] {
	const groups = new Map<string, { num: number; region: string; assetKey: string }[]>();
	for (const sheet of sheets) {
		for (const region of sheet.regions ?? []) {
			const m = typeof region === 'string' ? SEQ.exec(region) : null;
			if (!m) continue;
			const entry = { num: Number(m[2]), region, assetKey: sheet.assetKey };
			const list = groups.get(m[1]);
			if (list) list.push(entry);
			else groups.set(m[1], [entry]);
		}
	}

	const out: DetectedSequenceAcross[] = [];
	for (const [stem, items] of groups) {
		items.sort((a, b) => a.num - b.num);
		let run: typeof items = [];
		const flush = (): void => {
			if (run.length < minLength) return;
			// Primary = the sheet contributing the most frames, so the stored doc needs the fewest
			// scoped refs (and a run that happens to sit on one sheet stores no scoped refs at all).
			const tally = new Map<string, number>();
			for (const i of run) tally.set(i.assetKey, (tally.get(i.assetKey) ?? 0) + 1);
			let primary = run[0].assetKey;
			let best = -1;
			for (const [key, n] of tally) {
				if (n > best) {
					best = n;
					primary = key;
				}
			}
			out.push({
				stem,
				primary,
				frames: run.map((i) => (i.assetKey === primary ? i.region : `${i.assetKey}::${i.region}`)),
				sheets: [...tally.keys()],
			});
		};
		for (const item of items) {
			// A duplicate index breaks the run exactly as in the single-sheet case — but here it is
			// the likelier failure, since two sheets can legitimately carry the same region name.
			// Guessing which one belongs to the animation would silently author the wrong frame.
			if (run.length > 0 && item.num !== run[run.length - 1].num + 1) {
				flush();
				run = [];
			}
			run.push(item);
		}
		flush();
	}
	out.sort((a, b) => b.frames.length - a.frames.length || a.stem.localeCompare(b.stem));
	return out;
}
