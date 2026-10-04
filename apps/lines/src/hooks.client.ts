import { installDeterminism } from './game/determinism';

// First, before any game module runs: the test-only clock + seed hook (`?ie_determinism=<seed>`).
// Without the flag it returns at once and replaces nothing.
installDeterminism();
