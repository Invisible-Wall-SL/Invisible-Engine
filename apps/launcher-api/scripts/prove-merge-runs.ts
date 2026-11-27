/**
 * Proof of Resolve conflict's Accept claim (ADR-0015 §5, §8) against a REAL Postgres, with the real
 * store module and the migrated schema (`check:merge-main-runs` fakes the store, so the SQL is proved
 * here, and in CI by `director-worker.yml`'s `postgres-proofs` job, which runs this after
 * `prove:idle`):
 *
 *   DATABASE_URL=postgres://…/director_proof pnpm --filter launcher-api prove:merge-runs
 *
 * Proved: `claimAccept` takes `proposed → accepting` once, with a database-clock lease, and not again
 * while the lease runs; a lapsed claim is taken over with a new claim id; `recordAcceptSha` writes
 * only for the holder of the claim and only with enough lease left; a settle or release with another
 * claim's id writes nothing; `releaseAccept` and `releaseLapsedAccept` give the proposal back;
 * `lapsedAccepts` finds a lapsed claim; Discard's settle from `proposed` loses to a claim; the live
 * index counts `accepting`. Every statement here is one that threw on postgres-js when a `Date` was
 * put in a raw `sql` template.
 */
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is required (a scratch database with the launcher migrations).');
	process.exit(2);
}
const sql = postgres(url, { max: 2, onnotice: () => {} });
const store = await import('../src/lib/server/pipelineMergeRunsStore.ts');

