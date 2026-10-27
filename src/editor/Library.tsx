import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { MediaItem, Museum } from '../shared/museum';
import { countLabel, filterPaintings, hungIds, paintingCounts, visibleWindow, type HungFilter } from './libraryFilter';
import { mediaUsage } from './model';

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

const SECTIONS: { section: Section; title: string; accept: string; empty: string; flex: number }[] = [
  { section: 'image', title: 'Paintings', accept: '.jpg,.jpeg,.png,.webp', empty: 'No paintings yet. Resized to 1600 px.', flex: 3 },
  { section: 'texture', title: 'Textures', accept: '.jpg,.jpeg,.png,.webp', empty: 'No wall textures yet. Resized to 1024 px.', flex: 2 },
  { section: 'audio', title: 'Audio', accept: '.mp3,.m4a,.aac,.ogg,.wav', empty: 'No audio yet.', flex: 2 },
];

const CARD_STEP = 158; // card width 150 + gap 8 (see styles.css .card)

/** Horizontal strip that only mounts the cards in (or near) view, so hundreds of items stay cheap. */
function VirtualRow({ count, render, resetKey }: { count: number; render: (i: number) => ReactNode; resetKey: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 1200 });
  const measure = () => {
    const el = ref.current;
    if (el) setView((v) => (v.left === el.scrollLeft && v.width === el.clientWidth ? v : { left: el.scrollLeft, width: el.clientWidth }));
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
    if (ref.current) ref.current.scrollLeft = 0;
    measure();
  }, [resetKey]);
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
      {SECTIONS.map((sec) => (
        <div key={sec.section} className={'lib-section' + (over === sec.section ? ' over' : '')} style={{ flex: sec.flex }} {...drop(sec.section)}>
          <div className="library-head">
            <h3>{sec.title}</h3>
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
            return <VirtualRow count={list.length} render={(i) => card(list[i])} resetKey={sec.section === 'image' ? `${query}|${filter}` : sec.section} />;
          })()}
        </div>
      ))}
    </div>
  );
}
