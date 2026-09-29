/**
 * The one promise error reporting makes to a player: their wallet session never reaches the
 * tracker. Run: `pnpm --filter error-tracking check:scrub`.
 */
import assert from 'node:assert/strict';
import { SCRUBBED, addSensitiveParam, scrubDeep, scrubText, scrubUrl } from './src/scrub.ts';

const rgs = 'https://gs.example.com/rgs/engine?sid=abc123&seq=4&gid=77';
assert.equal(
	scrubUrl(rgs),
	`https://gs.example.com/rgs/engine?sid=${encodeURIComponent(SCRUBBED)}&seq=4&gid=77`,
);

const launch =
	'https://games.invisiblewall.org/borut/?sessionID=s-9&rgs_url=x.test&lang=en#token=zz';
const scrubbedLaunch = scrubUrl(launch);
assert.ok(!scrubbedLaunch.includes('s-9') && !scrubbedLaunch.includes('zz'), scrubbedLaunch);
assert.ok(scrubbedLaunch.includes('rgs_url=x.test') && scrubbedLaunch.includes('lang=en'));

assert.equal(
	scrubText('TypeError: Failed to fetch /rgs/engine?sid=abc&seq=1 (retry)'),
	`TypeError: Failed to fetch /rgs/engine?sid=${SCRUBBED}&seq=1 (retry)`,
);
assert.equal(scrubUrl('not a url ?token=t0k'), `not a url ?token=${SCRUBBED}`);
assert.equal(scrubUrl('https://a.test/x?seq=1'), 'https://a.test/x?seq=1');

const event = scrubDeep({
	message: 'boot failed at /api/editor/runtime?k=secret1',
	breadcrumbs: [{ data: { url: 'https://h.test/p?sid=live' } }],
	extra: { token: 'raw', nested: { sessionID: 'raw2', note: 'fine' } },
});
const flat = JSON.stringify(event);
for (const leaked of ['secret1', 'live', 'raw', 'raw2'])
	assert.ok(!flat.includes(`"${leaked}"`) && !flat.includes(`=${leaked}`), flat);
assert.ok(flat.includes('fine'));

const presigned = scrubUrl(
	'https://r2.test/b/o?X-Amz-Algorithm=AWS4&X-Amz-Credential=AKIA1&X-Amz-Signature=deadbeef&X-Amz-Security-Token=tok',
);
for (const leaked of ['AKIA1', 'deadbeef', 'tok'])
	assert.ok(!presigned.includes(`=${leaked}`), presigned);
assert.ok(presigned.includes('X-Amz-Algorithm=AWS4'));

// A partner profile names its own session parameter.
assert.equal(scrubText('/engine?t=abc'), '/engine?t=abc');
addSensitiveParam('t');
assert.equal(scrubText('/engine?t=abc&x=1'), `/engine?t=${SCRUBBED}&x=1`);
assert.ok(!scrubUrl('https://p.test/?T=abc').includes('abc'));

console.log('error-tracking scrub: ok');
