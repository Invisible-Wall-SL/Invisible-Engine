/**
 * Split the engine's stock audiosprite into BANKS — files a game loads only when it can play
 * what they hold (`apps/lines/src/game/stockSounds.ts`).
 *
 *   node scripts/split-stock-audio.mjs            # cut the banks from the sprite at LEGACY_REV
 *   node scripts/split-stock-audio.mjs --check    # re-cut into a temp dir, compare with what ships
 *
 * The sprite was one 408 s file per container, and every game downloaded and decoded all of it
 * (≈ 144–157 MB of PCM) whatever it could play. Its regions sit apart, with ≥ 1 s of silence
 * between neighbours, so each bank is a window of the sprite holding one region, or a run of
 * neighbouring regions a game always loads together (a slot ladder, or neighbours the engine's
 * code always plays).
 *
 * WHY STREAM COPY, NOT RE-ENCODE. Decoding the sprite and encoding it again at its own settings
 * costs ~20 dB SNR against what shipped (`author-sfx-btn-stop.mjs`): a generation of loss on every
 * sound in the game. A window is cut with `-c copy`, so every packet of every region is the byte
 * the sprite had, and the script proves it: each region decodes from its bank exactly as it
 * decodes from the sprite.
 *
 * WHY A LEAD PER FILE. A copy can only cut on a packet, and packets differ per container (1024,
 * 1152, 1536 samples, Vorbis blocks), so a window starts at a slightly different sample in each
 * file. Each file's `lead` (ms) is MEASURED — the region located in the decoded bank by
 * cross-correlation against the decoded sprite — and the runtime adds it to the bank's sprite
 * offsets for the container it plays. A looping bed therefore loops on the same samples it did.
 * The window opens 250 ms before its first region, inside the silence, so whatever a decoder makes
 * of a mid-stream first packet (Vorbis and AAC overlap the previous block, MP3 reads back into its
 * bit reservoir) is silence before the region.
 *
 * Needs ffmpeg: `$FFMPEG`, else the launcher's `ffmpeg-static`, else `ffmpeg` on the PATH. Its
 * muxers run bit-exact, so a re-run writes the same bytes.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as prettier from 'prettier';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const AUDIO = join(ROOT, 'apps/lines/static/assets/audio');
/** The last commit that shipped the whole sprite: the source every bank is cut from. */
const LEGACY_REV = '5122d0da';
const LEGACY_FILES = ['sounds.json', 'sounds.ogg', 'sounds.m4a', 'sounds.mp3', 'sounds.ac3'];
/** Container priority, the order the sprite listed them in (and howler tried them). */
const CONTAINERS = ['ogg', 'm4a', 'mp3', 'ac3'];
const SR = 44100;
const LEAD_IN_S = 0.25;
const TAIL_S = 0.15;
/** A region must decode from its bank as it does from the sprite: no sample may differ by more. */
const MAX_SAMPLE_DIFF = 1e-4;
/**
 * An MP3 cut carries no Xing/LAME frame. A cut starts mid-stream, so it has no encoder delay to
 * record, and decoders disagree about what an empty frame means: given one, GStreamer (WebKitGTK)
 * started the audio 576 samples away from FFmpeg (Chromium). With no frame, both decode every
 * frame as it comes and agree to the sample. (GStreamer also ignores the SPRITE's gapless frame,
 * so in WebKitGTK every MP3 region used to start 1105 samples late; from a bank it starts on time.)
 */
const MUXER_ARGS = { mp3: ['-write_xing', '0'] };

/** Containers whose decoder is deterministic; the other two are held to loudness per block. */
const EXACT = new Set(['ogg', 'mp3']);
const MAX_LOUDNESS_DIFF_DB = 1;
const BLOCK = 2048;
/** Blocks quieter than this are left out of the loudness check: dither and noise floor alone. */
const AUDIBLE_DB = -50;

/** The largest gap, in dB, between two stretches' loudness over any audible `BLOCK`. */
function worstLoudnessDiff(a, aFrom, b, bFrom, len) {
	const db = (x, from) => {
		let e = 0;
		for (let i = from * 2; i < (from + BLOCK) * 2; i++) e += x[i] * x[i];
		return 10 * Math.log10(e / (BLOCK * 2) + 1e-20);
	};
	let worst = 0;
	for (let at = 0; at + BLOCK <= len; at += BLOCK) {
		const da = db(a, aFrom + at);
		if (da < AUDIBLE_DB) continue;
		worst = Math.max(worst, Math.abs(da - db(b, bFrom + at)));
	}
	return worst;
}

