import type { ClientInit } from '@sveltejs/kit';

import { determinismInit, installDeterminism } from './game/determinism';

// First, before any game module runs: the test-only clock + seed hook (`?ie_determinism=<seed>`).
// Without the flag it returns at once and replaces nothing.
installDeterminism();

// With the flag, the app starts only once every declared web font has loaded; without it, this
// returns `undefined`, which SvelteKit awaits either way.
export const init: ClientInit = determinismInit;
