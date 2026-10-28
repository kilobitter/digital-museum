import { useRef, useState } from 'react';
import { fsAccessSupported } from '../shared/folderHandle';
import { ImportError, pickImportFolder, sourceFromDirHandle, sourceFromFileList, sourceFromZip, type ImportSource } from './importSource';

interface Props {
  disabled: boolean;
  onlyUsed: boolean;
  onOnlyUsed(v: boolean): void;
  onSource(source: ImportSource): void;
  onProblem(title: string, items: string[]): void;
}

/** "Import museum…" button with a small popover: from a folder, from a .zip, and the "only used media" option. */
export function ImportMenu({ disabled, onlyUsed, onOnlyUsed, onSource, onProblem }: Props) {
  const [open, setOpen] = useState(false);
  const zipInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);

  const run = async (load: () => Promise<ImportSource | null>) => {
    setOpen(false);
    try {
      const s = await load();
      if (s) onSource(s);
    } catch (e) {
      if (e instanceof ImportError) onProblem('Could not import', e.errors);
      else onProblem('Could not import', [e instanceof Error ? e.message : String(e)]);
    }
  };

  const fromFolder = () => {
    if (fsAccessSupported()) {
      void run(async () => {
        const h = await pickImportFolder();
        return h ? sourceFromDirHandle(h) : null;
      });
    } else dirInput.current?.click();
  };

  return (
    <span className="import-menu">
      <button disabled={disabled} onClick={() => setOpen((v) => !v)} title="Copy another museum (a folder or a .zip) into this one">Import museum…</button>
      {open && (
        <div className="popover">
          <button onClick={fromFolder}>From a folder…</button>
          <button onClick={() => zipInput.current?.click()}>From a .zip file…</button>
          <label className="check"><input type="checkbox" checked={onlyUsed} onChange={(e) => onOnlyUsed(e.target.checked)} /> Only bring media that is used</label>
        </div>
      )}
      <input
        ref={zipInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void run(() => sourceFromZip(f));
        }}
      />
      <input
        ref={dirInput}
        type="file"
        hidden
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => {
          const files = e.target.files ? [...e.target.files] : [];
          e.target.value = '';
          if (files.length) void run(() => sourceFromFileList(files));
        }}
      />
    </span>
  );
}