/**
 * Neighbouring regions shipped as ONE bank, because a game that can play one of them always loads
 * them all: a slot ladder resolves every rung together, and the others are all played by the
 * engine's own code (`CODED_STOCK_SOUNDS`). Every other region is a bank of its own.
 */
const GROUPS = {
	winlevel_beds: ['bgm_winlevel_big', 'bgm_winlevel_epic', 'bgm_winlevel_max', 'bgm_winlevel_mega', 'bgm_winlevel_superwin'], // prettier-ignore
	anticipation_coinloop: ['sfx_anticipation', 'sfx_anticipation_start', 'sfx_bigwin_coinloop'],
	buttons: ['sfx_btn_general', 'sfx_btn_spin'],
	reel_stops: ['sfx_reel_stop_1', 'sfx_reel_stop_2', 'sfx_reel_stop_3', 'sfx_reel_stop_4', 'sfx_reel_stop_5'], // prettier-ignore
	scatter_stops: ['sfx_scatter_stop_1', 'sfx_scatter_stop_2', 'sfx_scatter_stop_3', 'sfx_scatter_stop_4', 'sfx_scatter_stop_5'], // prettier-ignore
	tumble_wins: ['tumble_win_1', 'tumble_win_2', 'tumble_win_3', 'tumble_win_4', 'tumble_win_5'],
};

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

/** Interleaved stereo at the sprite's rate. */
const decode = (file) => {
	const b = ff(['-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-']);
	return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};

const mono = (stereo, from, n) => {
	const m = new Float32Array(n);
	for (let i = 0; i < n; i++) m[i] = (stereo[(from + i) * 2] + stereo[(from + i) * 2 + 1]) / 2;
	return m;
};

/** Normalised cross-correlation of `needle` against `hay` at `lag`, every `step`-th sample. */
function score(hay, needle, lag, step) {
	let dot = 0;
	let hh = 0;
	let nn = 0;
	for (let i = 0; i < needle.length; i += step) {
		const h = hay[lag + i];
		dot += h * needle[i];
		hh += h * h;
		nn += needle[i] * needle[i];
	}
	return hh > 0 && nn > 0 ? dot / Math.sqrt(hh * nn) : 0;
}

/** Lag of `needle` inside `hay` around `expected`: a coarse pass, then every lag around its best. */
function locate(hay, needle, expected, radius) {
	const search = (from, to, lagStep, sampleStep) => {
		let best = { lag: -1, score: -Infinity };
		for (let lag = Math.max(0, from); lag <= to; lag += lagStep) {
			if (lag + needle.length > hay.length) break;
			const s = score(hay, needle, lag, sampleStep);
			if (s > best.score) best = { lag, score: s };
		}
		return best;
	};
	const coarse = search(expected - radius, expected + radius, 4, 4);
	return search(coarse.lag - 8, coarse.lag + 8, 1, 1);
}

/** The loudest `n`-sample stretch of a region, as a start sample: what alignment correlates on. */
function loudest(stereo, from, length, n) {
	let best = from;
	let bestEnergy = -1;
	const step = n / 4;
	for (let at = from; at + n <= from + length; at += step) {
		let e = 0;
		for (let i = at; i < at + n; i++) e += stereo[i * 2] ** 2 + stereo[i * 2 + 1] ** 2;
		if (e > bestEnergy) [best, bestEnergy] = [at, e];
	}
	return best;
}

/** A file's audio packets as `size:crc`, read without decoding. */
const packets = (file) =>
	ff(['-i', file, '-map', '0:a', '-c', 'copy', '-f', 'framecrc', '-'])
		.toString()
		.split('\n')
		.filter((line) => line && !line.startsWith('#'))
		.map((line) => line.split(',').map((f) => f.trim()))
		.map((f) => `${f[4]}:${f[5]}`);

/** Where `run` sits in `all` as one contiguous stretch, or -1. */
function packetRun(all, run) {
	for (let k = 0; k + run.length <= all.length; k++) {
		let i = 0;
		while (i < run.length && all[k + i] === run[i]) i++;
		if (i === run.length) return k;
	}
	return -1;
}

/** The legacy sprite's files, from `LEGACY_REV`. */
function legacySprite() {
	const dir = mkdtempSync(join(tmpdir(), 'stock-sprite-'));
	for (const file of LEGACY_FILES) {
		const blob = execFileSync(
			'git',
			['show', `${LEGACY_REV}:apps/lines/static/assets/audio/${file}`],
			{
				cwd: ROOT,
				maxBuffer: 1 << 30,
			},
		);
		writeFileSync(join(dir, file), blob);
	}
	return dir;
}

