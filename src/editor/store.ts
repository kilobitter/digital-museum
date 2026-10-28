import type { Museum } from '../shared/museum';

export type LoadResult =
  | { status: 'ok'; museum: Museum }
  | { status: 'missing'; museum: Museum }
  | { status: 'invalid'; errors: string[] };

export type SaveOutcome =
  | { ok: true }
  /** `conflict`: museum.json changed on disk since it was loaded or last saved; nothing was written. */
  | { ok: false; errors: string[]; conflict?: boolean };

/** Everything the editor needs from "where the museum lives". */
export interface MuseumStore {
  kind: 'dev' | 'folder';
  /** Shown in the top bar, e.g. "Dev server" or the folder name. */
  label: string;
  writable: boolean;
  /** Where the Preview button points. */
  previewUrl: string;
  load(): Promise<LoadResult>;
  /** Validates with parseMuseum first. `overwrite` skips the external-change guard. */
  save(m: Museum, opts?: { overwrite?: boolean }): Promise<SaveOutcome>;
  /** Returns "media/<id>.<ext>". */
  upload(name: string, data: Blob): Promise<string>;
  /** A file that is already gone is not an error. */
  deleteMedia(file: string): Promise<void>;
  /** Synchronous URL for <img>, <audio> and SVG patterns, or undefined when the file is unknown. */
  mediaUrl(file: string): string | undefined;
  /** Releases object URLs. */
  dispose(): void;
}
