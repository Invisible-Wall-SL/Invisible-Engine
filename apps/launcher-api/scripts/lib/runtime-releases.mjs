// The R2 layout of versioned runtime releases, shared by the scripts that write and read it:
// `publish-runtime-bundle.mjs` (upload + promote), `runtime-pointer.mjs` (rollback / promote / pin)
// and `verify-runtime-live.mjs` (is the pointed-at release what the test server serves?).
//
//   test_server/_runtime/<id>@<version>/**    one release, IMMUTABLE once its pointer can name it
//   test_server/_runtime/<id>/current.json    the pointer: which release every unpinned game serves
//   test_server/_runtime/<id>/releases.json   history, newest first — what a rollback can pick from
//   test_server/_runtime/<id>/release.json    the launcher's status stamp (building / released)
//
// The test server (`services/test-server/server.mjs`) resolves `current.json` on every hydrate, and a
// games.json entry with `runtimeVersion` pins that one game to a release instead (a canary). Flipping
// the pointer is ONE object write, so a release is atomic: a hydrate sees the whole old release or the
// whole new one, never a mix. See "Runtime releases" in docs/design/games-deploy.md.

export const RUNTIME_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
/** Mirrored in `services/test-server/server.mjs` (`validVersion`), which reads it from R2. */
export const VERSION_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** The content-hashed entry chunk — unique per build, so a match proves WHICH build is served. */
export const MARKER_RE = /bundle\.[A-Za-z0-9_-]+\.js/;
export const GAMES_MANIFEST_KEY = 'test_server/games.json';
/** Releases kept in history (and in R2). The current, its predecessor and every pinned release are
 *  kept on top of this, whatever their age. */
export const KEEP_RELEASES = Number(process.env.RUNTIME_KEEP_RELEASES || 10);

export const keys = {
	versionPrefix: (id, version) => `test_server/_runtime/${id}@${version}/`,
	pointer: (id) => `test_server/_runtime/${id}/current.json`,
	history: (id) => `test_server/_runtime/${id}/releases.json`,
	status: (id) => `test_server/_runtime/${id}/release.json`,
};

export function assertRuntimeId(id) {
	if (!RUNTIME_ID_RE.test(id ?? '')) {
		throw new Error(`Invalid runtime id '${id}' — must match ${RUNTIME_ID_RE}.`);
	}
}

export function assertVersion(version) {
	if (!VERSION_RE.test(version ?? '')) {
		throw new Error(`Invalid release version '${version}' — must match ${VERSION_RE}.`);
	}
}