/** The banks: GROUPS, then one per remaining region, in sprite order. */
function planBanks(sprite) {
	const order = Object.keys(sprite).sort((a, b) => sprite[a][0] - sprite[b][0]);
	const grouped = new Map();
	for (const [id, names] of Object.entries(GROUPS)) for (const name of names) grouped.set(name, id);
	const banks = new Map();
	for (const name of order) {
		const id = grouped.get(name) ?? name;
		if (!sprite[name]) throw new Error(`${name} is not in the sprite`);
		banks.set(id, [...(banks.get(id) ?? []), name]);
	}
	for (const [id, names] of Object.entries(GROUPS)) {
		const missing = names.filter((n) => !sprite[n]);
		if (missing.length) throw new Error(`${id}: ${missing.join(', ')} not in the sprite`);
		// A bank is one window: no region of another bank may sit inside it.
		const lo = Math.min(...names.map((n) => sprite[n][0]));
		const hi = Math.max(...names.map((n) => sprite[n][0] + sprite[n][1]));
		const inside = order.filter((n) => !names.includes(n) && sprite[n][0] < hi && sprite[n][0] + sprite[n][1] > lo); // prettier-ignore
		if (inside.length)
			throw new Error(`${id} is not contiguous: ${inside.join(', ')} sit inside it`);
	}
	return [...banks].map(([id, names]) => ({ id, names }));
}

/** Cut every bank from the sprite in `from` into `out`; returns the manifest. */
async function split(from, out) {
	const legacy = JSON.parse(readFileSync(join(from, 'sounds.json'), 'utf8'));
	const { sprite, config = {} } = legacy;
	const order = Object.keys(sprite).sort((a, b) => sprite[a][0] - sprite[b][0]);
	const banks = planBanks(sprite).map((bank) => {
		const first = Math.min(...bank.names.map((n) => sprite[n][0])) / 1000;
		const last = Math.max(...bank.names.map((n) => sprite[n][0] + sprite[n][1])) / 1000;
		const at = order.indexOf(bank.names[0]);
		const prev = order[at - 1];
		const next = order[order.indexOf(bank.names[bank.names.length - 1]) + 1];
		const prevEnd = prev ? (sprite[prev][0] + sprite[prev][1]) / 1000 : 0;
		const nextStart = next ? sprite[next][0] / 1000 : Infinity;
		const origin = Math.max(0, prevEnd, first - LEAD_IN_S);
		const end = Math.min(nextStart, last + TAIL_S);
		return { ...bank, origin, end, files: {} };
	});
	mkdirSync(join(out, 'stock'), { recursive: true });
	const report = [];
	for (const ext of CONTAINERS) {
		const whole = decode(join(from, `sounds.${ext}`));
		const spritePackets = packets(join(from, `sounds.${ext}`));
		for (const bank of banks) {
			const rel = `stock/${bank.id}.${ext}`;
			const file = join(out, rel);
			// Seeking on the OUTPUT side: an input-side seek keeps the packets before the window as
			// pre-roll at negative timestamps (0.6 s of it in an Ogg cut), which decoders treat apart.
			// A window from the sprite's first sample takes no seek at all: even `-ss 0` drops a packet.
			ff([
				...['-i', join(from, `sounds.${ext}`), '-map', '0:a', '-c', 'copy'],
				...(bank.origin > 0 ? ['-ss', bank.origin.toFixed(6)] : []),
				...['-to', bank.end.toFixed(6)],
				...(MUXER_ARGS[ext] ?? []),
				...['-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', file],
			]);
			const cut = decode(file);
			const cutFrames = cut.length / 2;
			// Align on the loudest half second of the bank's longest region.
			const longest = bank.names.reduce((a, b) => (sprite[b][1] > sprite[a][1] ? b : a));
			const rStart = Math.round((sprite[longest][0] / 1000) * SR);
			const rLen = Math.round((sprite[longest][1] / 1000) * SR);
			const n = Math.min(8192, rLen);
			const at = loudest(whole, rStart, rLen, n);
			const needle = mono(whole, at, n);
			const expected = Math.round(at - bank.origin * SR);
			const { lag, score } = locate(mono(cut, 0, cutFrames), needle, expected, 8192);
			if (score < (EXACT.has(ext) ? 0.999 : 0.99))
				throw new Error(`${rel}: no alignment (best ${score.toFixed(4)} at ${lag})`);
			const zero = at - lag; // the sprite sample the bank file's first sample decodes as
			// The bank's packets are a run of the sprite's, byte for byte: nothing was re-encoded.
			const run = packetRun(spritePackets, packets(file));
			if (run < 0) throw new Error(`${rel}: its packets are not a run of the sprite's`);
			// And each region decodes from the bank as from the sprite. Vorbis and MP3 decode the same
			// packets to the same samples. AAC (noise substitution) and AC-3 (mantissa dither) draw
			// noise from a generator whose state depends on where decoding began, so theirs differ
			// by that noise: they are held to the region's loudness, block by block, instead.
			for (const name of bank.names) {
				const r0 = Math.round((sprite[name][0] / 1000) * SR);
				const len = Math.round((sprite[name][1] / 1000) * SR);
				if (r0 - zero < 0 || r0 - zero + len > cutFrames)
					throw new Error(`${rel}: ${name} is not wholly inside the cut`);
				let maxDiff = 0;
				let signal = 0;
				let noise = 0;
				for (let i = 0; i < len * 2; i++) {
					const v = whole[r0 * 2 + i];
					const d = v - cut[(r0 - zero) * 2 + i];
					signal += v * v;
					noise += d * d;
					if (Math.abs(d) > maxDiff) maxDiff = Math.abs(d);
				}
				const snr = noise > 0 ? 10 * Math.log10(signal / noise) : Infinity;
				const loudness = worstLoudnessDiff(whole, r0, cut, r0 - zero, len);
				if (EXACT.has(ext) ? maxDiff > MAX_SAMPLE_DIFF : loudness > MAX_LOUDNESS_DIFF_DB)
					throw new Error(
						`${rel}: ${name} decodes differently (max diff ${maxDiff}, loudness ±${loudness.toFixed(2)} dB)`,
					);
				report.push({ rel, name, maxDiff, snr, loudness });
			}
			const lead = ((bank.origin * SR - zero) / SR) * 1000;
			bank.files[ext] = { src: rel, lead: Math.round(lead * 1000) / 1000 };
		}
	}
	const manifest = {
		version: 2,
		src: [],
		sprite: {},
		banks: banks.map((bank) => ({
			id: bank.id,
			files: bank.files,
			sprite: Object.fromEntries(
				bank.names.map((name) => {
					const [start, length, loop] = sprite[name];
					const region = [Math.round((start - bank.origin * 1000) * 1000) / 1000, length];
					return [name, loop ? [...region, true] : region];
				}),
			),
			config: Object.fromEntries(bank.names.map((name) => [name, config[name] ?? { volume: 1 }])),
		})),
	};
	// Written as the repo's Prettier writes it, so a fresh cut compares byte for byte.
	const file = join(AUDIO, 'sounds.json');
	const text = await prettier.format(JSON.stringify(manifest, null, '\t'), {
		...(await prettier.resolveConfig(file)),
		filepath: file,
	});
	writeFileSync(join(out, 'sounds.json'), text);
	return { manifest, report };
}

