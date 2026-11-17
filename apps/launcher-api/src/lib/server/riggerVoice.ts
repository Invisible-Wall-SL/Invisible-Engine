import { randomBytes } from 'node:crypto';
import { MAX_SOUND_BYTES, SOUND_FILE_EXTENSIONS } from 'engine-layout';
import { SUB } from './projectPaths';
import { getObjectBytes, listAllObjects, presignPut } from './r2';
import { soundContentType } from './soundFiles';

/**
 * The Rigger's lip-sync voice lines (rig templates T4, docs/design/rig-templates.md §5.2): audio an
 * author uploads to turn into mouth keys. Authoring input only — the keys ship in the rig, the audio
 * does not (a line a game plays goes through Invisible Sound like any other sound).
 *
 * Uploads are presigned PUTs straight to R2: adapter-node caps a request body at 512 KB, under one
 * second of most voice files.
 */

export const MAX_VOICE_BYTES = MAX_SOUND_BYTES;

/** `<readable stem>-<8 hex>.<ext>`: readable in the picker, minted server-side so never a clash. */
const VOICE_FILE_RE = new RegExp(
	`^[A-Za-z0-9_-]{1,48}-[0-9a-f]{8}\\.(${SOUND_FILE_EXTENSIONS.join('|')})$`,
);

export const isVoiceFile = (file: string): boolean => VOICE_FILE_RE.test(file);

export function voiceKey(client: string, project: string, file: string): string {
	if (!isVoiceFile(file)) throw new Error(`Invalid voice filename: ${file}`);
	return `${SUB.voices(client, project)}/${file}`;
}

/** The stored name for an upload, or undefined when its extension is not an audio one we take. */
export function mintVoiceFile(uploadName: string): string | undefined {
	const base = uploadName.slice(uploadName.lastIndexOf('/') + 1);
	const dot = base.lastIndexOf('.');
	const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
	if (!(SOUND_FILE_EXTENSIONS as readonly string[]).includes(ext)) return undefined;
	const stem =
		base
			.slice(0, dot)
			.replace(/[^A-Za-z0-9_-]+/g, '_')
			.replace(/^_+|_+$/g, '')
			.slice(0, 48) || 'voice';
	return `${stem}-${randomBytes(4).toString('hex')}.${ext}`;
}

export function presignVoiceUpload(
	client: string,
	project: string,
	file: string,
	ttlSeconds: number,
): Promise<string> {
	return presignPut(voiceKey(client, project, file), soundContentType(file), ttlSeconds);
}

export interface VoiceEntry {
	file: string;
	size: number;
	modified: number;
}

/** The project's voice lines, newest first. */
export async function listVoices(client: string, project: string): Promise<VoiceEntry[]> {
	const prefix = `${SUB.voices(client, project)}/`;
	return (await listAllObjects(prefix))
		.map((o) => ({ file: o.key.slice(prefix.length), size: o.size, modified: o.lastModified }))
		.filter((v) => isVoiceFile(v.file))
		.sort((a, b) => b.modified - a.modified);
}

export async function getVoice(
	client: string,
	project: string,
	file: string,
): Promise<Uint8Array | null> {
	if (!isVoiceFile(file)) return null;
	const obj = await getObjectBytes(voiceKey(client, project, file));
	return obj ? obj.body : null;
}
