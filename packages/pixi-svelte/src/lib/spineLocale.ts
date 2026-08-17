import { i18n } from '@lingui/core';
import type * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';

/**
 * Rig text = LOCALIZED ART, and localization is an ATTACHMENT SWAP (design
 * `docs/design/invisible-cinematic.md` §12.4a).
 *
 * The Invisible Rigger rasterises a localization key once per reviewed locale into atlas
 * regions, and places ONE region attachment per locale in the same slot, named
 * `<base>@<locale>`, with the source locale as the slot's setup attachment. Nothing else about
 * those attachments is special — they are ordinary regions (or meshes, or linked meshes), which
 * is exactly why the `.irig` stays byte-valid Spine 4.2 with no sidecar.
 *
 * So all the runtime owes them is this: at mount, point each such slot at the attachment for
 * the locale the game is running. That is `skeleton.setAttachment`, standard Spine.
 *
 * TWO GUARDS, because this runs over EVERY attachment of EVERY rig in the game:
 *
 * 1. The suffix must look like a locale — a TWO-letter language with an optional subtag. A
 *    looser 2–3 letter rule classified `logo@big` as locale `big` (caught by the Rigger's gate).
 * 2. The swap only happens when the SIBLING `<base>@<locale>` attachment actually exists. That
 *    is the real guard: a name that slips past the pattern by coincidence has no sibling to
 *    swap to, so nothing can be hidden. It also means a rig baked without the running locale
 *    simply keeps its source-locale art — the honest fallback, never a blank slot.
 *
 * Known limit, stated rather than hidden: an ANIMATION that keys this slot's attachment by name
 * will re-assert the locale it was authored against. Rig text is meant to be shown/hidden and
 * deformed, not attachment-swapped, so that combination is an authoring mistake rather than a
 * case to work around here.
 */

/** Split `<base>@<locale>`, or `null` when the name carries no locale suffix. */
export function localeAttachmentSuffix(
	attachmentName: string,
): { base: string; locale: string } | null {
	const m = /^(.+)@([a-z]{2}(?:-[A-Za-z0-9]{2,8})?)$/.exec(attachmentName);
	if (!m) return null;
	return { base: m[1], locale: m[2] };
}

/**
 * The locale the game is running, from the Lingui singleton `state-shared` activates. Empty
 * before a catalog is activated (and in tools that never activate one), which this treats as
 * "no swap" — every rig then shows its source-locale art, byte-identical to before this existed.
 */
export function currentSpineLocale(): string {
	return i18n.locale ?? '';
}

/** Subscribe to locale changes so a mounted rig re-swaps on a language switch. */
export function onSpineLocaleChange(fn: () => void): () => void {
	try {
		return i18n.on('change', fn);
	} catch {
		return () => {};
	}
}

/**
 * Point every localized slot of `skeleton` at `locale`'s attachment. Returns how many slots
 * were swapped (0 for the overwhelming majority of rigs, which carry no localized attachment).
 *
 * Candidates are tried most-specific first: the exact tag, then its language-only prefix
 * (`pt-BR` → `pt`), so a rig baked for `pt` still serves a `pt-BR` player.
 */
export function applyLocaleAttachments(
	skeleton: SPINE_PIXI.Skeleton | undefined,
	locale: string,
): number {
	if (!skeleton || !locale) return 0;
	const skin = skeleton.skin ?? skeleton.data.defaultSkin;
	if (!skin) return 0;
	const dash = locale.indexOf('-');
	const langOnly = dash > 0 ? locale.slice(0, dash) : '';

	let swapped = 0;
	const slots = skeleton.data.slots;
	for (let i = 0; i < slots.length; i++) {
		// Key off the SETUP attachment: it is the one the Rigger wrote, and it names the base.
		const setupName = slots[i].attachmentName;
		if (!setupName) continue;
		const split = localeAttachmentSuffix(setupName);
		if (!split) continue;
		// Most specific first, and the SETUP locale last so an unbaked language reverts to the
		// source art. Comparing against the CURRENTLY ACTIVE attachment rather than the setup
		// name's locale is what makes this correct on a language CHANGE: keying off the setup
		// name meant switching back to the source locale was skipped as "already right" and the
		// rig kept showing the previous language (caught by the gate).
		const candidates = langOnly ? [locale, langOnly, split.locale] : [locale, split.locale];
		const current = skeleton.slots[i].getAttachment();
		for (const candidate of candidates) {
			const wanted = `${split.base}@${candidate}`;
			const attachment =
				skin.getAttachment(i, wanted) ?? skeleton.data.defaultSkin?.getAttachment(i, wanted);
			if (!attachment) continue;
			if (attachment !== current) {
				skeleton.slots[i].setAttachment(attachment);
				swapped++;
			}
			break;
		}
	}
	return swapped;
}
