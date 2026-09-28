/**
 * Author `sfx_btn_stop` — the slam-stop press cue — and cut it into the shipped audiosprite.
 *
 *   node scripts/author-sfx-btn-stop.mjs --wav out.wav   # render the cue alone, to audition
 *   node scripts/author-sfx-btn-stop.mjs                 # re-cut the sprite in every audio app
 *
 * The cue is SYNTHESISED, not sampled: a noise click for the instant of contact, a pitch-dropping
 * thump for the weight of a brake, and a short inharmonic latch ring for the catch. Everything is
 * deterministic (seeded noise), so this file IS the source — there is no recording or
 * licence behind it to track. Its level is matched to the two cues it sits between: `sfx_btn_general`
 * (the UI click it replaces) and `sfx_btn_spin` (the press it must be told apart from), both of
 * which peak at about -10 dBFS.
 *
 * WHY THE SPRITE IS APPENDED TO, NOT RE-ENCODED. Decoding the 406 s sprite and encoding it again at
 * its own settings measures ~20 dB SNR against what ships today (ogg 19.5 dB, mp3 21.7 dB): a
 * generation of loss on every sound in the game, to add one. So the cue is encoded ALONE with the
 * sprite's exact settings and joined on with a stream copy, which leaves every existing byte of
 * audio untouched — and the script proves it, by decoding the result and requiring the old sprite
 * back sample-for-sample.
 *
 * Each container shifts an appended stream by its own amount (encoder delay, priming, frame
 * padding at the join), so the lead-in silence is measured per container and corrected until the
 * cue lands on the SAME sample everywhere — one `sounds.json` region has to be right for all four.
 * `ac3` has no gapless metadata and already decodes every region 256 samples late; the cue is
 * placed with that same skew rather than "fixed", so ac3 treats it like every other region.
 *
 * Needs an ffmpeg with libvorbis, libmp3lame, aac and ac3: `$FFMPEG`, else the launcher's
 * `ffmpeg-static`, else `ffmpeg` on the PATH. One-shot: it refuses a sprite whose `sfx_btn_stop`
 * is no longer the `sfx_btn_general` stand-in, so re-authoring starts from the stand-in's files.
 */
