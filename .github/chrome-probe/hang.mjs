// TEMPORARY (removed before merge): a page that hangs AFTER launch must fail its CDP call's timeout
// once, with no relaunch. Expected: one "[chrome] ready" line, then a rejection in ~cdpTimeoutMs.
import { launchChrome } from '../../tools/rigger-spike/chrome.mjs';

const browser = await launchChrome({ name: 'hang', url: 'data:text/html,hi', cdpTimeoutMs: 10_000 });
const t0 = Date.now();
try {
	await browser.evaluate('for (;;) {}');
	console.log('UNEXPECTED: the hung evaluate returned');
	process.exitCode = 2;
} catch (e) {
	console.log(`hung evaluate rejected after ${Date.now() - t0} ms: ${e.message}`);
	process.exitCode = 1;
} finally {
	await browser.close();
}
