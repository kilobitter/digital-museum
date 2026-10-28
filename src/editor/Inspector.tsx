import { useState } from 'react';
import type { MediaItem, Museum, Sky, Wall, WallFinish, WallSide } from '../shared/museum';
import { defaultSky } from '../shared/validate';
import { wallLength } from '../shared/geometry';
import {
  coincidentEndpoints, deleteWall, fillLayout, fillWall, deleteWork, deleteZone, findMedia, findWall, findWork, findZone, flipWork, hungCount, imageHeight,
  moveEndpoints, pickRandomPainting, round4, setSpawn, setWallFinish, setWorkT, setWorkWidth, updateMedia, updateSettings, updateWork,
  updateZone,
} from './model';
import { Field, NumField } from './fields';
import { ceilingModeOf, deleteArea, findArea, reorderArea, setAreaRect, setCeilingMode, updateArea, type CeilingMode, type Reorder } from './areaModel';
import type { Selection } from './types';

interface Props {
  museum: Museum;
  mediaUrl(file: string): string | undefined;
  selection: Selection;
  /** Painting selected in the library; shown when nothing is selected on the blueprint. */
  selectedMediaId: string | null;
  /** `key` coalesces consecutive edits of the same field into one undo step. */
  onChange(m: Museum, key?: string): void;
  onDeleted(): void;
  /** Duplicate the selection (areas: same path as Ctrl/Cmd+D). */
  onDuplicate?(): void;
}

const title = (x: MediaItem) => x.title || x.name;