/** The R2 client + bucket from the standard env vars, or exit with the usual message. */
export async function r2FromEnv() {
	const { R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
	if (!R2_ENDPOINT || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
		console.error('Missing R2_ENDPOINT / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY.');
		process.exit(1);
	}
	const sdk = await import('@aws-sdk/client-s3');
	const s3 = new sdk.S3Client({
		region: 'auto',
		endpoint: R2_ENDPOINT,
		credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
	});
	return { s3, bucket: R2_BUCKET, sdk };
}

/** `{ value, etag }`, or null when the object does not exist. Any other error throws. */
export async function readJson(r2, key) {
	try {
		const got = await r2.s3.send(new r2.sdk.GetObjectCommand({ Bucket: r2.bucket, Key: key }));
		return { value: JSON.parse(await got.Body.transformToString()), etag: got.ETag ?? null };
	} catch (e) {
		if (e.name === 'NoSuchKey') return null;
		throw e;
	}
}

/** Write JSON; `ifMatch` / `ifNoneMatch` make it a compare-and-swap (412 → `PreconditionFailed`). */
export async function writeJson(r2, key, value, cond = {}) {
	await r2.s3.send(
		new r2.sdk.PutObjectCommand({
			Bucket: r2.bucket,
			Key: key,
			Body: JSON.stringify(value, null, 2),
			ContentType: 'application/json; charset=utf-8',
			...(cond.ifMatch ? { IfMatch: cond.ifMatch } : {}),
			...(cond.ifNoneMatch ? { IfNoneMatch: cond.ifNoneMatch } : {}),
		}),
	);
}

export async function listKeys(r2, prefix) {
	const out = [];
	let token;
	do {
		const list = await r2.s3.send(
			new r2.sdk.ListObjectsV2Command({
				Bucket: r2.bucket,
				Prefix: prefix,
				ContinuationToken: token,
			}),
		);
		for (const o of list.Contents ?? []) out.push({ key: o.Key, size: o.Size ?? 0 });
		token = list.IsTruncated ? list.NextContinuationToken : undefined;
	} while (token);
	return out;
}

export async function readPointer(r2, id) {
	return (await readJson(r2, keys.pointer(id)))?.value ?? null;
}

/** The pointer plus the precondition that makes a later {@link promote} a compare-and-swap against
 *  exactly this state — so a release that promotes after a rollback moved the pointer fails loudly
 *  instead of silently undoing the rollback. */
export async function readPointerForSwap(r2, id) {
	const got = await readJson(r2, keys.pointer(id));
	return {
		pointer: got?.value ?? null,
		cond: got ? { ifMatch: got.etag } : { ifNoneMatch: '*' },
	};
}

/** Release history, newest first (empty before the first versioned release). A present but
 *  unreadable history throws: rewriting it from scratch would orphan every release it listed. */
export async function readHistory(r2, id) {
	const got = await readJson(r2, keys.history(id));
	if (!got) return [];
	if (!Array.isArray(got.value?.releases))
		throw new Error(`${keys.history(id)} has no releases[].`);
	return got.value.releases;
}

/** How many files a release's prefix holds — a pointer must never name a release that is gone. */
export async function assertReleaseComplete(r2, id, release) {
	const n = (await listKeys(r2, keys.versionPrefix(id, release.version))).length;
	if (n === 0 || (release.files && n < release.files)) {
		throw new Error(
			`${id}@${release.version} has ${n} of ${release.files ?? '?'} file(s) in R2 — not pointing games at it.`,
		);
	}
}

export async function writeHistory(r2, id, releases) {
	await writeJson(r2, keys.history(id), { runtimeId: id, releases });
}

/** The games.json entries that pin a release of this runtime: `{ gameKey: version }`. */
export async function pinnedVersions(r2, id) {
	const games = (await readJson(r2, GAMES_MANIFEST_KEY))?.value?.games ?? {};
	return Object.fromEntries(
		Object.entries(games)
			.filter(([, g]) => g?.runtime === id && typeof g.runtimeVersion === 'string')
			.map(([key, g]) => [key, g.runtimeVersion]),
	);
}

/**
 * Point every unpinned game at `release` — ONE object write, which is what makes a release atomic.
 * `swap` (from {@link readPointerForSwap}) makes it a compare-and-swap: if the pointer moved since it
 * was read, this throws `PointerMovedError` and nothing changes. Then marks the release as having
 * been live in the history (only such releases are default rollback targets) and rewrites the
 * launcher's status stamp, so "Engine deployed · <commit>" follows a rollback.
 */
export async function promote(r2, id, release, via, swap) {
	const before = swap.pointer;
	const promotedAt = new Date().toISOString();
	const pointer = {
		runtimeId: id,
		version: release.version,
		commit: release.commit,
		shortCommit: release.shortCommit,
		builtAt: release.builtAt,
		marker: release.marker,
		promotedAt,
		via,
		previous:
			before?.version && before.version !== release.version
				? before.version
				: (before?.previous ?? null),
	};
	try {
		await writeJson(r2, keys.pointer(id), pointer, swap.cond);
	} catch (e) {
		if (!isLostSwap(e)) throw e;
		throw new PointerMovedError(
			`${keys.pointer(id)} changed since it was read (a rollback or another release moved it) — ` +
				`left as it is. Re-read it with 'list' before trying again.`,
		);
	}
	const history = await readHistory(r2, id);
	const at = history.findIndex((r) => r.version === release.version);
	if (at >= 0 && !history[at].promotedAt) {
		history[at] = { ...history[at], promotedAt };
		await writeHistory(r2, id, history);
	}
	await writeJson(r2, keys.status(id), {
		runtimeId: id,
		commit: release.commit,
		shortCommit: release.shortCommit,
		builtAt: release.builtAt,
		status: 'released',
		version: release.version,
		promotedAt,
		via,
	});
	return pointer;
}

export class PointerMovedError extends Error {}

/** A conditional write lost its race: 412 from S3 semantics, 409 `ConditionalRequestConflict` from
 *  R2 when two conditional writes to one key overlap (the same pair `publish-game-bundle.mjs` retries). */
function isLostSwap(e) {
	const status = e?.$metadata?.httpStatusCode;
	return (
		e?.name === 'PreconditionFailed' ||
		e?.name === 'ConditionalRequestConflict' ||
		status === 412 ||
		status === 409
	);
}

/**
 * Drop releases beyond the newest {@link KEEP_RELEASES} from history and delete their files. Never
 * touches the current release, its predecessor (the one-click rollback target) or a pinned release.
 * The history is rewritten BEFORE anything is deleted, so a rollback can never pick a release that is
 * half gone.
 */
export async function prune(r2, id) {
	const history = await readHistory(r2, id);
	const pointer = await readPointer(r2, id);
	const keep = new Set([
		pointer?.version,
		pointer?.previous,
		...Object.values(await pinnedVersions(r2, id)),
	]);
	const kept = history.filter((r, i) => i < KEEP_RELEASES || keep.has(r.version));
	const dropped = history.filter((r) => !kept.includes(r));
	if (dropped.length === 0) return [];
	await writeHistory(r2, id, kept);
	for (const release of dropped) {
		const objects = await listKeys(r2, keys.versionPrefix(id, release.version));
		for (let i = 0; i < objects.length; i += 1000) {
			await r2.s3.send(
				new r2.sdk.DeleteObjectsCommand({
					Bucket: r2.bucket,
					Delete: { Objects: objects.slice(i, i + 1000).map((o) => ({ Key: o.key })), Quiet: true },
				}),
			);
		}
		console.info(`  pruned ${id}@${release.version} (${objects.length} file(s))`);
	}
	return dropped.map((r) => r.version);
}

/** Set (or with `version === null`, clear) one game's pin, as a compare-and-swap on games.json —
 *  the launcher writes the same manifest on every publish. */
export async function setPin(r2, id, gameKey, version) {
	for (let attempt = 1; attempt <= 6; attempt++) {
		const current = await readJson(r2, GAMES_MANIFEST_KEY);
		const entry = current?.value?.games?.[gameKey];
		if (!entry) throw new Error(`No game '${gameKey}' in ${GAMES_MANIFEST_KEY}.`);
		if (entry.runtime !== id) {
			throw new Error(
				`'${gameKey}' is not served from runtime '${id}' (runtime: ${entry.runtime ?? 'none'}).`,
			);
		}
		if (version === null) delete entry.runtimeVersion;
		else entry.runtimeVersion = version;
		try {
			await writeJson(r2, GAMES_MANIFEST_KEY, current.value, { ifMatch: current.etag });
			return;
		} catch (e) {
			if (!isLostSwap(e)) throw e;
			console.info(`  games.json changed under us (attempt ${attempt}) — retrying`);
		}
	}
	throw new Error('games.json kept changing — pin not written.');
}

/** POST the test server's /refresh (202 = a hydrate was queued, not that it finished). */
export async function refreshTestServer(origin) {
	const secret = process.env.TEST_SERVER_SECRET;
	const url = `${origin}/refresh${secret ? `?secret=${encodeURIComponent(secret)}` : ''}`;
	try {
		const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(25_000) });
		console.info(`  POST /refresh → HTTP ${res.status}`);
	} catch (e) {
		console.info(`  POST /refresh → unreachable (${e.message})`);
	}
}
