import { useEffect, useMemo, useState } from 'react';
import type { FsDirHandle } from '../shared/folderHandle';
import { App } from './App';
import { fsFromHandle } from './folderAdapter';
import { createFolderStore } from './folderStore';
import { isLoopbackHost } from './host';
import { Start } from './Start';
import type { MuseumStore } from './store';

/** The dev server store is used only by `npm run dev` on this computer, unless `?folder` asks for the folder flow. */
function wantsDevStore(): boolean {
  return isLoopbackHost(window.location.hostname) && !new URLSearchParams(window.location.search).has('folder');
}

export function Root() {
  const [dev, setDev] = useState<MuseumStore | null>(null);
  const [folder, setFolder] = useState<FsDirHandle | null>(null);
  // In a production build `import.meta.env.DEV` is the literal false, so this whole branch (and the
  // dev store with its /api calls) is removed from the bundle.
  const useDev = import.meta.env.DEV ? wantsDevStore() : false;

  useEffect(() => {
    if (import.meta.env.DEV && useDev) void import('./devStore').then((m) => setDev(m.devStore));
  }, [useDev]);

  const folderStore = useMemo(() => (folder ? createFolderStore(fsFromHandle(folder)) : null), [folder]);

  if (useDev) return dev ? <App key="dev" store={dev} /> : <div className="boot">Loading…</div>;
  if (folder && folderStore) return <App key={folderStore.label + folder.name} store={folderStore} onSwitchFolder={() => setFolder(null)} />;
  return <Start onOpen={setFolder} />;
}
