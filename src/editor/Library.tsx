import { useEffect, useRef, useState } from 'react';
import type { Museum } from '../shared/museum';
import { mediaUsage } from './model';

interface Props {
  museum: Museum;
  selectedId: string | null;
  bigAudio: ReadonlySet<string>;
  busy: string | null;
  onSelect(id: string | null): void;
  onFiles(files: File[]): void;
  onDelete(id: string): void;
}

export function Library({ museum: m, selectedId, bigAudio, busy, onSelect, onFiles, onDelete }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

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

  return (
    <div className="library">
      <div className="library-head">
        <h3>Media</h3>
        <button onClick={() => input.current?.click()}>Add files…</button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept=".jpg,.jpeg,.png,.webp,.mp3,.m4a,.aac,.ogg,.wav"
          onChange={(e) => {
            onFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <span className="muted">{busy ?? 'Drop images and audio anywhere in the window.'}</span>
      </div>
      <div className="library-items">
        {m.media.length === 0 && <div className="empty">No media yet. Images (resized to 2048 px) and audio can be added here.</div>}
        {m.media.map((it) => {
          const used = mediaUsage(m, it.id);
          return (
            <div key={it.id} className={'card' + (selectedId === it.id ? ' selected' : '')} onClick={() => onSelect(it.id === selectedId ? null : it.id)}>
              <div className="card-thumb">
                {it.kind === 'image' ? (
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
              <div className="card-name" title={it.name}>{it.name}</div>
              <div className="card-meta">
                <span>{it.kind === 'image' ? `${it.width}×${it.height}` : 'audio'} · used {used}×</span>
                <button
                  className="link"
                  disabled={used > 0}
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
        })}
      </div>
    </div>
  );
}