import { execFileSync } from 'node:child_process';
import {
	copyFileSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SEED_APP = 'lines';
const OTHER_APPS = ['cluster', 'price', 'scatter', 'ways'];
const KEY = 'sfx_btn_stop';
const STAND_IN = 'sfx_btn_general';
const SKEW_REFERENCE = 'sfx_btn_spin';

const SR = 44100;
const PEAK_DBFS = -9.5;

/** The sprite's own encoder settings, read off the shipped files (all Lavc60 at 44.1 kHz stereo). */
const FORMATS = {
	ogg: ['-c:a', 'libvorbis', '-b:a', '96k'],
	m4a: ['-c:a', 'aac', '-b:a', '80k'],
	mp3: ['-c:a', 'libmp3lame', '-b:a', '96k'],
	ac3: ['-c:a', 'ac3', '-b:a', '96k'],
};

// ---------------------------------------------------------------------------------------------
// The cue
// ---------------------------------------------------------------------------------------------

function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const onePoleCoeff = (hz) => Math.exp((-2 * Math.PI * hz) / SR);

/** Band-limited noise: one-pole high-pass then one-pole low-pass. */
function bandNoise(n, seed, lowHz, highHz) {
	const rnd = mulberry32(seed);
	const hp = onePoleCoeff(lowHz);
	const lp = onePoleCoeff(highHz);
	const out = new Float64Array(n);
	let hpIn = 0;
	let hpOut = 0;
	let lpOut = 0;
	for (let i = 0; i < n; i++) {
		const x = rnd() * 2 - 1;
		hpOut = hp * (hpOut + x - hpIn);
		hpIn = x;
		lpOut = (1 - lp) * hpOut + lp * lpOut;
		out[i] = lpOut;
	}
	return out;
}

const env = (t, attack, tau) =>
	t < 0 ? 0 : t < attack ? t / attack : Math.exp(-(t - attack) / tau);

/** Stereo interleaved Float32, peak-normalised to `PEAK_DBFS`, ending on exact silence. */
function synthesizeCue() {
	const n = Math.round(0.3 * SR);
	const fadeOut = Math.round(0.04 * SR);
	const clickNoise = [bandNoise(n, 11, 1800, 7500), bandNoise(n, 12, 1800, 7500)];
	const tailNoise = [bandNoise(n, 21, 250, 2400), bandNoise(n, 22, 250, 2400)];
	const latch = [
		{ hz: 540, gain: 0.34, tau: 0.028 },
		{ hz: 1240, gain: 0.2, tau: 0.03 },
		{ hz: 1873, gain: 0.12, tau: 0.022 },
		{ hz: 2957, gain: 0.07, tau: 0.012 },
	];
	const latchAt = 0.018;

	const out = new Float32Array(n * 2);
	let thumpPhase = 0;
	let peak = 0;
	for (let i = 0; i < n; i++) {
		const t = i / SR;
		thumpPhase += (2 * Math.PI * (150 + 230 * Math.exp(-t / 0.02))) / SR;
		const thump = Math.tanh(1.6 * Math.sin(thumpPhase) * env(t, 0.0015, 0.03)) * 0.45;
		const lt = t - latchAt;
		let ring = 0;
		for (const p of latch)
			ring += p.gain * Math.sin(2 * Math.PI * p.hz * lt) * env(lt, 0.0008, p.tau);
		const clickEnv = env(t, 0.0004, 0.0035) + 0.35 * env(lt, 0.0003, 0.002);
		const tailEnv = env(t, 0.002, 0.06) * 0.14;
		const fade = i >= n - fadeOut ? (n - 1 - i) / fadeOut : 1;
		for (let c = 0; c < 2; c++) {
			const click = (0.8 * clickNoise[0][i] + 0.2 * clickNoise[c][i]) * clickEnv * 2.2;
			const tail = (0.7 * tailNoise[0][i] + 0.3 * tailNoise[c][i]) * tailEnv * 3;
			const v = (thump + ring + click + tail) * fade;
			out[i * 2 + c] = v;
			peak = Math.max(peak, Math.abs(v));
		}
	}
	const gain = 10 ** (PEAK_DBFS / 20) / peak;
	for (let i = 0; i < out.length; i++) out[i] *= gain;
	return out;
}

function wavFloat32(pcm) {
	const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
	const h = Buffer.alloc(44);
	h.write('RIFF', 0);
	h.writeUInt32LE(36 + data.length, 4);
	h.write('WAVEfmt ', 8);
	h.writeUInt32LE(16, 16);
	h.writeUInt16LE(3, 20);
	h.writeUInt16LE(2, 22);
	h.writeUInt32LE(SR, 24);
	h.writeUInt32LE(SR * 8, 28);
	h.writeUInt16LE(8, 32);
	h.writeUInt16LE(32, 34);
	h.write('data', 36);
	h.writeUInt32LE(data.length, 40);
	return Buffer.concat([h, data]);
}

// ---------------------------------------------------------------------------------------------
// ffmpeg
// ---------------------------------------------------------------------------------------------

function findFfmpeg() {
	if (process.env.FFMPEG) return process.env.FFMPEG;
	try {
		const req = createRequire(join(ROOT, 'apps/launcher-api/package.json'));
		const p = req('ffmpeg-static');
		if (p && existsSync(p)) return p;
	} catch {
		// not installed in this checkout — fall through to the PATH
	}
	return 'ffmpeg';
}

const FFMPEG = findFfmpeg();
const ff = (args) =>
	execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
		maxBuffer: 1 << 30,
	});

/** Interleaved stereo — identity is judged on both channels, alignment on their mix. */
const decode = (file) => {
	const b = ff(['-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-']);
	return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};

/** The first `count` packets of an Ogg stream, reassembled from the page lacing. */
function oggPackets(bytes, count) {
	const packets = [];
	let current = [];
	for (let at = 0; packets.length < count; ) {
		if (bytes.toString('latin1', at, at + 4) !== 'OggS') throw new Error('not an Ogg page');
		const segments = bytes[at + 26];
		let body = at + 27 + segments;
		for (let s = 0; s < segments && packets.length < count; s++) {
			const len = bytes[at + 27 + s];
			current.push(bytes.subarray(body, body + len));
			body += len;
			if (len < 255) {
				packets.push(Buffer.concat(current));
				current = [];
			}
		}
		at = body;
	}
	return packets;
}

