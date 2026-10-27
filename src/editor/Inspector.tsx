import type { Museum } from '../shared/museum';
import { wallLength } from '../shared/geometry';
import {
  coincidentEndpoints, deleteWall, deleteWork, deleteZone, findWall, findWork, findZone, flipWork, imageHeight, moveEndpoints, round4,
  setSpawn, setWorkT, setWorkWidth, updateSettings, updateWork, updateZone,
} from './model';
import { Field, NumField } from './fields';
import type { Selection } from './types';

interface Props {
  museum: Museum;
  selection: Selection;
  /** `key` coalesces consecutive edits of the same field into one undo step. */
  onChange(m: Museum, key?: string): void;
  onDeleted(): void;
}

export function Inspector({ museum: m, selection, onChange, onDeleted }: Props) {
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
        {del((x) => deleteWall(x, w.id))}
      </section>
    );
  }

  if (selection?.type === 'work') {
    const w = findWork(m, selection.id);
    if (!w) return null;
    const k = (f: string) => `${w.id}.${f}`;
    const images = m.media.filter((x) => x.kind === 'image');
    const media = m.media.find((x) => x.id === w.mediaId);
    return (
      <section className="panel">
        <h3>Work <span className="muted">{imageHeight(m, w).toFixed(2)} m tall</span></h3>
        {media && <img className="inspector-thumb" src={`./museum/${media.file}`} alt="" />}
        <Field label="Image">
          <select value={w.mediaId} onChange={(e) => onChange(updateWork(m, w.id, { mediaId: e.target.value }))}>
            {images.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </Field>
        <Field label="Title"><input type="text" value={w.title} onChange={(e) => onChange(updateWork(m, w.id, { title: e.target.value }), k('title'))} /></Field>
        <Field label="Artist"><input type="text" value={w.artist} onChange={(e) => onChange(updateWork(m, w.id, { artist: e.target.value }), k('artist'))} /></Field>
        <Field label="Description">
          <textarea rows={3} value={w.description ?? ''} onChange={(e) => onChange(updateWork(m, w.id, { description: e.target.value === '' ? undefined : e.target.value }), k('desc'))} />
        </Field>
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

  return null;
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
      <p className="hint">Facing 0° looks up the blueprint, 90° to the right.</p>
    </details>
  );
}
