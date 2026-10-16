/**
 * Re-express one page's rotated regions as clockwise packing (`rotate:270`).
 *
 * A rig bundle's `.atlas` says `rotate:90` because its page is a private copy of the sheet page
 * with each rotated region turned 180°: our Atlas and Sheet Makers pack clockwise, and the rig
 * runtime used to read a quarter turn on a region only as counter-clockwise. Since it reads
 * `rotate:270` (clockwise), the export can ship the SHEET's own page instead of that copy — the
 * copy is saved lossless, 3–4× the lossy page it was made from, and loads as a second texture
 * beside it. The geometry is identical; only the direction changes, and only on `pageName`.
 *
 * Mirrors `atlasPageNames`' line model: the first line of a block is its page, a line with a colon
 * or leading whitespace is a property, any other line is a region name (so a region NAMED
 * `rotate_icon` is never touched).
 */
export function clockwiseOnPage(atlasText: string, pageName: string): string {
	let expectPage = true;
	let onPage = false;
	return atlasText
		.split(/\r?\n/)
		.map((line) => {
			if (line.trim() === '') {
				expectPage = true;
				return line;
			}
			const isProperty = /^\s/.test(line) || line.includes(':');
			if (!isProperty && expectPage) {
				expectPage = false;
				onPage = line.trim() === pageName;
				return line;
			}
			expectPage = false;
			const quarterTurn = /^(\s*)rotate\s*:\s*(?:90|true)\s*$/i.exec(line);
			return onPage && quarterTurn ? `${quarterTurn[1]}rotate:270` : line;
		})
		.join('\n');
}
