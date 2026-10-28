import type { CSSProperties } from 'react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Museum } from '../shared/museum';
import { defaultMuseum, parseMuseum } from '../shared/validate';
import { deleteMediaFile, loadMuseum, saveMuseum, uploadMedia } from './api';
import { Canvas, type CanvasHandle } from './Canvas';
import { Inspector, SettingsPanel } from './Inspector';
import { Library, type Section } from './Library';
import { LibraryResizer, useLibraryHeight } from './LibraryResizer';
import { isLoopbackHost, localEditorUrl } from './host';
import { AUDIO_WARN_BYTES, MAX_TEXTURE_SIDE, mediaKindOf, parsePaintingFilename, prepareImage } from './media';
import { isDuplicate, runPool, summarizeUpload } from './uploadQueue';
import {
  addMedia, computeWarnings, deleteWall, deleteWork, deleteZone, findWall, findWork, findZone, removeMedia,
} from './model';
import { canRedo, canUndo, clearHistory, commitFrom, createHistory, push, redo, replace, undo, type History } from './history';
import { shouldScheduleAutosave } from './autosave';
import { TOOLS, type Selection, type Tool } from './types';

type Action =
  | { type: 'reset'; museum: Museum }
  | { type: 'push'; museum: Museum; key?: string }
  | { type: 'edit'; fn: (m: Museum) => Museum; clear?: boolean; key?: string }
  | { type: 'preview'; museum: Museum }
  | { type: 'commit'; base: Museum }
  | { type: 'undo' }
  | { type: 'redo' };

function reducer(h: History<Museum>, a: Action): History<Museum> {
  switch (a.type) {
    case 'reset': return createHistory(a.museum);
    case 'push': return push(h, a.museum, a.key ?? null);
    case 'edit': {
      const next = push(h, a.fn(h.present), a.key ?? null);
      return a.clear ? clearHistory(next) : next;
    }
    case 'preview': return replace(h, a.museum);
    case 'commit': return commitFrom(h, a.base);
    case 'undo': return undo(h);
    case 'redo': return redo(h);
  }
}

const UPLOAD_CONCURRENCY = 3;
const SIZES_KEY = 'museum-editor.uploadSizes';
/** Original byte sizes of uploaded files (per browser; the museum format has no field for them), used to spot re-uploads. */
function loadSizes(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(SIZES_KEY) ?? '{}');
    return raw && typeof raw === 'object' ? (raw as Record<string, number>) : {};
  } catch {
    return {};
  }
}
function saveSizes(sizes: Record<string, number>): void {
  try {
    const clean = Object.fromEntries(Object.entries(sizes).filter(([k]) => !k.startsWith('pending:')));
    localStorage.setItem(SIZES_KEY, JSON.stringify(clean));
  } catch { /* storage unavailable: duplicates then match on name only */ }
}

const isField = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);

type Boot = { phase: 'loading' } | { phase: 'invalid'; errors: string[] } | { phase: 'ready'; missing: boolean };