const check = process.argv.includes('--check');
const from = legacySprite();
const out = check ? mkdtempSync(join(tmpdir(), 'stock-banks-')) : AUDIO;
try {
	if (!check) for (const file of LEGACY_FILES) rmSync(join(AUDIO, file), { force: true });
	const { manifest, report } = await split(from, out);
	const exact = report.filter((r) => EXACT.has(r.rel.split('.').pop()));
	const noisy = report.filter((r) => !EXACT.has(r.rel.split('.').pop()));
	console.log(
		`${manifest.banks.length} banks, ${report.length} region checks: ` +
			`ogg/mp3 worst sample diff ${Math.max(...exact.map((r) => r.maxDiff))}, ` +
			`m4a/ac3 worst block loudness ±${Math.max(...noisy.map((r) => r.loudness)).toFixed(2)} dB ` +
			`(lowest SNR ${Math.min(...noisy.map((r) => r.snr)).toFixed(1)} dB)`,
	);
	if (check) {
		const files = [
			'sounds.json',
			...manifest.banks.flatMap((b) => Object.values(b.files).map((f) => f.src)),
		];
		const stale = files.filter((rel) => {
			const shipped = join(AUDIO, rel);
			return !existsSync(shipped) || !readFileSync(shipped).equals(readFileSync(join(out, rel)));
		});
		if (stale.length) {
			console.error(
				`✗ ${stale.length} file(s) differ from a fresh cut: ${stale.slice(0, 5).join(', ')}`,
			);
			process.exitCode = 1;
		} else console.log('✓ the shipped banks are a fresh cut of the sprite');
	}
} finally {
	rmSync(from, { recursive: true, force: true });
	if (check) rmSync(out, { recursive: true, force: true });
}
