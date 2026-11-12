import { TextureAtlas, isIrigDocument } from 'engine-rig';
import { irigDocProblem } from './riggerIrig';
import { asIrigOrSpine42 } from './riggerNewRig';
import {
	OLDEST_UPGRADABLE,
	exportVersion,
	isUpgradableSpine3,
	upgradeSpine38Json,
} from './spine38Upgrade';

/** The page images an imported atlas may name, by extension, with the type R2 stores them under. */
export const IMPORT_PAGE_TYPES: Readonly<Record<string, string>> = {
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
};
export const MAX_IMPORT_PAGES = 64;
export const MAX_IMPORT_PAGE_BYTES = 64 * 1024 * 1024;

export type ImportRefusal = { ok: false; status: number; message: string };

const refuse = (status: number, message: string): ImportRefusal => ({ ok: false, status, message });

const pageExt = (name: string): string => {
	const dot = name.lastIndexOf('.');
	return dot === -1 ? '' : name.slice(dot).toLowerCase();
};

/**
 * The page images `atlasText` names, as the runtime's own atlas reader reads them. Every name must
 * be one file in the rig's folder (no path) with an image extension, and no two may differ only by
 * case: R2 keys are case-sensitive and a desktop export folder is not.
 */
export function importAtlasPages(
	atlasText: unknown,
): { ok: true; pages: string[]; text: string } | ImportRefusal {
	if (typeof atlasText !== 'string' || !atlasText.trim()) return refuse(400, 'missing atlas');
	let atlas: TextureAtlas;
	try {
		atlas = new TextureAtlas(atlasText);
	} catch (e) {
		return refuse(400, `the atlas could not be read (${(e as Error).message})`);
	}
	const pages = atlas.pages.map((p) => p.name);
	if (!pages.length) return refuse(400, 'the atlas names no page images');
	if (pages.length > MAX_IMPORT_PAGES)
		return refuse(400, `the atlas names over ${MAX_IMPORT_PAGES} pages`);
	const seen = new Set<string>();
	for (const page of pages) {
		if (/[/\\]/.test(page) || page.startsWith('.')) {
			return refuse(
				400,
				`the atlas page "${page}" is not beside the atlas; export with pages in one folder`,
			);
		}
		if (!IMPORT_PAGE_TYPES[pageExt(page)]) {
			return refuse(400, `the atlas page "${page}" is not a PNG, WebP or JPEG image`);
		}
		const low = page.toLowerCase();
		if (seen.has(low)) return refuse(400, `the atlas names the page "${page}" twice`);
		seen.add(low);
	}
	return { ok: true, pages, text: atlasText };
}

/**
 * The `.irig` an imported skeleton becomes, or why it cannot. A 4.x JSON export is imported as irig
 * v1 when that only drops keys the 4.2 reader ignores, and otherwise kept as 4.2, the rule every
 * new rig follows (`asIrigOrSpine42`); an `.irig` (a ⤓ .irig download) is taken as it is. A 3.8
 * export is first upgraded to 4.2 (`upgradeSpine38Json`); an older 3.x one is refused rather than
 * half read, since the upgrader is built on the 3.8 format. Either way the result must pass the reference checks a save passes (`irigDocProblem`).
 */
export function importSkeleton(
	skeleton: unknown,
): { ok: true; doc: Record<string, unknown> } | ImportRefusal {
	if (!skeleton || typeof skeleton !== 'object' || Array.isArray(skeleton)) {
		return refuse(400, 'the skeleton is not a JSON object');
	}
	const raw = skeleton as Record<string, unknown>;
	if (!isIrigDocument(raw)) {
		if (!Array.isArray(raw.bones))
			return refuse(400, 'this JSON is not a skeleton (it has no bones)');
		const version = exportVersion(raw);
		if (version && version[0] < 4 && !isUpgradableSpine3(raw)) {
			return refuse(
				422,
				`this skeleton was exported from version ${version.join('.')}; ` +
					`export it again from ${OLDEST_UPGRADABLE.join('.')} or later`,
			);
		}
	}
	const doc = isIrigDocument(raw)
		? raw
		: asIrigOrSpine42(
				isUpgradableSpine3(raw)
					? upgradeSpine38Json(raw)
					: (JSON.parse(JSON.stringify(raw)) as Record<string, unknown>),
			);
	const problem = irigDocProblem(doc);
	if (problem) return refuse(422, `this skeleton would not load (${problem})`);
	return { ok: true, doc };
}