/** Colour, texture and tile size of a wall finish. */
export function FinishFields({ finish, museum: m, keyPrefix, onChange }: { finish: WallFinish; museum: Museum; keyPrefix: string; onChange(f: WallFinish, key: string): void }) {
  const textures = m.media.filter((x) => x.kind === 'texture');
  const missing = finish.textureId !== undefined && !textures.some((t) => t.id === finish.textureId);
  const set = (patch: Partial<WallFinish>, key: string) => {
    const next = { ...finish, ...patch };
    if (next.textureId === undefined) delete next.textureId;
    onChange(next, `${keyPrefix}.${key}`);
  };
  return (
    <>
      <Field label="Texture">
        <select value={finish.textureId ?? ''} onChange={(e) => set({ textureId: e.target.value || undefined }, 'tex')}>
          <option value="">(none, plain colour)</option>
          {missing && <option value={finish.textureId}>(missing)</option>}
          {textures.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>
      <div className="grid2">
        <Field label={finish.textureId ? 'Tint' : 'Colour'}>
          <input type="color" className="colour" value={finish.color} onChange={(e) => set({ color: e.target.value }, 'color')} />
        </Field>
        <Field label="Tile size"><NumField value={finish.tileSize} min={0} exclusiveMin step={0.1} onChange={(v) => set({ tileSize: v }, 'tile')} unit="m" /></Field>
      </div>
    </>
  );
}

/** Title / artist / description of a painting (stored on the media item). */
function LabelFields({ museum: m, media, onChange }: { museum: Museum; media: MediaItem; onChange: Props['onChange'] }) {
  const k = (f: string) => `${media.id}.${f}`;
  return (
    <>
      <Field label="Title"><input type="text" value={media.title ?? ''} onChange={(e) => onChange(updateMedia(m, media.id, { title: e.target.value }), k('title'))} /></Field>
      <Field label="Artist"><input type="text" value={media.artist ?? ''} onChange={(e) => onChange(updateMedia(m, media.id, { artist: e.target.value }), k('artist'))} /></Field>
      <Field label="Description">
        <textarea rows={3} value={media.description ?? ''} onChange={(e) => onChange(updateMedia(m, media.id, { description: e.target.value }), k('desc'))} />
      </Field>
    </>
  );
}

/** "Fill face with random paintings": one undo step; refuses when the face already has works. */
function FillWallPanel({ museum: m, wall, onChange }: { museum: Museum; wall: Wall; onChange: Props['onChange'] }) {
  const [side, setSide] = useState<WallSide>(1);
  const [width, setWidth] = useState(1.2);
  const [gap, setGap] = useState(0.6);
  const [height, setHeight] = useState(1.5);
  const [msg, setMsg] = useState<string | null>(null);
  const fits = fillLayout(wallLength(wall), width, gap).length;
  const existing = m.works.filter((w) => w.wallId === wall.id && w.side === side).length;
  return (
    <details className="finish">
      <summary>Fill face with random paintings</summary>
      <div className="grid2">
        <Field label="Face">
          <select value={side} onChange={(e) => { setSide(Number(e.target.value) as WallSide); setMsg(null); }}>
            <option value={1}>Side +</option>
            <option value={-1}>Side −</option>
          </select>
        </Field>
        <Field label="Painting width"><NumField value={width} min={0} exclusiveMin onChange={setWidth} unit="m" /></Field>
        <Field label="Gap"><NumField value={gap} min={0} onChange={setGap} unit="m" /></Field>
        <Field label="Centre height"><NumField value={height} onChange={setHeight} unit="m" /></Field>
      </div>
      <p className="hint">
        {existing > 0 ? `This face already has ${existing} work(s): remove them first.` : `${fits} painting${fits === 1 ? '' : 's'} fit. Unhung paintings are used first.`}
      </p>
      <button
        disabled={existing > 0 || fits === 0}
        onClick={() => {
          const r = fillWall(m, wall.id, { side, width, gap, centerHeight: height }, Math.random);
          if (r.ok) { onChange(r.museum); setMsg(`Hung ${r.count} painting${r.count === 1 ? '' : 's'}.`); }
          else setMsg(r.reason);
        }}
      >
        Fill face
      </button>
      {msg && <p className="hint">{msg}</p>}
    </details>
  );
}

export function Inspector({ museum: m, mediaUrl, selection, selectedMediaId, onChange, onDeleted, onDuplicate }: Props) {
  const del = (fn: (m: Museum) => Museum) => (
    <button
      className="danger"
      onClick={() => {
        onChange(fn(m));
        onDeleted();
      }}
    >
      Delete
    </button>
  );

  if (selection?.type === 'wall') {
    const w = findWall(m, selection.id);
    if (!w) return null;
    const setEnd = (end: 'a' | 'b', axis: 'x' | 'y', v: number) => {
      const to = { ...w[end], [axis]: v };
      onChange(moveEndpoints(m, coincidentEndpoints(m, w.id, end), to), `${w.id}.${end}${axis}`);
    };
    return (
      <section className="panel">
        <h3>Wall <span className="muted">{wallLength(w).toFixed(2)} m</span></h3>
        <div className="grid2">
          <Field label="A x"><NumField value={w.a.x} onChange={(v) => setEnd('a', 'x', v)} unit="m" /></Field>
          <Field label="A y"><NumField value={w.a.y} onChange={(v) => setEnd('a', 'y', v)} unit="m" /></Field>
          <Field label="B x"><NumField value={w.b.x} onChange={(v) => setEnd('b', 'x', v)} unit="m" /></Field>
          <Field label="B y"><NumField value={w.b.y} onChange={(v) => setEnd('b', 'y', v)} unit="m" /></Field>
        </div>
        <p className="hint">Joined corners move together.</p>
        <div className="finish">
          <label className="check">
            <input
              type="checkbox"
              checked={w.finish === undefined}
              onChange={(e) => onChange(setWallFinish(m, w.id, e.target.checked ? undefined : { ...m.settings.wallFinish }))}
            />
            Use default finish
          </label>
          {w.finish && <FinishFields finish={w.finish} museum={m} keyPrefix={`${w.id}.finish`} onChange={(f, key) => onChange(setWallFinish(m, w.id, f), key)} />}
        </div>
        <FillWallPanel museum={m} wall={w} onChange={onChange} />
        {del((x) => deleteWall(x, w.id))}
      </section>
    );
  }

  if (selection?.type === 'work') {
    const w = findWork(m, selection.id);
    if (!w) return null;
    const k = (f: string) => `${w.id}.${f}`;
    const images = m.media.filter((x) => x.kind === 'image');
    const media = findMedia(m, w.mediaId);
    const sharedBy = hungCount(m, w.mediaId);
    return (
      <section className="panel">
        <h3>Work <span className="muted">{imageHeight(m, w).toFixed(2)} m tall</span></h3>
        {media && <img className="inspector-thumb" src={mediaUrl(media.file)} alt="" />}
        <Field label="Painting">
          <select value={w.mediaId} onChange={(e) => onChange(updateWork(m, w.id, { mediaId: e.target.value }))}>
            {images.map((i) => <option key={i.id} value={i.id}>{title(i)}</option>)}
          </select>
        </Field>
        <div className="row">
          <button
            title="Swap for a random painting (unhung ones first)"
            onClick={() => {
              const pick = pickRandomPainting(m, Math.random, w.mediaId);
              if (pick && pick.id !== w.mediaId) onChange(updateWork(m, w.id, { mediaId: pick.id }));
            }}
          >
            Pick another
          </button>
          {sharedBy > 1 && <span className="hint">shared by {sharedBy} works</span>}
        </div>
        {media && <LabelFields museum={m} media={media} onChange={onChange} />}
        <div className="grid2">
          <Field label="Width"><NumField value={w.width} min={0} exclusiveMin onChange={(v) => onChange(setWorkWidth(m, w.id, v), k('width'))} unit="m" /></Field>
          <Field label="Centre height"><NumField value={w.centerHeight} onChange={(v) => onChange(updateWork(m, w.id, { centerHeight: v }), k('h'))} unit="m" /></Field>
          <Field label="Position (t)"><NumField value={w.t} min={0} onChange={(v) => onChange(setWorkT(m, w.id, v), k('t'))} unit="m" /></Field>
          <Field label="Face">
            <button onClick={() => onChange(flipWork(m, w.id))}>{w.side === 1 ? 'Side +  (flip)' : 'Side −  (flip)'}</button>
          </Field>
        </div>
        {del((x) => deleteWork(x, w.id))}
      </section>
    );
  }

  if (selection?.type === 'zone') {
    const z = findZone(m, selection.id);
    if (!z) return null;
    const k = (f: string) => `${z.id}.${f}`;
    const audio = m.media.filter((x) => x.kind === 'audio');
    const sh = z.shape;
    const setShape = (patch: Record<string, number>) => onChange(updateZone(m, z.id, { shape: { ...sh, ...patch } as typeof sh }), k('shape'));
    return (
      <section className="panel">
        <h3>Audio zone</h3>
        <Field label="Name"><input type="text" value={z.name} onChange={(e) => onChange(updateZone(m, z.id, { name: e.target.value }), k('name'))} /></Field>
        <Field label="Audio">
          <select value={z.mediaId} onChange={(e) => onChange(updateZone(m, z.id, { mediaId: e.target.value }))}>
            {!audio.some((a) => a.id === z.mediaId) && <option value={z.mediaId}>(missing)</option>}
            {audio.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <div className="grid2">
          <Field label="Volume"><NumField value={z.volume} min={0} max={1} step={0.05} onChange={(v) => onChange(updateZone(m, z.id, { volume: v }), k('vol'))} /></Field>
          <Field label="Fade"><NumField value={z.fade} min={0} onChange={(v) => onChange(updateZone(m, z.id, { fade: v }), k('fade'))} unit="m" /></Field>
          {sh.kind === 'rect' ? (
            <>
              <Field label="x"><NumField value={sh.x} onChange={(v) => setShape({ x: v })} unit="m" /></Field>
              <Field label="y"><NumField value={sh.y} onChange={(v) => setShape({ y: v })} unit="m" /></Field>
              <Field label="Width"><NumField value={sh.w} min={0} exclusiveMin onChange={(v) => setShape({ w: v })} unit="m" /></Field>
              <Field label="Height"><NumField value={sh.h} min={0} exclusiveMin onChange={(v) => setShape({ h: v })} unit="m" /></Field>
            </>
          ) : (
            <>
              <Field label="Centre x"><NumField value={sh.cx} onChange={(v) => setShape({ cx: v })} unit="m" /></Field>
              <Field label="Centre y"><NumField value={sh.cy} onChange={(v) => setShape({ cy: v })} unit="m" /></Field>
              <Field label="Radius"><NumField value={sh.r} min={0} exclusiveMin onChange={(v) => setShape({ r: v })} unit="m" /></Field>
            </>
          )}
        </div>
        <p className="hint">Gain is 0 at the edge and reaches the volume {z.fade} m inside.</p>
        {del((x) => deleteZone(x, z.id))}
      </section>
    );
  }

  if (selection?.type === 'area') {
    const a = findArea(m, selection.id);
    if (!a) return null;
    const k = (f: string) => `${a.id}.${f}`;
    const idx = m.areas.findIndex((x) => x.id === a.id);
    const last = m.areas.length - 1;
    const order = (how: Reorder) => onChange(reorderArea(m, a.id, how));
    const floorOnlyHere = a.ceiling === undefined && !a.openSky;
    const floorRow = (
      <div className="finish">
        <label className="check">
          <input
            type="checkbox"
            checked={a.floor !== undefined}
            disabled={a.floor !== undefined && floorOnlyHere}
            title={a.floor !== undefined && floorOnlyHere ? 'An area needs a floor finish, a ceiling finish or open sky' : ''}
            onChange={(e) => onChange(updateArea(m, a.id, { floor: e.target.checked ? { ...m.settings.floorFinish } : undefined }))}
          />
          Floor
        </label>
        {a.floor && <FinishFields finish={a.floor} museum={m} keyPrefix={k('floor')} onChange={(nf, key) => onChange(updateArea(m, a.id, { floor: nf }), key)} />}
      </div>
    );
    const mode = ceilingModeOf(a);
    const modes: { mode: CeilingMode; label: string; title: string }[] = [
      { mode: 'none', label: 'None', title: a.floor ? "This area doesn't change the ceiling" : 'An area without a floor needs a ceiling finish or open sky' },
      { mode: 'finish', label: 'Finish', title: 'Give the ceiling above this area its own finish' },
      { mode: 'open', label: 'Open sky', title: 'No ceiling here: the sky shows' },
    ];
    const ceilingRow = (
      <div className="finish">
        <div className="field-label">Ceiling</div>
        <div className="seg" role="radiogroup" aria-label="Ceiling of this area">
          {modes.map((o) => (
            <button
              key={o.mode}
              role="radio"
              aria-checked={mode === o.mode}
              className={'small' + (mode === o.mode ? ' active' : '')}
              disabled={o.mode === 'none' && !a.floor}
              title={o.title}
              onClick={() => onChange(setCeilingMode(m, a.id, o.mode, m.settings.ceilingFinish))}
            >
              {o.label}
            </button>
          ))}
        </div>
        {a.ceiling && <FinishFields finish={a.ceiling} museum={m} keyPrefix={k('ceiling')} onChange={(nf, key) => onChange(updateArea(m, a.id, { ceiling: nf }), key)} />}
      </div>
    );
    return (
      <section className="panel">
        <h3>Area <span className="muted">layer {idx + 1} of {m.areas.length}</span></h3>
        <Field label="Name"><input type="text" value={a.name} onChange={(e) => onChange(updateArea(m, a.id, { name: e.target.value }), k('name'))} /></Field>
        <div className="grid2">
          <Field label="x"><NumField value={a.rect.x} onChange={(v) => onChange(setAreaRect(m, a.id, { x: v }), k('x'))} unit="m" /></Field>
          <Field label="y"><NumField value={a.rect.y} onChange={(v) => onChange(setAreaRect(m, a.id, { y: v }), k('y'))} unit="m" /></Field>
          <Field label="Width"><NumField value={a.rect.w} min={0} exclusiveMin onChange={(v) => onChange(setAreaRect(m, a.id, { w: v }), k('w'))} unit="m" /></Field>
          <Field label="Height"><NumField value={a.rect.h} min={0} exclusiveMin onChange={(v) => onChange(setAreaRect(m, a.id, { h: v }), k('h'))} unit="m" /></Field>
        </div>
        {floorRow}
        {ceilingRow}
        {!m.settings.ceiling && mode !== 'none' && <p className="hint">The museum has no ceiling (see settings), so ceiling settings are not shown.</p>}
        {mode === 'open' && <p className="hint">Open sky removes the ceiling in this rectangle, where this area is on top of the stack.</p>}
        <div className="row stack-buttons">
          <button disabled={idx >= last} onClick={() => order('forward')} title="One step up the stack">Bring forward</button>
          <button disabled={idx <= 0} onClick={() => order('backward')} title="One step down the stack">Send backward</button>
          <button disabled={idx >= last} onClick={() => order('front')}>To front</button>
          <button disabled={idx <= 0} onClick={() => order('back')}>To back</button>
        </div>
        <p className="hint">Later areas are drawn on top of earlier ones.</p>
        <div className="row">
          <button
            onClick={() => onDuplicate?.()}
            title="Ctrl/Cmd+D"
          >
            Duplicate
          </button>
          {del((x) => deleteArea(x, a.id))}
        </div>
      </section>
    );
  }

  const media = selectedMediaId ? findMedia(m, selectedMediaId) : undefined;
  if (media?.kind === 'image') {
    const n = hungCount(m, media.id);
    return (
      <section className="panel">
        <h3>Painting <span className="muted">{media.width}×{media.height} px</span></h3>
        <img className="inspector-thumb" src={mediaUrl(media.file)} alt="" />
        <LabelFields museum={m} media={media} onChange={onChange} />
        <p className="hint">Hung {n}×. Labels belong to the painting and show wherever it hangs.</p>
      </section>
    );
  }

  return null;
}

/** Sky: a three-colour gradient or an equirectangular panorama. */
function SkyFields({ museum: m, onChange }: { museum: Museum; onChange(m: Museum, key?: string): void }) {
  const sky = m.settings.sky;
  const panos = m.media.filter((x) => x.kind === 'panorama');
  const setSky = (next: Sky, key?: string) => onChange(updateSettings(m, { sky: next }), key);
  const grad = sky.kind === 'gradient' ? sky : defaultSky() as Extract<Sky, { kind: 'gradient' }>;
  const missing = sky.kind === 'panorama' && !panos.some((p) => p.id === sky.textureId);
  return (
    <>
      <h3 className="subhead">Sky</h3>
      <Field label="Type">
        <select
          value={sky.kind}
          onChange={(e) =>
            setSky(
              e.target.value === 'panorama'
                ? { kind: 'panorama', textureId: panos[0]?.id ?? '', rotationDeg: 0 }
                : { ...grad, kind: 'gradient' },
            )
          }
        >
          <option value="gradient">Gradient</option>
          <option value="panorama" disabled={panos.length === 0}>Panorama{panos.length === 0 ? ' (add one in the Panoramas tab)' : ''}</option>
        </select>
      </Field>
      {sky.kind === 'gradient' ? (
        <>
          <div className="sky-strip" aria-hidden="true" style={{ background: `linear-gradient(to bottom, ${sky.top}, ${sky.horizon} 50%, ${sky.bottom})` }} />
          <div className="grid2">
            {(['top', 'horizon', 'bottom'] as const).map((k) => (
              <Field key={k} label={k[0].toUpperCase() + k.slice(1)}>
                <input type="color" className="colour" value={sky[k]} onChange={(e) => setSky({ ...sky, [k]: e.target.value }, `s.sky.${k}`)} />
              </Field>
            ))}
          </div>
        </>
      ) : (
        <>
          <Field label="Panorama">
            <select value={sky.textureId} onChange={(e) => setSky({ ...sky, textureId: e.target.value })}>
              {(missing || sky.textureId === '') && <option value={sky.textureId}>(missing)</option>}
              {panos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Rotation">
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={sky.rotationDeg}
              onChange={(e) => setSky({ ...sky, rotationDeg: Number(e.target.value) }, 's.sky.rot')}
            />
          </Field>
          <Field label="Rotation (°)">
            <NumField value={sky.rotationDeg} min={-180} max={180} step={5} onChange={(v) => setSky({ ...sky, rotationDeg: v }, 's.sky.rot')} unit="°" />
          </Field>
          <p className="hint">Turns the image clockwise seen from above; 0° puts the image centre straight up the blueprint.</p>
        </>
      )}
    </>
  );
}

export function SettingsPanel({ museum: m, onChange }: { museum: Museum; onChange(m: Museum, key?: string): void }) {
  const s = m.settings;
  return (
    <details className="panel" open>
      <summary><h3>Museum settings</h3></summary>
      <Field label="Name"><input type="text" value={m.name} onChange={(e) => onChange({ ...m, name: e.target.value }, 'museum.name')} /></Field>
      <div className="grid2">
        <Field label="Wall height"><NumField value={s.wallHeight} min={0} exclusiveMin onChange={(v) => onChange(updateSettings(m, { wallHeight: v }), 's.wh')} unit="m" /></Field>
        <Field label="Wall thickness"><NumField value={s.wallThickness} min={0} exclusiveMin step={0.05} onChange={(v) => onChange(updateSettings(m, { wallThickness: v }), 's.wt')} unit="m" /></Field>
        <Field label="Grid"><NumField value={s.gridSize} min={0.05} step={0.05} onChange={(v) => onChange(updateSettings(m, { gridSize: v }), 's.grid')} unit="m" /></Field>
        <Field label="Ceiling">
          <input type="checkbox" checked={s.ceiling} onChange={(e) => onChange(updateSettings(m, { ceiling: e.target.checked }))} />
        </Field>
        <Field label="Spawn x"><NumField value={s.spawn.x} onChange={(v) => onChange(setSpawn(m, { x: v }), 's.sx')} unit="m" /></Field>
        <Field label="Spawn y"><NumField value={s.spawn.y} onChange={(v) => onChange(setSpawn(m, { y: v }), 's.sy')} unit="m" /></Field>
        <Field label="Facing"><NumField value={round4(s.spawn.yawDeg)} step={5} onChange={(v) => onChange(setSpawn(m, { yawDeg: v }), 's.yaw')} unit="°" /></Field>
      </div>
      <h3 className="subhead">Default wall finish</h3>
      <FinishFields finish={s.wallFinish} museum={m} keyPrefix="s.finish" onChange={(f, key) => onChange(updateSettings(m, { wallFinish: f }), key)} />
      <h3 className="subhead">Default floor finish</h3>
      <FinishFields finish={s.floorFinish} museum={m} keyPrefix="s.floor" onChange={(f, key) => onChange(updateSettings(m, { floorFinish: f }), key)} />
      <h3 className="subhead">Default ceiling finish</h3>
      <FinishFields finish={s.ceilingFinish} museum={m} keyPrefix="s.ceil" onChange={(f, key) => onChange(updateSettings(m, { ceilingFinish: f }), key)} />
      {!s.ceiling && <p className="hint">The ceiling is switched off, so its finish is not shown.</p>}
      <SkyFields museum={m} onChange={onChange} />
      <p className="hint">Facing 0° looks up the blueprint, 90° to the right.</p>
    </details>
  );
}
