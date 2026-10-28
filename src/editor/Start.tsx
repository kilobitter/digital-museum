import { useEffect, useState } from 'react';
import {
  clearFolderHandle, fsAccessSupported, loadFolderHandle, pickMuseumFolder, requestAccess, saveFolderHandle, type FsDirHandle,
} from '../shared/folderHandle';
import { fsFromHandle } from './folderAdapter';
import { inspectFolder } from './folderStore';

/** Shown when no museum folder is open. */
export function Start({ onOpen }: { onOpen(h: FsDirHandle): void }) {
  const [remembered, setRemembered] = useState<FsDirHandle | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = fsAccessSupported();

  useEffect(() => {
    if (supported) void loadFolderHandle().then(setRemembered);
  }, [supported]);

  const open = async () => {
    setMessage(null);
    setBusy(true);
    try {
      const h = await pickMuseumFolder();
      if (!h) return;
      if ((await inspectFolder(fsFromHandle(h))) === 'other-files' && !window.confirm('This folder already contains other files. Create a museum here anyway?')) return;
      await saveFolderHandle(h); // so "Reopen" and the viewer preview can find it
      onOpen(h);
    } catch (e) {
      setMessage(`Could not open that folder: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // requestPermission needs the click, so it is the first thing that happens here
  const reopen = async (h: FsDirHandle) => {
    setMessage(null);
    setBusy(true);
    try {
      if ((await requestAccess(h, 'readwrite')) !== 'granted') {
        setMessage(`Access to "${h.name}" was not given. Try again and choose Allow, or open the folder again below.`);
        return;
      }
      try {
        await fsFromHandle(h).list('');
      } catch {
        await clearFolderHandle();
        setRemembered(null);
        setMessage(`"${h.name}" can no longer be found (moved, renamed or deleted). Please open the folder again.`);
        return;
      }
      onOpen(h);
    } finally {
      setBusy(false);
    }
  };

  if (!supported)
    return (
      <div className="boot">
        <div className="boot-card start">
          <h2>Museum editor</h2>
          <p>
            This editor saves your museum into a folder on your computer, which needs <strong>Chrome</strong> or <strong>Edge</strong> on a
            laptop or desktop computer. Safari, Firefox, phones and tablets are not supported.
          </p>
          <p className="hint">Using Brave? Open <code>brave://flags/#file-system-access-api</code>, switch it to Enabled, restart Brave and come back.</p>
        </div>
      </div>
    );

  return (
    <div className="boot">
      <div className="boot-card start">
        <h2>Museum editor</h2>
        <p>Your museum lives in a folder on your computer. Nothing is uploaded anywhere.</p>
        {remembered && (
          <div className="start-choice">
            <button className="primary" disabled={busy} onClick={() => void reopen(remembered)}>Reopen "{remembered.name}"</button>
            <p className="hint">Continue with the folder you used last time. Your browser will ask you to allow access again.</p>
          </div>
        )}
        <div className="start-choice">
          <button className={remembered ? '' : 'primary'} disabled={busy} onClick={() => void open()}>Open museum folder</button>
          <p className="hint">Pick an empty folder to start a new museum, or a folder that already has one.</p>
        </div>
        {message && <p className="start-error">{message}</p>}
      </div>
    </div>
  );
}