export function App() {
  const [boot, setBoot] = useState<Boot>({ phase: 'loading' });
  const lib = useLibraryHeight();
  const [hist, dispatch] = useReducer(reducer, undefined, () => createHistory(defaultMuseum()));
  const [saved, setSaved] = useState<Museum | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [selection, setSelection] = useState<Selection>(null);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [bigAudio, setBigAudio] = useState<ReadonlySet<string>>(new Set());
  const [interacting, setInteracting] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [randomHang, setRandomHang] = useState(false);
  // The dev write API only accepts loopback requests; elsewhere the editor is view-only.
  const local = isLoopbackHost(window.location.hostname);
  const localRef = useRef(local);
  const canvas = useRef<CanvasHandle>(null);

  const museum = hist.present;
  const presentRef = useRef(museum);
  presentRef.current = museum;
  const savedRef = useRef<Museum | null>(null);
  savedRef.current = saved;
  const savingRef = useRef(false);
  const dirty = museum !== saved;

  // ----- loading -----
  const load = useCallback(async () => {
    setBoot({ phase: 'loading' });
    const r = await loadMuseum();
    if (r.status === 'invalid') return setBoot({ phase: 'invalid', errors: r.errors });
    dispatch({ type: 'reset', museum: r.museum });
    setSaved(r.status === 'ok' ? r.museum : null);
    setBoot({ phase: 'ready', missing: r.status === 'missing' });
  }, []);
  useEffect(() => void load(), [load]);

  // ----- notices -----
  const notify = useCallback((msg: string) => setNotice(msg), []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(t);
  }, [notice]);

  // ----- saving -----
  const saveNow = useCallback(async () => {
    if (savingRef.current || !localRef.current) return;
    const snap = presentRef.current;
    const parsed = parseMuseum(snap);
    if (!parsed.ok) {
      setSaveErrors(parsed.errors);
      setSaveState('error');
      setShowErrors(true);
      return;
    }
    savingRef.current = true;
    setSaveState('saving');
    const r = await saveMuseum(snap);
    savingRef.current = false;
    if (r.ok) {
      setSaved(snap);
      savedRef.current = snap;
      setSaveErrors([]);
      setShowErrors(false);
      setSaveState('idle');
      if (presentRef.current !== snap) void saveNow(); // edited while saving
    } else {
      setSaveErrors(r.errors);
      setSaveState('error');
      setShowErrors(true);
    }
  }, []);

  useEffect(() => {
    if (!local) return;
    if (!shouldScheduleAutosave({ ready: boot.phase === 'ready', interacting, present: museum, saved: savedRef.current })) return;
    const t = setTimeout(() => void saveNow(), 2000);
    return () => clearTimeout(t);
    // re-runs when a gesture ends (interacting -> false), which reschedules the save
  }, [museum, interacting, boot.phase, saveNow, local]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (presentRef.current !== savedRef.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  // ----- selection hygiene -----
  const sel: Selection =
    selection?.type === 'wall' ? (findWall(museum, selection.id) ? selection : null)
    : selection?.type === 'work' ? (findWork(museum, selection.id) ? selection : null)
    : selection?.type === 'zone' ? (findZone(museum, selection.id) ? selection : null)
    : selection;

  const change = useCallback((m: Museum, key?: string) => dispatch({ type: 'push', museum: m, key }), []);
  const deleteSelection = useCallback(() => {
    if (!sel) return;
    if (sel.type === 'wall') dispatch({ type: 'edit', fn: (m) => deleteWall(m, sel.id) });
    else if (sel.type === 'work') dispatch({ type: 'edit', fn: (m) => deleteWork(m, sel.id) });
    else if (sel.type === 'zone') dispatch({ type: 'edit', fn: (m) => deleteZone(m, sel.id) });
    else return;
    setSelection(null);
  }, [sel]);

  // ----- keyboard -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveNow();
        return;
      }
      if (isField(e.target)) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        dispatch({ type: 'redo' });
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === 'Escape') {
        if (!canvas.current?.cancelDraft()) setSelection(null);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
        return;
      }
      const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (t) setTool(t.tool);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveNow, deleteSelection]);

  // ----- media -----
  const audioMediaId =
    (selectedMediaId && museum.media.find((x) => x.id === selectedMediaId)?.kind === 'audio' ? selectedMediaId : null) ??
    museum.media.find((x) => x.kind === 'audio')?.id ??
    null;

  const addFiles = useCallback(
    async (files: File[], section: Section) => {
      if (!localRef.current) return;
      const failures: string[] = [];
      const skipped: string[] = [];
      const queue: { file: File; kind: Section }[] = [];
      const sizes = loadSizes();
      // Library as it will look while the batch runs, so duplicates inside one drop are caught too.
      const known = presentRef.current.media.map((x) => ({ name: x.name, file: x.file }));
      for (const f of files) {
        const fileKind = mediaKindOf(f);
        if (!fileKind) {
          failures.push(`${f.name}: unsupported type`);
        } else if ((section === 'audio') !== (fileKind === 'audio')) {
          failures.push(`${f.name}: ${fileKind === 'audio' ? 'audio belongs in the Audio section' : 'images go into Paintings or Textures'}`);
        } else if (isDuplicate(known, sizes, f)) {
          skipped.push(f.name);
        } else {
          known.push({ name: f.name, file: `pending:${f.name}:${f.size}` });
          sizes[`pending:${f.name}:${f.size}`] = f.size;
          queue.push({ file: f, kind: section });
        }
      }
      let added = 0;
      const bigNames: string[] = [];
      const results = await runPool(
        queue,
        UPLOAD_CONCURRENCY,
        async ({ file: f, kind }) => {
          let item: Parameters<typeof addMedia>[1];
          if (kind === 'image' || kind === 'texture') {
            const img = await prepareImage(f, kind === 'texture' ? MAX_TEXTURE_SIDE : undefined);
            const file = await uploadMedia(f.name.replace(/\.[^.]+$/, '') + '.jpg', img.blob);
            item = { kind, file, name: f.name, width: img.width, height: img.height };
            if (kind === 'image') {
              const { title, artist } = parsePaintingFilename(f.name);
              item.title = title;
              if (artist) item.artist = artist;
            }
          } else {
            const file = await uploadMedia(f.name, f);
            item = { kind, file, name: f.name };
          }
          sizes[item.file] = f.size;
          // One undo step for the whole batch (same key), and the file is recorded right away so a
          // browser crash mid-batch loses nothing that was already uploaded.
          dispatch({ type: 'edit', key: 'bulk-upload', fn: (m) => addMedia(m, item).museum });
          if (kind === 'audio' && f.size > AUDIO_WARN_BYTES) bigNames.push(item.file);
          return f.name;
        },
        (done, total) => setBusy(`Uploading ${done} / ${total}…`),
      );
      results.forEach((r, i) => {
        if (r.ok) added++;
        else failures.push(`${queue[i].file.name}: ${r.error instanceof Error ? r.error.message : String(r.error)}`);
      });
      saveSizes(sizes);
      if (bigNames.length) {
        // the reducer runs lazily; resolve the new ids from the latest museum on the next tick
        setTimeout(() => {
          const ids = presentRef.current.media.filter((x) => bigNames.includes(x.file)).map((x) => x.id);
          setBigAudio((s) => new Set([...s, ...ids]));
        }, 0);
      }
      setBusy(null);
      if (files.length) notify(summarizeUpload(added, skipped, failures));
    },
    [notify],
  );

  const deleteMedia = useCallback(
    async (id: string) => {
      const item = museum.media.find((x) => x.id === id);
      if (!item) return;
      if (!localRef.current) return;
      if (removeMedia(museum, id) === null) return notify('This file is still used by a work, zone or wall finish.');
      try {
        await deleteMediaFile(item.file);
      } catch (e) {
        return notify(e instanceof Error ? e.message : String(e));
      }
      dispatch({ type: 'edit', fn: (m) => removeMedia(m, id) ?? m, clear: true });
      if (selectedMediaId === id) setSelectedMediaId(null);
      notify('File deleted. Undo history was cleared.');
    },
    [museum, selectedMediaId, notify],
  );

  const selectMedia = (id: string | null) => {
    setSelectedMediaId(id);
    if (id && museum.media.find((x) => x.id === id)?.kind === 'image') {
      setTool('work');
      setRandomHang(false);
    }
  };

  const toggleRandom = () => {
    setRandomHang((r) => !r);
    setTool('work');
  };

  const warnings = computeWarnings(museum);

  if (boot.phase === 'loading') return <div className="boot">Loading…</div>;
  if (boot.phase === 'invalid')
    return (
      <div className="boot">
        <div className="boot-card">
          <h2>museum.json could not be loaded</h2>
          <p>The file exists but is not a valid museum. Nothing has been changed on disk.</p>
          <ul className="errors">{boot.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          <div className="row">
            <button onClick={() => void load()}>Reload</button>
            <button
              className="danger"
              onClick={() => {
                dispatch({ type: 'reset', museum: defaultMuseum() });
                setSaved(null);
                setBoot({ phase: 'ready', missing: true });
              }}
            >
              Start empty (overwrites on next save)
            </button>
          </div>
        </div>
      </div>
    );

  const status =
    saveState === 'saving' ? { cls: 'saving', text: 'Saving…' }
    : saveState === 'error' ? { cls: 'error', text: 'Save failed' }
    : dirty ? { cls: 'dirty', text: saved === null ? 'Not saved yet' : 'Unsaved changes' }
    : { cls: 'saved', text: 'Saved' };

  return (
    <div
      className={'app' + (dropping ? ' dropping' : '')}
      style={{ '--lib-h': `${lib.height}px` } as CSSProperties}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        // Dropping outside a library section is ambiguous for images: audio only.
        const dropped = [...e.dataTransfer.files];
        const audio = dropped.filter((f) => mediaKindOf(f) === 'audio');
        if (audio.length < dropped.length) notify('Drop images onto the Paintings or Textures section of the library.');
        if (audio.length) void addFiles(audio, 'audio');
      }}
    >
      <header className="topbar">
        <strong className="title">{museum.name || 'Untitled'}</strong>
        <span className="sep" />
        <button disabled={!canUndo(hist)} onClick={() => dispatch({ type: 'undo' })} title="Undo (Ctrl/Cmd+Z)">Undo</button>
        <button disabled={!canRedo(hist)} onClick={() => dispatch({ type: 'redo' })} title="Redo (Shift+Ctrl/Cmd+Z)">Redo</button>
        <span className="grow" />
        <button className={'status ' + status.cls} onClick={() => saveState === 'error' && setShowErrors((v) => !v)} title={saveState === 'error' ? 'Show errors' : ''}>
          <i /> {status.text}
        </button>
        <button className="primary" onClick={() => void saveNow()} disabled={saveState === 'saving' || !local} title="Ctrl/Cmd+S">Save</button>
        <a className="btn" href="./index.html" target="_blank" rel="noreferrer">Preview ↗</a>
      </header>

      {showErrors && saveErrors.length > 0 && (
        <div className="error-panel">
          <div className="row"><strong>{saveState === 'error' ? 'Not saved' : 'Errors'}</strong><span className="grow" /><button onClick={() => setShowErrors(false)}>Close</button></div>
          <ul className="errors">{saveErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}

      {!local && (
        <div className="banner">
          Saving only works from this computer: open{' '}
          <a href={localEditorUrl(window.location.port)}>{localEditorUrl(window.location.port)}</a>. Save and uploads are disabled here.
        </div>
      )}

      <nav className="toolbar">
        {TOOLS.map((t) => (
          <button key={t.tool} className={tool === t.tool ? 'active' : ''} onClick={() => setTool(t.tool)} title={`${t.label} (${t.key}): ${t.hint}`}>
            <span className="tool-key">{t.key}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <main className="main">
        <Canvas
          handleRef={canvas}
          museum={museum}
          tool={tool}
          selection={sel}
          selectedMediaId={selectedMediaId && museum.media.find((x) => x.id === selectedMediaId)?.kind === 'image' ? selectedMediaId : null}
          randomHang={randomHang}
          audioMediaId={audioMediaId}
          onSelect={setSelection}
          onPreview={(m) => dispatch({ type: 'preview', museum: m })}
          onCommit={(base) => dispatch({ type: 'commit', base })}
          onChange={(m) => change(m)}
          onNotice={notify}
          onInteraction={setInteracting}
        />
        <div className="hintbar">{tool === 'work' && randomHang ? 'Random painting: click a wall face to hang a painting you have not hung yet.' : TOOLS.find((t) => t.tool === tool)?.hint}</div>
        {notice && <div className="toast" onClick={() => setNotice(null)}>{notice}</div>}
        {dropping && <div className="dropveil">Drop audio here, or images onto a library section</div>}
      </main>

      <aside className="sidebar">
        <Inspector museum={museum} selection={sel} selectedMediaId={selectedMediaId} onChange={change} onDeleted={() => setSelection(null)} />
        <SettingsPanel museum={museum} onChange={change} />
        <section className="panel">
          <h3>Warnings {warnings.length > 0 && <span className="badge">{warnings.length}</span>}</h3>
          {warnings.length === 0 ? (
            <p className="hint">Nothing to flag.</p>
          ) : (
            <ul className="warnings">
              {warnings.map((w, i) => (
                <li key={i}>
                  <button
                    className="link"
                    onClick={() => setSelection(w.target.type === 'spawn' ? { type: 'spawn' } : w.target.type === 'settings' ? null : { type: w.target.type, id: w.target.id })}
                  >
                    {w.message}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>

      <LibraryResizer height={lib.height} max={lib.max} onChange={lib.set} onToggle={lib.toggle} />
      <Library museum={museum} selectedId={selectedMediaId} bigAudio={bigAudio} busy={busy} readOnly={!local} randomHang={randomHang} onSelect={selectMedia} onFiles={(f, s) => void addFiles(f, s)} onDelete={(id) => void deleteMedia(id)} onToggleRandom={toggleRandom} />
    </div>
  );
}