/**
 * The codec setup the appended packets decode against, which a stream copy cannot carry over. For
 * Vorbis that is the identification and setup headers — NOT ffmpeg's extradata, which also carries
 * the comment header and so differs on nothing but the encoder's vendor string. For m4a it is the
 * AudioSpecificConfig. mp3 and ac3 frames are self-describing and have none (both sides are empty);
 * a mismatch there is caught by the decode checks instead.
 */
function codecSetupOf(file, ext) {
	if (ext === 'ogg') {
		const [id, , setup] = oggPackets(readFileSync(file), 3);
		return Buffer.concat([id, setup]).toString('base64');
	}
	const crc = ff(['-i', file, '-c', 'copy', '-f', 'framecrc', '-']).toString();
	return /^#extradata 0:.*$/m.exec(crc)?.[0] ?? '';
}

// ---------------------------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------------------------

/** Lag of `needle` inside `hay` around `expected`, by normalised cross-correlation. */
function locate(hay, needle, expected, radius) {
	let best = { lag: -1, score: -Infinity };
	let nn = 0;
	for (const v of needle) nn += v * v;
	for (let lag = expected - radius; lag <= expected + radius; lag++) {
		if (lag < 0 || lag + needle.length > hay.length) continue;
		let dot = 0;
		let hh = 0;
		for (let i = 0; i < needle.length; i++) {
			const h = hay[lag + i];
			dot += h * needle[i];
			hh += h * h;
		}
		const score = hh > 0 ? dot / Math.sqrt(hh * nn) : 0;
		if (score > best.score) best = { lag, score };
	}
	return best;
}

function mixToMono(stereo) {
	const m = new Float32Array(stereo.length / 2);
	for (let i = 0; i < m.length; i++) m[i] = (stereo[i * 2] + stereo[i * 2 + 1]) / 2;
	return m;
}

// ---------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------

const argIndex = process.argv.indexOf('--wav');
const cue = synthesizeCue();

if (argIndex !== -1) {
	const out = resolve(process.argv[argIndex + 1] ?? 'sfx_btn_stop.wav');
	writeFileSync(out, wavFloat32(cue));
	console.log(`✓ wrote ${out} (${((cue.length / 2 / SR) * 1000).toFixed(1)} ms)`);
	process.exit(0);
}

const audioDir = (app) => join(ROOT, 'apps', app, 'static/assets/audio');
const seedDir = audioDir(SEED_APP);
const manifestPath = join(seedDir, 'sounds.json');
const manifestText = readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(manifestText);
const sprite = manifest.sprite;

if (JSON.stringify(sprite[KEY]) !== JSON.stringify(sprite[STAND_IN])) {
	console.error(`✗ ${KEY} is no longer the ${STAND_IN} stand-in — already authored. Refusing.`);
	process.exit(1);
}
for (const app of OTHER_APPS) {
	for (const f of ['sounds.json', ...Object.keys(FORMATS).map((e) => `sounds.${e}`)]) {
		if (!readFileSync(join(audioDir(app), f)).equals(readFileSync(join(seedDir, f)))) {
			console.error(`✗ apps/${app} ${f} differs from apps/${SEED_APP}'s — not the same sprite.`);
			process.exit(1);
		}
	}
}

// The sprite packs each region on a whole second at least one second past the previous sound's end,
// which is also where the shipped file ends. One second more gives every container room for its
// own lead-in before the cue — ac3's last frame already runs past that boundary.
const lastEnd = Math.max(...Object.values(sprite).map(([start, dur]) => start + dur));
const startMs = Math.ceil((lastEnd + 1000) / 1000) * 1000 + 1000;
const cueMono = mixToMono(cue);
const cueFrames = cueMono.length;
const durMs = (cueFrames / SR) * 1000;
const target = Math.round((startMs / 1000) * SR);
const needle = cueMono.subarray(0, Math.round(0.08 * SR));

