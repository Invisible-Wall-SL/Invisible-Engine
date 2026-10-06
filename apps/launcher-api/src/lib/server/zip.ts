import { inflateRawSync } from 'node:zlib';

/**
 * Read one file out of a ZIP archive held in memory — what a GitHub Actions artifact download is.
 * Stored and deflated entries only, read through the central directory (so an archive written
 * with data descriptors, as `actions/upload-artifact` writes them, reads correctly). No ZIP64: an
 * artifact here is a few megabytes of changed screens, never 4 GB.
 */

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
/** The end-of-central-directory record is at most 22 bytes plus a 65,535-byte comment. */
const EOCD_SEARCH = 22 + 0xffff;

interface Entry {
	name: string;
	method: number;
	compressedSize: number;
	size: number;
	localOffset: number;
}

function* entries(zip: Buffer): Generator<Entry> {
	let eocd = -1;
	for (let i = zip.length - 22; i >= Math.max(0, zip.length - EOCD_SEARCH); i--) {
		if (zip.readUInt32LE(i) === EOCD_SIG) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error('not a ZIP archive (no end-of-central-directory record)');
	const count = zip.readUInt16LE(eocd + 10);
	let offset = zip.readUInt32LE(eocd + 16);
	for (let n = 0; n < count; n++) {
		if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== CENTRAL_SIG) {
			throw new Error('corrupt ZIP central directory');
		}
		const nameLength = zip.readUInt16LE(offset + 28);
		const extraLength = zip.readUInt16LE(offset + 30);
		const commentLength = zip.readUInt16LE(offset + 32);
		yield {
			name: zip.toString('utf8', offset + 46, offset + 46 + nameLength),
			method: zip.readUInt16LE(offset + 10),
			compressedSize: zip.readUInt32LE(offset + 20),
			size: zip.readUInt32LE(offset + 24),
			localOffset: zip.readUInt32LE(offset + 42),
		};
		offset += 46 + nameLength + extraLength + commentLength;
	}
}

/**
 * The bytes of `name`, or `null` when the archive has no such file. `maxBytes` bounds what a
 * deflated entry may inflate to, whatever its directory entry claims.
 */
export function readZipEntry(zip: Buffer, name: string, maxBytes: number): Buffer | null {
	for (const entry of entries(zip)) {
		if (entry.name !== name) continue;
		const at = entry.localOffset;
		if (at + 30 > zip.length || zip.readUInt32LE(at) !== LOCAL_SIG) {
			throw new Error(`corrupt ZIP local header for ${name}`);
		}
		const start = at + 30 + zip.readUInt16LE(at + 26) + zip.readUInt16LE(at + 28);
		const raw = zip.subarray(start, start + entry.compressedSize);
		if (entry.method === 0) return Buffer.from(raw);
		if (entry.method === 8) return inflateRawSync(raw, { maxOutputLength: maxBytes });
		throw new Error(`ZIP entry ${name} uses compression method ${entry.method}`);
	}
	return null;
}
