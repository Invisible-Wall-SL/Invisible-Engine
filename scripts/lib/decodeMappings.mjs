// Read a source map's `mappings` (Base64 VLQ) back into positions — for the fixtures that check a
// staged map resolves a chunk position to the right original line
// (`sentry-sourcemaps.fixture.mjs`, `sentry-sourcemaps-build.fixture.mjs`). Not shipped code.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = Object.fromEntries([...B64].map((c, i) => [c, i]));

const decodeSegment = (text) => {
	const out = [];
	let value = 0;
	let shift = 0;
	for (const char of text) {
		const digit = B64_INDEX[char];
		if (digit === undefined) throw new Error(`bad VLQ character '${char}'`);
		value += (digit & 31) << shift;
		if (digit & 32) {
			shift += 5;
			continue;
		}
		out.push(value & 1 ? -(value >>> 1) : value >>> 1);
		value = 0;
		shift = 0;
	}
	return out;
};

/** `mappings` → per generated line, absolute `[column, source, line, column]` segments. */
export function decodeMappings(mappings) {
	const state = [0, 0, 0, 0];
	return mappings.split(';').map((line) => {
		state[0] = 0;
		if (!line) return [];
		return line.split(',').map((segment) => {
			const fields = decodeSegment(segment);
			const abs = [];
			for (let i = 0; i < 4 && i < fields.length; i++) abs.push((state[i] += fields[i]));
			return abs;
		});
	});
}
