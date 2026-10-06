import { inflateRawSync } from 'node:zlib';

/**
 * Read one file out of a ZIP archive — what a GitHub Actions artifact download is — either from
 * the whole archive held in memory (`readZipEntry`) or from pieces of it fetched by byte range
 * (`locateCentralDirectory` → `parseCentralDirectory` → `localDataOffset`), which is how one
 * image is read out of a report artifact of hundreds of megabytes without holding it.
 * Stored and deflated entries only, read through the central directory (so an archive written
 * with data descriptors, as `actions/upload-artifact` writes them, reads correctly). No ZIP64: an
 * artifact here is a few megabytes of changed screens, never 4 GB.
 */

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
/** The end-of-central-directory record is at most 22 bytes plus a 65,535-byte comment. */
export const EOCD_SEARCH = 22 + 0xffff;
/** A local file header is 30 bytes before its name and extra field. */
export const LOCAL_HEADER_BYTES = 30;
/** The most a local header's name plus extra field can add to those 30 bytes. */
export const LOCAL_HEADER_MAX_EXTRA = 2 * 0xffff;

export interface ZipEntry {
	name: string;
	/** 0 stored, 8 deflated. */
	method: number;
	compressedSize: number;
	size: number;
	/** Where the entry's local header starts in the archive. */
	localOffset: number;
}

export interface CentralDirectory {
	offset: number;
	size: number;
	count: number;
}

/**
 * Where the central directory is, read from the archive's tail. `tail` is the archive's last
 * bytes and `tailOffset` where they start in the archive (0 when `tail` is the whole archive).
 */
export function locateCentralDirectory(tail: Buffer, tailOffset: number): CentralDirectory {
	let eocd = -1;
	for (let i = tail.length - 22; i >= Math.max(0, tail.length - EOCD_SEARCH); i--) {
		if (tail.readUInt32LE(i) === EOCD_SIG) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error('not a ZIP archive (no end-of-central-directory record)');
	const count = tail.readUInt16LE(eocd + 10);
	const size = tail.readUInt32LE(eocd + 12);
	const offset = tail.readUInt32LE(eocd + 16);
	if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
		throw new Error('ZIP64 is not supported');
	}
	if (offset + size > tailOffset + eocd) throw new Error('corrupt ZIP central directory');
	return { offset, size, count };
}

/** The entries of a central directory, given its bytes alone. */
export function parseCentralDirectory(cd: Buffer, count: number): ZipEntry[] {
	const entries: ZipEntry[] = [];
	let offset = 0;
	for (let n = 0; n < count; n++) {
		if (offset + 46 > cd.length || cd.readUInt32LE(offset) !== CENTRAL_SIG) {
			throw new Error('corrupt ZIP central directory');
		}
		const nameLength = cd.readUInt16LE(offset + 28);
		const extraLength = cd.readUInt16LE(offset + 30);
		const commentLength = cd.readUInt16LE(offset + 32);
		const entry: ZipEntry = {
			name: cd.toString('utf8', offset + 46, offset + 46 + nameLength),
			method: cd.readUInt16LE(offset + 10),
			compressedSize: cd.readUInt32LE(offset + 20),
			size: cd.readUInt32LE(offset + 24),
			localOffset: cd.readUInt32LE(offset + 42),
		};
		if ([entry.compressedSize, entry.size, entry.localOffset].includes(0xffffffff)) {
			throw new Error('ZIP64 is not supported');
		}
		entries.push(entry);
		offset += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}

/**
 * How far into a local header its data starts: the fixed 30 bytes plus the name and extra field
 * it declares. `local` must hold at least the 30 fixed bytes.
 */
export function localDataOffset(local: Buffer, name: string): number {
	if (local.length < LOCAL_HEADER_BYTES || local.readUInt32LE(0) !== LOCAL_SIG) {
		throw new Error(`corrupt ZIP local header for ${name}`);
	}
	return LOCAL_HEADER_BYTES + local.readUInt16LE(26) + local.readUInt16LE(28);
}

/** The entry's bytes from its compressed form. `maxBytes` bounds what a deflated entry may
 *  inflate to, whatever its directory entry claims. */
export function unpackEntry(entry: ZipEntry, raw: Buffer, maxBytes: number): Buffer {
	if (entry.method === 0) return Buffer.from(raw);
	if (entry.method === 8) return inflateRawSync(raw, { maxOutputLength: maxBytes });
	throw new Error(`ZIP entry ${entry.name} uses compression method ${entry.method}`);
}

function entries(zip: Buffer): ZipEntry[] {
	const cd = locateCentralDirectory(zip, 0);
	return parseCentralDirectory(zip.subarray(cd.offset, cd.offset + cd.size), cd.count);
}

/**
 * The bytes of `name` out of a whole archive, or `null` when the archive has no such file.
 */
export function readZipEntry(zip: Buffer, name: string, maxBytes: number): Buffer | null {
	for (const entry of entries(zip)) {
		if (entry.name !== name) continue;
		const at = entry.localOffset;
		if (at + LOCAL_HEADER_BYTES > zip.length) {
			throw new Error(`corrupt ZIP local header for ${name}`);
		}
		const start = at + localDataOffset(zip.subarray(at, at + LOCAL_HEADER_BYTES), name);
		return unpackEntry(entry, zip.subarray(start, start + entry.compressedSize), maxBytes);
	}
	return null;
}
