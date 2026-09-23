/**
 * Cap the bitrate of an uploaded audio file as it is exported into `deploy/sounds/`.
 *
 * Why: nothing in the sound pipeline has ever looked at HOW an upload was encoded — the only
 * control is a 25 MB per-file cap (`soundLibrary.ts`), so whatever a composer exported is what
 * every player downloads. Measured on the Book of Borut remake: one music bed shipped at
 * **256 kbps / 48 kHz stereo for 224 s = 6.84 MB**, which is roughly a third of that game's
 * entire non-texture payload for a track that loops under a slot machine. At 128 kbps the same
 * bed is 3.42 MB, and on a looping game bed that difference is not audible.
 *
 * This NEVER touches the uploaded source (`sounds/files/`): that path deliberately never
 * destroys audio (see `soundFiles.ts` on orphans), so the cap applies to the exported COPY only
 * and re-exporting with `SOUND_TRANSCODE=0` restores the original bytes exactly.
 *
 * Same container in, same container out — an entry's `file` is the name the catalog and the
 * game resolve, so changing the extension would rename a sound mid-flight. That is also why
 * `wav` is left alone: capping a bitrate is meaningless for PCM, and the only real fix (encode
 * it to mp3) would rename it. A wav-heavy library is therefore still a size hazard.
 *
 * Temp FILES rather than stdin/stdout pipes on purpose: the mp4/m4a muxer needs a seekable
 * output and fails against a pipe unless it is fragmented, which would be a different file
 * layout for one format only.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';

/** The encoder to use per container, so a file comes back as the same kind it went in as. */
const CODEC_BY_EXT: Readonly<Record<string, string>> = {
	mp3: 'libmp3lame',
	ogg: 'libvorbis',
	m4a: 'aac',
	webm: 'libopus',
};

/**
 * Keep a re-encode only when it is a REAL win. Encoding a file that is already at or under the
 * cap buys nothing and costs a generation of lossy loss, and the output can even come back
 * larger — so the size test, not a bitrate probe, is what decides. That keeps this free of
 * `ffprobe` (which `ffmpeg-static` does not ship) and self-correcting for every container.
 */
const KEEP_BELOW = 0.9;

/** Give up rather than hold the export open on a pathological file. */
const TIMEOUT_MS = 120_000;

export function isTranscodableAudio(ext: string): boolean {
	return ext in CODEC_BY_EXT;
}

const run = (args: string[]): Promise<boolean> =>
	new Promise((resolve) => {
		if (!ffmpegPath) return resolve(false);
		execFile(ffmpegPath, args, { timeout: TIMEOUT_MS, windowsHide: true }, (err) => resolve(!err));
	});

/**
 * Re-encode `source` to at most `kbps`, or null to ship the source unchanged — which covers
 * every failure (no binary, unsupported container, ffmpeg error, timeout) and the case where
 * the result was not meaningfully smaller. A null is never an error the caller must handle:
 * the original bytes are always a correct answer.
 */
export async function capAudioBitrate(
	source: Uint8Array,
	ext: string,
	kbps: number,
): Promise<Buffer | null> {
	const codec = CODEC_BY_EXT[ext];
	if (!codec || !ffmpegPath) return null;

	let dir: string | undefined;
	try {
		dir = await mkdtemp(join(tmpdir(), 'ie-audio-'));
		const inPath = join(dir, `in.${ext}`);
		const outPath = join(dir, `out.${ext}`);
		await writeFile(inPath, source);

		// `-vn` drops cover art (an embedded JPEG would otherwise survive re-encoding and can be
		// a meaningful share of a small file); `-map_metadata -1` drops tags for the same reason.
		const ok = await run([
			'-y',
			'-loglevel',
			'error',
			'-i',
			inPath,
			'-vn',
			'-map_metadata',
			'-1',
			'-c:a',
			codec,
			'-b:a',
			`${kbps}k`,
			outPath,
		]);
		if (!ok) return null;

		const out = await readFile(outPath);
		return out.length > 0 && out.length < source.byteLength * KEEP_BELOW ? out : null;
	} catch {
		return null;
	} finally {
		if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}
