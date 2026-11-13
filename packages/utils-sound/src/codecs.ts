import { Howler } from 'howler';

/**
 * Whether this browser decodes `ext` (`ogg`, `m4a`, `mp3`, …), by howler's own test — the one it
 * runs on a bank's `src` list to choose a file. A caller that must pick the container itself (the
 * engine's stock banks carry a different sprite offset per container) asks the same question, so
 * it chooses what howler would.
 */
export const canPlayAudioFormat = (ext: string): boolean => Howler.codecs(ext);