let checks = 0;
let failures = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) console.log(`  ✓ ${name}`);
	else {
		failures++;
		console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`);
	}
};

const tag = `mp${Date.now().toString(36)}`;
const LEASE = 180_000;
const person = { id: `${tag}-u`, name: 'Prover' };
const other = { id: `${tag}-v`, name: 'Other' };
let pr = 900_000 + Math.floor(Math.random() * 90_000);
const add = async (suffix: string, status = 'proposed'): Promise<string> => {
	const id = `${tag}${suffix}`.slice(0, 20);
	await sql`insert into merge_main_runs (id, pr_number, branch, head_sha, main_sha, request_id,
			started_by_id, started_by, status)
		values (${id}, ${pr++}, 'claude/proof', ${'a'.repeat(40)}, ${'b'.repeat(40)}, ${`${id}-req`},
			${person.id}, ${person.name}, ${status})`;
	return id;
};
const row = async (id: string) => (await sql`select * from merge_main_runs where id = ${id}`)[0];
const lapse = (id: string, seconds: number) =>
	sql`update merge_main_runs set accepting_at = now() - make_interval(secs => ${seconds}) where id = ${id}`;
const ids: string[] = [];

try {
	const a = await add('a');
	ids.push(a);
	const first = await store.claimAccept(a, person, LEASE);
	check(
		'claimAccept: proposed → accepting, with a claim id',
		[first?.status, !!first?.acceptClaim],
		['accepting', true],
	);
	check('claimAccept: the claimer is recorded', (await row(a)).accepted_by, 'Prover');
	check(
		'claimAccept: a second claim while the lease runs gets nothing',
		await store.claimAccept(a, other, LEASE),
		null,
	);

	const claim = first!.acceptClaim!;
	check(
		'recordAcceptSha: the holder, with lease left, writes and is told so',
		await store.recordAcceptSha(a, claim, 'c'.repeat(40), person, LEASE, 30_000),
		true,
	);
	check(
		'recordAcceptSha: another claim id writes nothing',
		await store.recordAcceptSha(a, 'not-the-claim', 'd'.repeat(40), other, LEASE, 30_000),
		false,
	);
	check(
		'recordAcceptSha: the commit and its builder are kept',
		[(await row(a)).accept_sha, (await row(a)).accepted_by],
		['c'.repeat(40), 'Prover'],
	);
	check(
		'settleMergeRun: another claim id settles nothing',
		await store.settleMergeRun(
			a,
			['accepting'],
			{ status: 'stale', reason: 'x' },
			{ claim: 'not-the-claim' },
		),
		null,
	);
	check(
		'settleMergeRun: Discard from proposed loses to a claim',
		await store.settleMergeRun(a, ['proposed'], { status: 'discarded', reason: 'x' }),
		null,
	);

	// lease: a holder that is late is not allowed to push, and a lapsed claim is taken over
	await lapse(a, 160); // 20 s of the 180 s lease left: under the 30 s a push needs
	check(
		'recordAcceptSha: with under the minimum lease left, nothing is written',
		await store.recordAcceptSha(a, claim, 'e'.repeat(40), person, LEASE, 30_000),
		false,
	);
	check(
		'lapsedAccepts: a claim with lease left is not lapsed',
		(await store.lapsedAccepts(LEASE)).some((r) => r.id === a),
		false,
	);
	await lapse(a, 200);
	check(
		'lapsedAccepts: a claim past its lease is found',
		(await store.lapsedAccepts(LEASE)).some((r) => r.id === a),
		true,
	);
	const took = await store.claimAccept(a, other, LEASE);
	check(
		'claimAccept: a lapsed claim is taken over with a new claim id; the builder of the commit stays',
		[took?.status, took?.acceptClaim !== claim, took?.acceptedBy, took?.acceptSha],
		['accepting', true, 'Prover', 'c'.repeat(40)],
	);
	check(
		'recordAcceptSha: the old holder, whose claim was taken over, writes nothing',
		await store.recordAcceptSha(a, claim, 'f'.repeat(40), person, LEASE, 30_000),
		false,
	);
	await store.releaseAccept(a, claim);
	check('releaseAccept: the old claim id releases nothing', (await row(a)).status, 'accepting');
	await store.releaseAccept(a, took!.acceptClaim!);
	check(
		'releaseAccept: the holder gives the proposal back, clean',
		[
			(await row(a)).status,
			(await row(a)).accepting_at,
			(await row(a)).accept_claim,
			(await row(a)).accept_sha,
		],
		['proposed', null, null, null],
	);

	// settle with the claim, to accepted
	const claimB = await store.claimAccept(a, person, LEASE);
	await store.recordAcceptSha(a, claimB!.acceptClaim!, '1'.repeat(40), person, LEASE, 30_000);
	const done = await store.settleMergeRun(
		a,
		['accepting'],
		{ status: 'accepted', mergeSha: '1'.repeat(40), acceptedBy: person },
		{ claim: claimB!.acceptClaim! },
	);
	check(
		'settleMergeRun: the holder settles accepted',
		[done?.status, done?.mergeSha],
		['accepted', '1'.repeat(40)],
	);

	// a claim that built nothing, lapsed: Discard may take it
	const b = await add('b');
	ids.push(b);
	await store.claimAccept(b, person, LEASE);
	check(
		'releaseLapsedAccept: a claim with lease left is not released',
		await store.releaseLapsedAccept(b, LEASE),
		false,
	);
	await lapse(b, 200);
	check(
		'releaseLapsedAccept: a lapsed claim that built nothing is given back',
		await store.releaseLapsedAccept(b, LEASE),
		true,
	);
	check('releaseLapsedAccept: …as proposed', (await row(b)).status, 'proposed');
	const c = await add('c');
	ids.push(c);
	const cc = await store.claimAccept(c, person, LEASE);
	await store.recordAcceptSha(c, cc!.acceptClaim!, '2'.repeat(40), person, LEASE, 30_000);
	await lapse(c, 200);
	check(
		'releaseLapsedAccept: a lapsed claim that built a commit is NOT released (the branch may have moved)',
		await store.releaseLapsedAccept(c, LEASE),
		false,
	);

	// the live index counts accepting: no second live run on the change
	const d = await add('d', 'accepting');
	ids.push(d);
	let refused = false;
	try {
		await sql`insert into merge_main_runs (id, pr_number, branch, head_sha, main_sha, request_id,
				started_by_id, started_by, status)
			select ${`${tag}dd`.slice(0, 20)}, pr_number, 'x', ${'a'.repeat(40)}, ${'b'.repeat(40)}, ${`${tag}-dd`},
				'u', 'U', 'dispatched' from merge_main_runs where id = ${d}`;
	} catch (err) {
		refused = (err as { code?: string }).code === '23505';
	}
	check(
		'the live index counts an accepting run: a second live run on the change is refused',
		refused,
		true,
	);
	check('the status check knows accepting', (await row(d)).status, 'accepting');
} finally {
	await sql`delete from merge_main_runs where id like ${`${tag}%`}`;
	await sql.end();
}

console.log(
	failures
		? `\n${failures} of ${checks} merge-run proofs failed`
		: `\nall ${checks} merge-run proofs pass`,
);
process.exit(failures ? 1 : 0);
