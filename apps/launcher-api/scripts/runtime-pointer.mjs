// Move the runtime pointer between releases that are ALREADY in R2 — no rebuild. Run by the
// "Runtime rollback" workflow (.github/workflows/runtime-rollback.yml); runnable locally with the R2
// env vars too.
//
//   node apps/launcher-api/scripts/runtime-pointer.mjs <runtimeId> list
//   node apps/launcher-api/scripts/runtime-pointer.mjs <runtimeId> rollback [version]   # default: the release before the current one
//   node apps/launcher-api/scripts/runtime-pointer.mjs <runtimeId> promote  [version]   # default: the newest release (roll forward)
//   node apps/launcher-api/scripts/runtime-pointer.mjs <runtimeId> pin   <gameKey> <version>   # canary: one game on a release
//   node apps/launcher-api/scripts/runtime-pointer.mjs <runtimeId> unpin <gameKey>             # back on the pointer
//
// A version may be given as its full name or any unique prefix of it (a short commit works).
// Prints `version=<v>` and `marker=<bundle.x.js>` lines to $GITHUB_OUTPUT when set, so the workflow
// can verify the served bundle. This only WRITES R2; POST /refresh and `verify-runtime-live.mjs`
// make it live and prove it.

import { appendFile } from 'node:fs/promises';
import {
	assertReleaseComplete,
	assertRuntimeId,
	pinnedVersions,
	promote,
	r2FromEnv,
	readHistory,
	readPointerForSwap,
	setPin,
} from './lib/runtime-releases.mjs';

// A refused request (unknown version, ambiguous prefix, not a runtime game…) is a one-line error,
// not a stack trace, in the workflow log.
process.on('uncaughtException', (e) => {
	console.error(`::error title=Runtime pointer unchanged::${e.message}`);
	process.exit(1);
});

const [runtimeId, action, ...rest] = process.argv.slice(2);
const USAGE =
	'Usage: runtime-pointer.mjs <runtimeId> list | rollback [version] | promote [version] | pin <game> <version> | unpin <game>';
if (!runtimeId || !action) {
	console.error(USAGE);
	process.exit(1);
}
assertRuntimeId(runtimeId);

const r2 = await r2FromEnv();
const history = await readHistory(r2, runtimeId);
const swap = await readPointerForSwap(r2, runtimeId);
const pointer = swap.pointer;

function find(ref) {
	const matches = history.filter(
		(r) => r.version === ref || r.version.startsWith(ref) || r.commit?.startsWith(ref),
	);
	const exact = matches.find((r) => r.version === ref);
	if (exact) return exact;
	if (matches.length === 1) return matches[0];
	throw new Error(
		matches.length === 0
			? `No release '${ref}' in the history of '${runtimeId}' (list it with: ${runtimeId} list).`
			: `'${ref}' matches ${matches.length} releases (${matches.map((r) => r.version).join(', ')}) — give more of it.`,
	);
}

async function output(release) {
	if (!process.env.GITHUB_OUTPUT) return;
	await appendFile(
		process.env.GITHUB_OUTPUT,
		`version=${release.version}\nmarker=${release.marker}\n`,
	);
}

function line(r) {
	const tags = [
		r.version === pointer?.version ? 'CURRENT' : '',
		r.version === pointer?.previous ? 'previous' : '',
		r.promotedAt ? '' : 'never live',
	]
		.filter(Boolean)
		.join(', ');
	return `  ${r.version.padEnd(26)} ${r.shortCommit}  built ${r.builtAt}  ${r.marker}${tags ? `  ← ${tags}` : ''}`;
}

switch (action) {
	case 'list': {
		const pins = await pinnedVersions(r2, runtimeId);
		console.info(
			`Runtime '${runtimeId}' — pointer: ${pointer ? `${pointer.version} (via ${pointer.via}, ${pointer.promotedAt})` : 'none (flat layout)'}`,
		);
		for (const r of history) console.info(line(r));
		for (const [game, v] of Object.entries(pins)) console.info(`  pinned: ${game} → ${v}`);
		break;
	}
	case 'rollback':
	case 'promote': {
		if (history.length === 0) throw new Error(`'${runtimeId}' has no versioned releases yet.`);
		let target;
		if (rest[0]) target = find(rest[0]);
		else if (action === 'promote') target = history[0];
		else {
			// The next OLDER release that was ever live. `releases.json` also holds releases uploaded
			// with promote unticked (canaries), which must never become everyone's engine by default.
			const at = history.findIndex((r) => r.version === pointer?.version);
			if (at < 0)
				throw new Error(
					`The current release '${pointer?.version}' is not in the history — name a version.`,
				);
			target = history.slice(at + 1).find((r) => r.promotedAt);
			if (!target)
				throw new Error(
					`No release older than '${pointer.version}' was ever live — name a version (see 'list').`,
				);
		}
		if (target.version === pointer?.version) {
			console.info(`'${runtimeId}' already serves ${target.version} — pointer unchanged.`);
		} else {
			await assertReleaseComplete(r2, runtimeId, target);
			await promote(r2, runtimeId, target, action, swap);
			console.info(
				`${action}: '${runtimeId}' pointer ${pointer?.version ?? 'none'} → ${target.version} (${target.shortCommit}, ${target.marker})`,
			);
		}
		await output(target);
		break;
	}
	case 'pin': {
		const [game, ref] = rest;
		if (!game || !ref) throw new Error(USAGE);
		const target = find(ref);
		await assertReleaseComplete(r2, runtimeId, target);
		await setPin(r2, runtimeId, game, target.version);
		console.info(
			`pin: '${game}' → ${runtimeId}@${target.version} (${target.marker}); every other game stays on ${pointer?.version ?? 'the flat layout'}`,
		);
		await output(target);
		break;
	}
	case 'unpin': {
		const [game] = rest;
		if (!game) throw new Error(USAGE);
		await setPin(r2, runtimeId, game, null);
		console.info(
			`unpin: '${game}' follows the pointer again (${pointer?.version ?? 'flat layout'})`,
		);
		if (pointer) await output(pointer);
		break;
	}
	default:
		console.error(USAGE);
		process.exit(1);
}
