import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Museum } from '../shared/museum';
import { defaultMuseum, parseMuseum } from '../shared/validate';
import type { MuseumStore } from './store';
import { Canvas, type CanvasHandle } from './Canvas';
import { Inspector, SettingsPanel } from './Inspector';
import { Library, type Section } from './Library';
import { LibraryResizer, useLibraryHeight } from './LibraryResizer';
import { AUDIO_WARN_BYTES, MAX_PANORAMA_SIDE, MAX_TEXTURE_SIDE, PANORAMA_JPEG_QUALITY, isRoughlyEquirect, mediaKindOf, parsePaintingFilename, prepareImage } from './media';
import { isDuplicate, runPool, summarizeUpload } from './uploadQueue';
import { addMedia, computeWarnings, removeMedia } from './model';
import { canRedo, canUndo, clearHistory, commitFrom, createHistory, push, redo, replace, undo, type History } from './history';
import { shouldScheduleAutosave } from './autosave';
import { LAYER_KEY, toolsFor, type Layer, type Selection, type Tool } from './types';
import { MultiInspector } from './MultiInspector';
import { ImportMenu } from './ImportMenu';
import { prepareMedia } from './importFlow';
import { mergeMuseum } from './importMerge';
import type { ImportSource } from './importSource';
import { exportMuseumZip } from './exportZip';
import { Field, NumField } from './fields';
import { DOOR_DEFAULT_M, clampDoorWidth } from './doorway';
import {
  EMPTY_SEL, allItems, cleanSelection, deleteSelection as deleteItems, duplicateOffset, duplicateSelection, fromSelection, isEmptySel, moveSelection,
  rotateSelection, selCount, singleOf, type MultiSel,
} from './multiSelect';

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

const INCLUDE_AREAS_KEY = 'museum-editor.includeAreas';
const DOOR_WIDTH_KEY = 'museum-editor.doorWidth';
const ONLY_USED_KEY = 'museum-editor.importOnlyUsed';
function loadOnlyUsed(): boolean {
  try {
    return localStorage.getItem(ONLY_USED_KEY) === 'true';
  } catch {
    return false;
  }
}
function loadIncludeAreas(): boolean {
  try {
    return localStorage.getItem(INCLUDE_AREAS_KEY) !== 'false';
  } catch {
    return true;
  }
}
function loadDoorWidth(): number {
  try {
    const raw = localStorage.getItem(DOOR_WIDTH_KEY);
    return raw === null ? DOOR_DEFAULT_M : clampDoorWidth(Number(raw));
  } catch {
    return DOOR_DEFAULT_M;
  }
}
function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch { /* preference just is not remembered */ }
}

const isField = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);

type Boot = { phase: 'loading' } | { phase: 'invalid'; errors: string[] } | { phase: 'ready'; missing: boolean };

export interface EditorProps {
  store: MuseumStore;
  /** Present for the folder flow: returns to the start screen (after the editor has flushed its save). */
  onSwitchFolder?: () => void;
}

