/**
 * The match-3 seam (`docs/design/phase-11.md` §2.2): everything shared code uses from the match-3
 * family, and the only way it reaches that code. A build that leaves match-3 out
 * (`PUBLIC_IE_FAMILIES`, `config-vite`) resolves this module to `off/match3.ts` instead.
 */
export { default as Match3Input } from '../components/Match3Input.svelte';
export {
	awaitMatch3Round,
	endMatch3Round,
	presentMatch3Board,
	presentMatch3MovesLeft,
} from '../game/match3.svelte';
