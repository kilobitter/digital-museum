import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { MediaItem, Museum } from '../shared/museum';
import { countLabel, filterPaintings, hungIds, paintingCounts, visibleWindow, type HungFilter } from './libraryFilter';
import { mediaUsage } from './model';
import { gridColumns, gridWindow, shouldUseGrid } from './libraryLayout';
import { TAB_STORAGE_KEY, parseTab, tabForKey } from './libraryTabs';

export type Section = 'image' | 'texture' | 'audio';

interface Props {
  museum: Museum;
  selectedId: string | null;
  bigAudio: ReadonlySet<string>;
  busy: string | null;
  /** Uploads are disabled (editor not opened from this computer). */
  readOnly: boolean;
  randomHang: boolean;
  onSelect(id: string | null): void;
  onFiles(files: File[], section: Section): void;
  onDelete(id: string): void;
  onToggleRandom(): void;
}

const SECTIONS: { section: Section; title: string; accept: string; empty: string }[] = [
  { section: 'image', title: 'Paintings', accept: '.jpg,.jpeg,.png,.webp', empty: 'No paintings yet. Resized to 1600 px.' },
  { section: 'texture', title: 'Textures', accept: '.jpg,.jpeg,.png,.webp', empty: 'No wall textures yet. Resized to 1024 px.' },
  { section: 'audio', title: 'Audio', accept: '.mp3,.m4a,.aac,.ogg,.wav', empty: 'No audio yet.' },
];

const CARD_STEP = 158; // card width 150 + gap 8 (see styles.css .card)
const ROW_STEP = 140; // grid card height 132 + gap 8 (see styles.css .card-grid .card)

/**
 * Scroller that only mounts the cards in (or near) view, so hundreds of items stay cheap.
 * Short panel: one horizontally scrolling row. Taller panel: a vertically scrolling grid that fills the width.
 */
function VirtualList({ count, render, resetKey }: { count: number; render: (i: number) => ReactNode; resetKey: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, top: 0, width: 1200, height: 120 });
  const saved = useRef({ left: 0, top: 0 }); // scroll offsets to restore when a hidden tab becomes visible again
  const lastSize = useRef(0);
  const lastGrid = useRef<boolean | null>(null);
  const measure = () => {
    const el = ref.current;
    if (!el) return;
    if (el.clientWidth === 0) {
      lastSize.current = 0; // hidden tab: keep the rendered window so the saved offset can be restored on return
      return;
    }
    const grid = shouldUseGrid(el.clientHeight, ROW_STEP);
    if (el.clientWidth > 0) {
      if (lastGrid.current !== null && lastGrid.current !== grid) {
        saved.current = { left: 0, top: 0 }; // the scroll axis changed
        el.scrollLeft = 0;
        el.scrollTop = 0;
      } else if (lastSize.current === 0 && (saved.current.left > 0 || saved.current.top > 0)) {
        el.scrollLeft = saved.current.left;
        el.scrollTop = saved.current.top;
      } else {
        saved.current = { left: el.scrollLeft, top: el.scrollTop };
      }
      lastGrid.current = grid;
    }
    lastSize.current = el.clientWidth;
    const next = { left: el.scrollLeft, top: el.scrollTop, width: el.clientWidth, height: el.clientHeight };
    setView((v) => (v.left === next.left && v.top === next.top && v.width === next.width && v.height === next.height ? v : next));
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    saved.current = { left: 0, top: 0 };
    if (ref.current) {
      ref.current.scrollLeft = 0;
      ref.current.scrollTop = 0;
    }
    measure();
  }, [resetKey]);

  const grid = shouldUseGrid(view.height, ROW_STEP);
  if (grid) {
    const cols = gridColumns(Math.max(0, view.width - 24), CARD_STEP); // 12px padding each side
    const [start, end] = gridWindow(view.top, view.height, ROW_STEP, cols, count);
    const items: ReactNode[] = [];
    for (let i = start; i < end; i++) items.push(render(i));
    const rowsBefore = Math.floor(start / cols);
    const rowsAfter = Math.ceil(count / cols) - Math.ceil(end / cols);
    return (
      <div className="library-items grid" ref={ref} onScroll={measure}>
        <div
          className="card-grid"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            paddingTop: rowsBefore * ROW_STEP,
            paddingBottom: Math.max(0, rowsAfter) * ROW_STEP,
          }}
        >
          {items}
        </div>
      </div>
    );
  }
  const [start, end] = visibleWindow(view.left, view.width, CARD_STEP, count);
  const items: ReactNode[] = [];
  for (let i = start; i < end; i++) items.push(render(i));
  return (
    <div className="library-items" ref={ref} onScroll={measure}>
      {start > 0 && <div style={{ flex: `0 0 ${start * CARD_STEP - 8}px` }} />}
      {items}
      {end < count && <div style={{ flex: `0 0 ${(count - end) * CARD_STEP - 8}px` }} />}
    </div>
  );
}

