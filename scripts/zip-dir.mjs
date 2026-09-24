/**
 * Zip a directory with nothing installed.
 *
 * WHY BY HAND, RATHER THAN A DEPENDENCY. `build-delivery.mjs` runs from a game repo's `engine/`
 * submodule and deliberately takes no per-repo setup — that is the entire reason it lives in the
 * engine rather than in `new-game.mjs`'s scaffold (see its header). A game repo installs from ITS
 * OWN lockfile, so an npm zip package would be present or absent depending on which repo we happen
 * to be standing in, and absent in exactly the case that matters: an older game that has never had
 * its scripts refreshed. `node:zlib` is always there.
 *
 * STORE OR DEFLATE, PER FILE, whichever is smaller. A delivery is mostly PNG/WEBP/KTX2/MP3 — already
 * compressed, so deflating them burns time and can make them BIGGER. Choosing per file costs one
 * comparison and means the zip is never larger than the folder.
 *
 * Deliberately NOT zip64: a delivery is tens of megabytes and a few thousand files, so the 32-bit
 * limits cannot be reached in practice — but they are CHECKED rather than assumed, because silently
 * writing a corrupt archive is the one failure a partner would discover instead of us.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

/** Names are written UTF-8; bit 11 is how a reader is told that, rather than guessing CP437. */
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

const MAX_ENTRIES = 0xffff;
const MAX_BYTES = 0xffffffff;

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i += 1) {
		let c = i;
		for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[i] = c >>> 0;
	}
	return table;
})();

const crc32 = (buf) => {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};

/**
 * MS-DOS date/time — the only timestamp a non-zip64 entry carries: two-second resolution, and an
 * epoch of 1980 that predates nothing we will ever build, but is clamped anyway because a file
 * stamped before it would encode as a negative year and read back as garbage.
 */
const dosStamp = (mtime) => {
	const date = mtime instanceof Date && !Number.isNaN(mtime.valueOf()) ? mtime : new Date();
	const year = Math.max(1980, date.getFullYear());
	return {
		time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
		date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
	};
};

/** Every file under `dir`, as paths relative to it, sorted so two runs of the same folder agree. */
const walk = (dir, base = dir) =>
	readdirSync(dir, { withFileTypes: true })
		.sort((a, b) => (a.name < b.name ? -1 : 1))
		.flatMap((entry) => {
			const full = join(dir, entry.name);
			return entry.isDirectory() ? walk(full, base) : [relative(base, full)];
		});

/**
 * Write every file under `sourceDir` into `outFile`.
 *
 * `root` nests the whole archive under one folder, which is what makes an unzip land in the shape
 * the partner's CDN expects (`{gameAlias}/game.js`) instead of spraying `game.js`, `_app/` and
 * `assets/` into whatever directory they happened to be standing in.
 *
 * Returns `{ files, bytes }` — the entry count and the size of the archive on disk.
 */
export const zipDir = (sourceDir, outFile, { root = '', extra = [] } = {}) => {
	// Zip paths are always `/`-separated, whatever the host filesystem calls a separator.
	const entries = [
		...walk(sourceDir).map((name) => {
			const posix = name.split(sep).join('/');
			return { zipPath: root ? `${root}/${posix}` : posix, file: join(sourceDir, name) };
		}),
		// ABOVE `root`, not inside it — `extra` is for files that travel WITH the upload but must
		// not be part of it. The partner's `embed.html` is the case: it belongs on their
		// application server, and a CDN that served it would be publishing their own server-side
		// source as plain text.
		...extra.map(({ name, file }) => ({ zipPath: name, file })),
	];

	if (entries.length > MAX_ENTRIES) {
		throw new Error(
			`${sourceDir} has ${entries.length} files; a non-zip64 archive holds ${MAX_ENTRIES}.`,
		);
	}

	const local = [];
	const central = [];
	let offset = 0;

	for (const { zipPath, file: full } of entries) {
		const body = readFileSync(full);
		const nameBuf = Buffer.from(zipPath, 'utf8');

		const deflated = deflateRawSync(body, { level: 9 });
		const shrank = deflated.length < body.length;
		const payload = shrank ? deflated : body;
		const method = shrank ? METHOD_DEFLATE : METHOD_STORE;

		const { time, date } = dosStamp(statSync(full).mtime);
		const crc = crc32(body);
		const localOffset = offset;

		// Before the size fields are written, not after: `writeUInt32LE` would otherwise throw a
		// bare ERR_OUT_OF_RANGE that names neither the file nor the limit it hit.
		if (body.length > MAX_BYTES || payload.length > MAX_BYTES) {
			throw new Error(`${full} is over 4GB; a non-zip64 entry cannot describe it.`);
		}

		const header = Buffer.alloc(30);
		header.writeUInt32LE(LOCAL_SIG, 0);
		header.writeUInt16LE(20, 4);
		header.writeUInt16LE(FLAG_UTF8, 6);
		header.writeUInt16LE(method, 8);
		header.writeUInt16LE(time, 10);
		header.writeUInt16LE(date, 12);
		header.writeUInt32LE(crc, 14);
		header.writeUInt32LE(payload.length, 18);
		header.writeUInt32LE(body.length, 22);
		header.writeUInt16LE(nameBuf.length, 26);
		header.writeUInt16LE(0, 28);
		local.push(header, nameBuf, payload);

		const entry = Buffer.alloc(46);
		entry.writeUInt32LE(CENTRAL_SIG, 0);
		entry.writeUInt16LE(20, 4);
		entry.writeUInt16LE(20, 6);
		entry.writeUInt16LE(FLAG_UTF8, 8);
		entry.writeUInt16LE(method, 10);
		entry.writeUInt16LE(time, 12);
		entry.writeUInt16LE(date, 14);
		entry.writeUInt32LE(crc, 16);
		entry.writeUInt32LE(payload.length, 20);
		entry.writeUInt32LE(body.length, 24);
		entry.writeUInt16LE(nameBuf.length, 28);
		entry.writeUInt16LE(0, 30);
		entry.writeUInt16LE(0, 32);
		entry.writeUInt16LE(0, 34);
		entry.writeUInt16LE(0, 36);
		entry.writeUInt32LE(0, 38);
		entry.writeUInt32LE(localOffset, 42);
		central.push(entry, nameBuf);

		offset += header.length + nameBuf.length + payload.length;
		if (offset > MAX_BYTES) {
			throw new Error(`${sourceDir} exceeds the 4GB a non-zip64 archive can address.`);
		}
	}

	const directory = Buffer.concat(central);
	if (directory.length > MAX_BYTES) {
		throw new Error(`${sourceDir} has a central directory over 4GB.`);
	}
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(EOCD_SIG, 0);
	eocd.writeUInt16LE(0, 4);
	eocd.writeUInt16LE(0, 6);
	eocd.writeUInt16LE(entries.length, 8);
	eocd.writeUInt16LE(entries.length, 10);
	eocd.writeUInt32LE(directory.length, 12);
	eocd.writeUInt32LE(offset, 16);
	eocd.writeUInt16LE(0, 20);

	const archive = Buffer.concat([...local, directory, eocd]);
	writeFileSync(outFile, archive);
	return { files: entries.length, bytes: archive.length };
};