export function App({ store, onSwitchFolder }: EditorProps) {
  const [boot, setBoot] = useState<Boot>({ phase: 'loading' });
  const lib = useLibraryHeight();
  const [hist, dispatch] = useReducer(reducer, undefined, () => createHistory(defaultMuseum()));
  const [saved, setSaved] = useState<Museum | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error' | 'conflict'>('idle');
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [layer, setLayerState] = useState<Layer>('build');
  const [rawMulti, setRawMulti] = useState<MultiSel>(EMPTY_SEL);
  const [includeAreas, setIncludeAreasState] = useState(loadIncludeAreas);
  const [doorWidth, setDoorWidthState] = useState(loadDoorWidth);
  const [onlyUsed, setOnlyUsedState] = useState(loadOnlyUsed);
  const [importPanel, setImportPanel] = useState<{ title: string; items: string[] } | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [bigAudio, setBigAudio] = useState<ReadonlySet<string>>(new Set());
  const [interacting, setInteracting] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [randomHang, setRandomHang] = useState(false);
  const writable = store.writable;
  const canvas = useRef<CanvasHandle>(null);

  const museum = hist.present;
  const presentRef = useRef(museum);
  presentRef.current = museum;
  const layerRef = useRef(layer);
  layerRef.current = layer;
  const multiRef = useRef<MultiSel>(EMPTY_SEL);
  const toolRef = useRef<Tool>('select');
  toolRef.current = tool;
  const includeAreasRef = useRef(includeAreas);
  includeAreasRef.current = includeAreas;
  /** Changes with every selection change, so a burst of arrow-key nudges merges into one undo step only for one selection. */
  const selNonce = useRef(0);
  const savedRef = useRef<Museum | null>(null);
  savedRef.current = saved;
  const savingRef = useRef(false);
  const saveStateRef = useRef(saveState);
  saveStateRef.current = saveState;
  const dirty = museum !== saved;

  // ----- loading -----
  const load = useCallback(async () => {
    setBoot({ phase: 'loading' });
    const r = await store.load();
    setSaveState('idle');
    setSaveErrors([]);
    setShowErrors(false);
    if (r.status === 'invalid') return setBoot({ phase: 'invalid', errors: r.errors });
    dispatch({ type: 'reset', museum: r.museum });
    setSaved(r.status === 'ok' ? r.museum : null);
    setBoot({ phase: 'ready', missing: r.status === 'missing' });
  }, [store]);
  useEffect(() => void load(), [load]);
  useEffect(() => () => store.dispose(), [store]);

  // ----- notices -----
  const notify = useCallback((msg: string) => setNotice(msg), []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), Math.min(15000, Math.max(4500, notice.length * 55)));
    return () => clearTimeout(t);
  }, [notice]);

  // ----- saving -----
  /** Resolves true when everything is saved. `overwrite` skips the external-change guard (folder store). */
  const saveNow = useCallback(async (overwrite = false): Promise<boolean> => {
    if (savingRef.current || !writable) return false;
    const snap = presentRef.current;
    const parsed = parseMuseum(snap);
    if (!parsed.ok) {
      setSaveErrors(parsed.errors);
      setSaveState('error');
      setShowErrors(true);
      return false;
    }
    savingRef.current = true;
    setSaveState('saving');
    const r = await store.save(snap, { overwrite });
    savingRef.current = false;
    if (r.ok) {
      setSaved(snap);
      savedRef.current = snap;
      setSaveErrors([]);
      setShowErrors(false);
      setSaveState('idle');
      if (presentRef.current !== snap) return saveNow(); // edited while saving
      return true;
    }
    setSaveErrors(r.errors);
    setSaveState(r.conflict ? 'conflict' : 'error');
    setShowErrors(true);
    return false;
  }, [store, writable]);

  useEffect(() => {
    if (!writable || saveState === 'conflict') return; // autosave pauses until the conflict is resolved
    if (!shouldScheduleAutosave({ ready: boot.phase === 'ready', interacting, present: museum, saved: savedRef.current })) return;
    const t = setTimeout(() => void saveNow(), 2000);
    return () => clearTimeout(t);
    // re-runs when a gesture ends (interacting -> false), which reschedules the save
  }, [museum, interacting, boot.phase, saveNow, writable, saveState]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (presentRef.current !== savedRef.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  // ----- selection -----
  const multi = useMemo(() => cleanSelection(museum, rawMulti, layer), [museum, rawMulti, layer]);
  const sel: Selection = singleOf(multi, layer);
  multiRef.current = multi;

  const setMultiSel = useCallback((ms: MultiSel) => {
    selNonce.current++;
    setRawMulti(ms);
  }, []);
  const setSelection = useCallback((s: Selection) => setMultiSel(fromSelection(s)), [setMultiSel]);
  const setIncludeAreas = (v: boolean) => {
    setIncludeAreasState(v);
    savePref(INCLUDE_AREAS_KEY, String(v));
  };
  const setDoorWidth = (v: number) => {
    const w = clampDoorWidth(v);
    setDoorWidthState(w);
    savePref(DOOR_WIDTH_KEY, String(w));
  };

  const setLayer = useCallback((next: Layer) => {
    setLayerState(next);
    setMultiSel(EMPTY_SEL);
    setTool('select');
    canvas.current?.cancelDraft();
  }, [setMultiSel]);

  const change = useCallback((m: Museum, key?: string) => dispatch({ type: 'push', museum: m, key }), []);

  const deleteSelection = useCallback(() => {
    const ms = multiRef.current;
    if (ms.walls.length + ms.works.length + ms.zones.length + ms.areas.length === 0) return;
    dispatch({ type: 'edit', fn: (m) => deleteItems(m, ms) });
    setMultiSel(EMPTY_SEL);
  }, [setMultiSel]);

  const duplicateSel = useCallback(() => {
    const ms = multiRef.current;
    if (isEmptySel(ms)) return;
    const m = presentRef.current;
    const r = duplicateSelection(m, ms, duplicateOffset(m.settings.gridSize));
    if (selCount(r.selection) === 0 && r.museum.walls.length === m.walls.length && r.museum.works.length === m.works.length) {
      notify(ms.spawn && selCount(ms) === 1 ? 'The spawn point cannot be duplicated.' : 'Nothing was copied: a lone painting is copied along its wall only if the copy still fits.');
      return;
    }
    dispatch({ type: 'push', museum: r.museum });
    setMultiSel(r.selection);
  }, [notify, setMultiSel]);

  const rotateSel = useCallback((dir: 1 | -1) => {
    const ms = multiRef.current;
    if (ms.walls.length + ms.zones.length + ms.areas.length === 0 && !ms.spawn) {
      if (ms.works.length) notify('Paintings turn with their wall: select the wall as well.');
      return;
    }
    dispatch({ type: 'edit', fn: (m) => rotateSelection(m, ms, dir) });
  }, [notify]);

  const nudgeSel = useCallback((dx: number, dy: number, steps: number): boolean => {
    const ms = multiRef.current;
    if (ms.walls.length + ms.zones.length + ms.areas.length === 0 && !ms.spawn) return false;
    const g = presentRef.current.settings.gridSize * steps;
    // one undo step per burst of nudges on the same selection
    dispatch({ type: 'edit', key: `nudge.${selNonce.current}`, fn: (m) => moveSelection(m, ms, { x: dx * g, y: dy * g }) });
    return true;
  }, []);

  const selectAll = useCallback(() => {
    const areasOnly = layerRef.current === 'areas';
    const m = presentRef.current;
    setMultiSel(allItems(m, areasOnly ? { walls: false, works: false, zones: false, spawn: false } : { areas: includeAreasRef.current }));
  }, [setMultiSel]);

  // ----- keyboard -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (saveStateRef.current !== 'conflict') void saveNow();
        return;
      }
      if (isField(e.target)) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSel();
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAll();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        dispatch({ type: 'redo' });
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === 'Escape') {
        if (canvas.current?.cancelDraft()) return;
        if (toolRef.current === 'door') setTool('select');
        else setMultiSel(EMPTY_SEL);
        return;
      }
      if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        rotateSel(e.key === ']' ? 1 : -1);
        return;
      }
      if (e.key.startsWith('Arrow') && toolRef.current === 'select') {
        const steps = e.shiftKey ? 5 : 1;
        const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
        if ((dx || dy) && nudgeSel(dx, dy, steps)) e.preventDefault();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (e.key.toLowerCase() === LAYER_KEY.toLowerCase()) {
        setLayer(layerRef.current === 'areas' ? 'build' : 'areas');
        return;
      }
      const t = toolsFor(layerRef.current).find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (t) setTool(t.tool);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveNow, deleteSelection, setLayer, duplicateSel, selectAll, rotateSel, nudgeSel, setMultiSel]);

  // ----- media -----
  const audioMediaId =
    (selectedMediaId && museum.media.find((x) => x.id === selectedMediaId)?.kind === 'audio' ? selectedMediaId : null) ??
    museum.media.find((x) => x.kind === 'audio')?.id ??
    null;

  const addFiles = useCallback(
    async (files: File[], section: Section) => {
      if (!writable) return;
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
          failures.push(`${f.name}: ${fileKind === 'audio' ? 'audio belongs in the Audio section' : 'images go into Paintings, Textures or Panoramas'}`);
        } else if (isDuplicate(known, sizes, f)) {
          skipped.push(f.name);
        } else {
          known.push({ name: f.name, file: `pending:${f.name}:${f.size}` });
          sizes[`pending:${f.name}:${f.size}`] = f.size;
          queue.push({ file: f, kind: section });
        }
      }
      let added = 0;
      const aspectNotes: string[] = [];
      const bigNames: string[] = [];
      const results = await runPool(
        queue,
        UPLOAD_CONCURRENCY,
        async ({ file: f, kind }) => {
          let item: Parameters<typeof addMedia>[1];
          if (kind === 'image' || kind === 'texture' || kind === 'panorama') {
            const img =
              kind === 'panorama'
                ? await prepareImage(f, MAX_PANORAMA_SIDE, PANORAMA_JPEG_QUALITY)
                : await prepareImage(f, kind === 'texture' ? MAX_TEXTURE_SIDE : undefined);
            if (kind === 'panorama' && !isRoughlyEquirect(img.width, img.height))
              aspectNotes.push(`${f.name} is ${img.width}×${img.height}: a sky panorama should be about 2:1 (equirectangular) or it will look stretched`);
            const file = await store.upload(f.name.replace(/\.[^.]+$/, '') + '.jpg', img.blob);
            item = { kind, file, name: f.name, width: img.width, height: img.height };
            if (kind === 'image') {
              const { title, artist } = parsePaintingFilename(f.name);
              item.title = title;
              if (artist) item.artist = artist;
            }
          } else {
            const file = await store.upload(f.name, f);
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
      if (files.length) notify([summarizeUpload(added, skipped, failures), ...aspectNotes].join(' '));
    },
    [notify, store, writable],
  );

  const deleteMedia = useCallback(
    async (id: string) => {
      const item = museum.media.find((x) => x.id === id);
      if (!item) return;
      if (!writable) return;
      if (removeMedia(museum, id) === null) return notify('This file is still used by a work, zone, wall/floor/ceiling finish or area.');
      try {
        await store.deleteMedia(item.file);
      } catch (e) {
        return notify(e instanceof Error ? e.message : String(e));
      }
      dispatch({ type: 'edit', fn: (m) => removeMedia(m, id) ?? m, clear: true });
      if (selectedMediaId === id) setSelectedMediaId(null);
      notify('File deleted. Undo history was cleared.');
    },
    [museum, selectedMediaId, notify, store, writable],
  );

  const selectMedia = (id: string | null) => {
    setSelectedMediaId(id);
    if (id && museum.media.find((x) => x.id === id)?.kind === 'image') {
      setLayerState('build');
      setTool('work');
      setRandomHang(false);
    }
  };

  const toggleRandom = () => {
    setRandomHang((r) => !r);
    setLayerState('build');
    setTool('work');
  };

  // ----- importing and exporting whole museums -----
  useEffect(() => {
    if (fitNonce) canvas.current?.fit();
  }, [fitNonce]);

  const setOnlyUsed = (v: boolean) => {
    setOnlyUsedState(v);
    savePref(ONLY_USED_KEY, String(v));
  };

  const importMuseum = useCallback(
    async (source: ImportSource) => {
      if (!writable) return;
      setBusy('Importing…');
      setImportPanel(null);
      try {
        const prep = await prepareMedia(presentRef.current, source, store, {
          onlyUsed,
          concurrency: UPLOAD_CONCURRENCY,
          onProgress: (done, total) => setBusy(`Importing ${done}/${total}…`),
        });
        if (!prep.ok) {
          setImportPanel({
            title: 'Import stopped: nothing was changed in your museum',
            items: [...prep.failures, ...(prep.uploaded ? [`${prep.uploaded} files were already uploaded and stay in your library as unused media.`] : [])],
          });
          return;
        }
        const host = presentRef.current; // latest, in case it was edited meanwhile
        const r = mergeMuseum(host, source.museum, prep.mappings, { onlyUsed });
        const check = parseMuseum(r.museum);
        if (!check.ok) {
          setImportPanel({ title: 'Import stopped: the result would not be valid', items: check.errors });
          return;
        }
        dispatch({ type: 'push', museum: r.museum });
        setLayerState('build');
        setTool('select');
        canvas.current?.cancelDraft();
        setMultiSel(r.selection);
        setFitNonce((n) => n + 1);
        const warnings = [...prep.warnings, ...r.warnings];
        if (warnings.length) setImportPanel({ title: 'Import notes', items: warnings });
        const { walls, works, zones, areas, media } = r.summary;
        notify(
          `Imported "${source.museum.name || source.label}": ${walls} walls, ${works} paintings, ${zones} zones, ${areas} areas, ${media} files. ` +
            'Drag it into place; [ and ] rotate; use the Door tool to connect rooms. Undo removes it from the plan; the files stay in the library.',
        );
      } catch (e) {
        setImportPanel({ title: 'Import failed', items: [e instanceof Error ? e.message : String(e)] });
      } finally {
        setBusy(null);
      }
    },
    [notify, onlyUsed, setMultiSel, store, writable],
  );

  const exportZip = async () => {
    setBusy('Exporting…');
    try {
      while (savingRef.current) await new Promise((r) => setTimeout(r, 50));
      let flushed = true;
      if (writable && presentRef.current !== savedRef.current) flushed = await saveNow();
      const { blob, missing, fileName } = await exportMuseumZip(presentRef.current, store);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      notify(
        `Exported ${fileName}.` +
          (missing.length ? ` ${missing.length} media files were not found and are not in the zip: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ', …' : ''}.` : '') +
          (flushed ? '' : ' The latest changes could not be saved first; the zip holds what you see here.'),
      );
    } catch (e) {
      notify(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  // ----- external change / switching folders -----
  const reloadFromFolder = async () => {
    if (presentRef.current !== savedRef.current && !window.confirm('Reload from the folder? Your changes in this tab that are not in the folder will be lost.')) return;
    await load();
  };
  const overwriteFolder = async () => {
    if (!window.confirm('Overwrite the museum file in the folder with what you see here? The other changes will be lost.')) return;
    await saveNow(true);
  };
  const switchFolder = async () => {
    while (savingRef.current) await new Promise((r) => setTimeout(r, 50));
    if (presentRef.current !== savedRef.current) {
      const ok = await saveNow();
      if (!ok && !window.confirm('Your latest changes could not be saved. Switch folder anyway and lose them?')) return;
    }
    onSwitchFolder?.();
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
            {onSwitchFolder && <button onClick={onSwitchFolder}>Choose another folder</button>}
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
    : saveState === 'conflict' ? { cls: 'error', text: 'Paused: folder changed' }
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
        <span className="muted store-label" title={store.kind === 'folder' ? 'Folder on this computer' : 'Local development server'}>{store.label}</span>
        {onSwitchFolder && <button onClick={() => void switchFolder()} title="Save, then choose another museum folder">Switch folder</button>}
        <span className="sep" />
        <button disabled={!canUndo(hist)} onClick={() => dispatch({ type: 'undo' })} title="Undo (Ctrl/Cmd+Z)">Undo</button>
        <button disabled={!canRedo(hist)} onClick={() => dispatch({ type: 'redo' })} title="Redo (Shift+Ctrl/Cmd+Z)">Redo</button>
        <span className="sep" />
        <ImportMenu disabled={!writable || busy !== null} onlyUsed={onlyUsed} onOnlyUsed={setOnlyUsed} onSource={(s) => void importMuseum(s)} onProblem={(title, items) => setImportPanel({ title, items })} />
        <button disabled={busy !== null || museum.media.length + museum.walls.length === 0} onClick={() => void exportZip()} title="Download this museum as one .zip file to send to someone">Export .zip</button>
        {busy && <span className="muted">{busy}</span>}
        <span className="grow" />
        <button className={'status ' + status.cls} onClick={() => saveState === 'error' && setShowErrors((v) => !v)} title={saveState === 'error' ? 'Show errors' : ''}>
          <i /> {status.text}
        </button>
        <button className="primary" onClick={() => void saveNow()} disabled={saveState === 'saving' || saveState === 'conflict' || !writable} title="Ctrl/Cmd+S">Save</button>
        <a className="btn" href={store.previewUrl} target="_blank" rel="noreferrer">Preview ↗</a>
      </header>

      {showErrors && saveState !== 'conflict' && saveErrors.length > 0 && (
        <div className="error-panel">
          <div className="row"><strong>{saveState === 'error' ? 'Not saved' : 'Errors'}</strong><span className="grow" /><button onClick={() => setShowErrors(false)}>Close</button></div>
          <ul className="errors">{saveErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}

      {importPanel && (
        <div className="error-panel left">
          <div className="row"><strong>{importPanel.title}</strong><span className="grow" /><button onClick={() => setImportPanel(null)}>Close</button></div>
          <ul className="errors">{importPanel.items.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}

      {saveState === 'conflict' && (
        <div className="banner conflict">
          <strong>The museum file in this folder was changed by something else.</strong> Saving is paused so nothing is lost.
          <span className="grow" />
          <button onClick={() => void reloadFromFolder()}>Reload from folder</button>
          <button className="danger" onClick={() => void overwriteFolder()}>Overwrite</button>
        </div>
      )}

      <nav className="toolbar">
        <button
          className={'layer-switch ' + layer}
          onClick={() => setLayer(layer === 'areas' ? 'build' : 'areas')}
          title={`Switch layer (${LAYER_KEY}). Build: walls, works, zones, spawn. Areas: floor and ceiling areas.`}
        >
          <span className="tool-key">{LAYER_KEY}</span>
          <span>{layer === 'areas' ? 'Areas' : 'Build'}</span>
        </button>
        {toolsFor(layer).map((t) => (
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
          mediaUrl={store.mediaUrl}
          tool={tool}
          layer={layer}
          selection={sel}
          multi={multi}
          includeAreas={includeAreas}
          doorWidth={doorWidth}
          selectedMediaId={selectedMediaId && museum.media.find((x) => x.id === selectedMediaId)?.kind === 'image' ? selectedMediaId : null}
          randomHang={randomHang}
          audioMediaId={audioMediaId}
          onSelect={setSelection}
          onSelectMulti={setMultiSel}
          onPreview={(m) => dispatch({ type: 'preview', museum: m })}
          onCommit={(base) => dispatch({ type: 'commit', base })}
          onChange={(m) => change(m)}
          onNotice={notify}
          onInteraction={setInteracting}
        />
        <div className="hintbar">{layer === 'build' && tool === 'work' && randomHang ? 'Random painting: click a wall face to hang a painting you have not hung yet.' : toolsFor(layer).find((t) => t.tool === tool)?.hint}</div>
        {layer === 'build' && tool === 'door' && (
          <div className="tool-options">
            <Field label="Door width"><NumField value={doorWidth} min={0.5} max={4} step={0.1} onChange={setDoorWidth} unit="m" /></Field>
          </div>
        )}
        {notice && <div className="toast" onClick={() => setNotice(null)}>{notice}</div>}
        {dropping && <div className="dropveil">Drop audio here, or images onto a library section</div>}
      </main>

      <aside className="sidebar">
        {!sel && !isEmptySel(multi) ? (
          <MultiInspector
            museum={museum}
            multi={multi}
            includeAreas={includeAreas}
            onIncludeAreas={setIncludeAreas}
            onChange={change}
            onRotate={rotateSel}
            onDuplicate={duplicateSel}
            onDelete={deleteSelection}
          />
        ) : (
          <Inspector museum={museum} mediaUrl={store.mediaUrl} selection={sel} selectedMediaId={selectedMediaId} onChange={change} onDeleted={() => setSelection(null)} onDuplicate={duplicateSel} />
        )}
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
                    onClick={() => {
                      const t = w.target;
                      if (t.type === 'settings') return;
                      const want: Layer = t.type === 'area' ? 'areas' : 'build';
                      if (want !== layer) {
                        setLayerState(want);
                        setTool('select');
                      }
                      setSelection(t.type === 'spawn' ? { type: 'spawn' } : { type: t.type, id: t.id });
                    }}
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
      <Library museum={museum} mediaUrl={store.mediaUrl} selectedId={selectedMediaId} bigAudio={bigAudio} busy={busy} readOnly={!writable} randomHang={randomHang} onSelect={selectMedia} onFiles={(f, s) => void addFiles(f, s)} onDelete={(id) => void deleteMedia(id)} onToggleRandom={toggleRandom} />
    </div>
  );
}