export function Library({ museum: m, selectedId, bigAudio, busy, readOnly, randomHang, onSelect, onFiles, onDelete, onToggleRandom }: Props) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [over, setOver] = useState<Section | null>(null);
  const [tab, setTab] = useState<Section>(() => {
    try {
      return parseTab(localStorage.getItem(TAB_STORAGE_KEY));
    } catch {
      return 'image';
    }
  });
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const chooseTab = (t: Section) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, t);
    } catch {
      /* storage unavailable: the tab just is not remembered */
    }
  };
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<HungFilter>('all');
  const hung = useMemo(() => hungIds(m), [m.works]);
  const counts = useMemo(() => paintingCounts(m), [m.media, m.works]);
  const paintings = useMemo(() => filterPaintings(m, query, filter), [m.media, m.works, query, filter]);
  const others = useMemo(() => ({
    texture: m.media.filter((x) => x.kind === 'texture'),
    audio: m.media.filter((x) => x.kind === 'audio'),
  }), [m.media]);

  useEffect(() => () => audio.current?.pause(), []);

  // A texture or audio item selected from elsewhere brings its tab to the front.
  useEffect(() => {
    const kind = selectedId ? m.media.find((x) => x.id === selectedId)?.kind : undefined;
    if (kind && kind !== tab) chooseTab(kind);
  }, [selectedId]);

  const toggle = (id: string, file: string) => {
    if (playing === id) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    audio.current?.pause();
    const a = new Audio(`./museum/${file}`);
    a.onended = () => setPlaying(null);
    a.onerror = () => setPlaying(null);
    audio.current = a;
    void a.play().catch(() => setPlaying(null));
    setPlaying(id);
  };

  const card = (it: MediaItem) => {
    const used = it.kind === 'image' ? (hung.has(it.id) ? 1 : 0) : mediaUsage(m, it.id);
    const meta =
      it.kind === 'image' ? `${it.width}×${it.height} · ${hung.has(it.id) ? 'hung' : 'unhung'}`
      : it.kind === 'texture' ? `${it.width}×${it.height} · used ${used}×`
      : `used ${used}×`;
    return (
      <div key={it.id} className={'card' + (selectedId === it.id ? ' selected' : '')} onClick={() => onSelect(it.id === selectedId ? null : it.id)}>
        <div className="card-thumb">
          {it.kind !== 'audio' ? (
            <img src={`./museum/${it.file}`} alt="" loading="lazy" decoding="async" draggable={false} />
          ) : (
            <button
              className={'play' + (playing === it.id ? ' on' : '')}
              title={playing === it.id ? 'Stop' : 'Play'}
              onClick={(e) => {
                e.stopPropagation();
                toggle(it.id, it.file);
              }}
            >
              {playing === it.id ? '■' : '▶'}
            </button>
          )}
        </div>
        <div className="card-name" title={it.kind === 'image' ? it.title || it.name : it.name}>{it.kind === 'image' ? it.title || it.name : it.name}</div>
        <div className="card-meta">
          <span>{meta}</span>
          <button
            className="link"
            disabled={used > 0 || readOnly}
            title={used > 0 ? 'In use: remove it from the museum first' : 'Delete this file'}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(it.id);
            }}
          >
            Delete
          </button>
        </div>
        {bigAudio.has(it.id) && <div className="card-warn">Large file (&gt; 15 MB): slow to load on a headset</div>}
      </div>
    );
  };

  const drop = (section: Section) => ({
    onDragOver: (e: DragEvent) => {
      if (readOnly || !e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
      setOver(section);
    },
    onDragLeave: () => setOver((o) => (o === section ? null : o)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setOver(null);
      if (!readOnly) onFiles([...e.dataTransfer.files], section);
    },
  });

  return (
    <div className="library">
      <div className="lib-tabs" role="tablist" aria-label="Media library">
        {SECTIONS.map((sec) => {
          const n = sec.section === 'image' ? counts.total : others[sec.section].length;
          return (
            <button
              key={sec.section}
              id={`lib-tab-${sec.section}`}
              ref={(el) => { tabRefs.current[sec.section] = el; }}
              role="tab"
              aria-selected={tab === sec.section}
              aria-controls={`lib-panel-${sec.section}`}
              tabIndex={tab === sec.section ? 0 : -1}
              className={'lib-tab' + (tab === sec.section ? ' active' : '')}
              onClick={() => chooseTab(sec.section)}
              onKeyDown={(e) => {
                const next = tabForKey(sec.section, e.key);
                if (!next) return;
                e.preventDefault();
                chooseTab(next);
                tabRefs.current[next]?.focus();
              }}
            >
              {sec.title} <span className="lib-tab-count">{n}</span>
            </button>
          );
        })}
      </div>
      {SECTIONS.map((sec) => (
        <div
          key={sec.section}
          id={`lib-panel-${sec.section}`}
          role="tabpanel"
          aria-labelledby={`lib-tab-${sec.section}`}
          hidden={tab !== sec.section}
          className={'lib-section' + (over === sec.section ? ' over' : '')}
          {...drop(sec.section)}
        >
          <div className="library-head">
            <label className={'btn small' + (readOnly ? ' disabled' : '')}>
              Add…
              <input
                type="file"
                multiple
                hidden
                disabled={readOnly}
                accept={sec.accept}
                onChange={(e) => {
                  onFiles([...(e.target.files ?? [])], sec.section);
                  e.target.value = '';
                }}
              />
            </label>
            {sec.section === 'image' && (
              <button
                className={'small' + (randomHang ? ' active' : '')}
                title="Hang a random painting on each click (unhung ones first)"
                onClick={onToggleRandom}
              >
                Random painting
              </button>
            )}
            {sec.section === 'image' && busy && <span className="muted">{busy}</span>}
            {sec.section === 'image' && counts.total > 0 && (
              <>
                <span className="muted">{countLabel(counts)}</span>
                <input
                  type="search"
                  className="lib-search"
                  placeholder="Search title, artist, file…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select className="lib-filter" value={filter} onChange={(e) => setFilter(e.target.value as HungFilter)}>
                  <option value="all">All</option>
                  <option value="hung">Hung</option>
                  <option value="unhung">Unhung</option>
                </select>
              </>
            )}
          </div>
          {(() => {
            const list = sec.section === 'image' ? paintings : others[sec.section];
            if (list.length === 0) {
              const filtered = sec.section === 'image' && counts.total > 0;
              return <div className="library-items"><div className="empty">{filtered ? 'No paintings match.' : `${sec.empty} Drop files here.`}</div></div>;
            }
            return <VirtualList count={list.length} render={(i) => card(list[i])} resetKey={sec.section === 'image' ? `${query}|${filter}` : sec.section} />;
          })()}
        </div>
      ))}
    </div>
  );
}