const work = mkdtempSync(join(tmpdir(), 'ie-sfx-btn-stop-'));
const outputs = {};
try {
	const reference = mixToMono(decode(join(seedDir, 'sounds.ogg')));
	const [refStart] = sprite[SKEW_REFERENCE];
	const refAt = Math.round((refStart / 1000) * SR);
	const refNeedle = reference.subarray(refAt, refAt + Math.round(0.2 * SR));
	const quote = (p) => `'${p.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`;

	for (const [ext, codec] of Object.entries(FORMATS)) {
		const original = join(seedDir, `sounds.${ext}`);
		const before = decode(original);
		const beforeFrames = before.length / 2;
		const ref = locate(mixToMono(before), refNeedle, refAt, 2048);
		if (ref.score < 0.9)
			throw new Error(`${ext}: ${SKEW_REFERENCE} not found (score ${ref.score})`);
		const skew = ref.lag - refAt;
		const want = target + skew;
		if (want <= beforeFrames) throw new Error(`${ext}: the file already runs past the new region`);

		const segWav = join(work, 'seg.wav');
		const seg = join(work, `seg.${ext}`);
		const joined = join(work, `joined.${ext}`);
		const list = join(work, 'list.txt');
		writeFileSync(list, `file ${quote(original)}\nfile ${quote(seg)}\n`);

		let lead = want - beforeFrames;
		for (let attempt = 0; ; attempt++) {
			if (lead < 0) throw new Error(`${ext}: the join lands past the region (lead ${lead})`);
			const pcm = new Float32Array((lead + cueFrames + SR) * 2);
			pcm.set(cue, lead * 2);
			writeFileSync(segWav, wavFloat32(pcm));
			ff(['-i', segWav, ...codec, seg]);
			if (codecSetupOf(seg, ext) !== codecSetupOf(original, ext)) {
				throw new Error(
					`${ext}: the cue's codec setup differs from the sprite's — cannot copy-join`,
				);
			}
			// `-copyts` keeps the m4a's priming edit list; without it the whole sprite decodes 1024
			// samples late. It is inert for the other three.
			ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-copyts', joined]);

			const after = decode(joined);
			const hit = locate(mixToMono(after), needle, want, 4096);
			if (hit.score < 0.9) throw new Error(`${ext}: cue not found intact (score ${hit.score})`);
			const error = hit.lag - want;
			if (error === 0) {
				// The old sprite must come back exactly, both channels — up to the tail frames the join
				// re-blocks.
				const keep = before.length - 4096 * 2;
				for (let i = 0; i < keep; i++) {
					if (after[i] !== before[i]) throw new Error(`${ext}: existing audio changed at ${i}`);
				}
				const file = join(work, `final.${ext}`);
				copyFileSync(joined, file);
				outputs[ext] = {
					file,
					skew,
					score: hit.score,
					attempts: attempt + 1,
					seconds: after.length / 2 / SR,
				};
				break;
			}
			if (attempt >= 3) throw new Error(`${ext}: could not place the cue (off by ${error})`);
			lead -= error;
		}
	}

	for (const ext of Object.keys(FORMATS)) {
		const { file, skew, score, attempts, seconds } = outputs[ext];
		copyFileSync(file, join(seedDir, `sounds.${ext}`));
		console.log(
			`✓ ${ext}: cue at ${startMs} ms (skew ${skew}), match ${score.toFixed(4)}, ` +
				`${attempts} pass(es), ${seconds.toFixed(3)} s`,
		);
	}
	writeFileSync(
		manifestPath,
		manifestText.replace(new RegExp(`("${KEY}": )\\[[^\\]]*\\]`), `$1[${startMs}, ${durMs}]`),
	);
	for (const app of OTHER_APPS) {
		for (const f of ['sounds.json', ...Object.keys(FORMATS).map((e) => `sounds.${e}`)]) {
			copyFileSync(join(seedDir, f), join(audioDir(app), f));
		}
	}
	console.log(`✓ ${KEY} → [${startMs}, ${durMs}] in apps/{${[SEED_APP, ...OTHER_APPS].join(',')}}`);
} finally {
	rmSync(work, { recursive: true, force: true });
}
