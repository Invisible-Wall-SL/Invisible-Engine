import { projectPrefix } from './projectPaths';

/**
 * Where frame to rig keeps things (docs/design/frame-to-rig.md §5): a cut's folder and the sheet a
 * rig made from a frame takes its images from. No I/O, so the save path can name them without
 * loading the cut's launcher half (`rigFromFrame.ts`, which re-exports them).
 */
export function jobRoot(clientKey: string, projectKey: string, job: string): string {
	return `${projectPrefix(clientKey, projectKey)}/rig-from-frame/${job}`;
}

/** The project sheet a rig made from a frame takes its images from (design §5). */
export function partsSheetName(rigName: string): string {
	return `${rigName}_parts`;
}
