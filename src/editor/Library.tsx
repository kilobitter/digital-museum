import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { MediaItem, Museum } from '../shared/museum';
import { hungCount, mediaUsage } from './model';

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
  { section: 'image', title: 'Paintings', accept: '.jpg,.jpeg,.png,.webp', empty: 'No paintings yet. Resized to 2048 px.', flex: 3 },
  { section: 'texture', title: 'Textures', accept: '.jpg,.jpeg,.png,.webp', empty: 'No wall textures yet. Resized to 1024 px.', flex: 2 },
  { section: 'audio', title: 'Audio', accept: '.mp3,.m4a,.aac,.ogg,.wav', empty: 'No audio yet.', flex: 2 },
];

export function Library({ museum: m, selectedId, bigAudio, busy, readOnly, randomHang, onSelect, onFiles, onDelete, onToggleRandom }: Props) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [over, setOver] = useState<Section | null>(null);

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
    const used = mediaUsage(m, it.id);
    const meta =
      it.kind === 'image' ? `${it.width}×${it.height} · hung ${hungCount(m, it.id)}×`
      : it.kind === 'texture' ? `${it.width}×${it.height} · used ${used}×`
      : `used ${used}×`;
    return (
      <div key={it.id} className={'card' + (selectedId === it.id ? ' selected' : '')} onClick={() => onSelect(it.id === selectedId ? null : it.id)}>
        <div className="card-thumb">
          {it.kind !== 'audio' ? (
            <img src={`./museum/${it.file}`} alt="" draggable={false} />
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
          </div>
          <div className="library-items">
            {m.media.filter((x) => x.kind === sec.section).map(card)}
            {!m.media.some((x) => x.kind === sec.section) && <div className="empty">{sec.empty} Drop files here.</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
