import { useEffect, useRef } from 'react';
import type { Museum } from '../shared/museum';
import { describeSel, selCount, setFinishForWalls, type MultiSel } from './multiSelect';
import { FinishFields } from './Inspector';

interface Props {
  museum: Museum;
  multi: MultiSel;
  includeAreas: boolean;
  onIncludeAreas(v: boolean): void;
  /** `key` coalesces consecutive edits of the same field into one undo step. */
  onChange(m: Museum, key?: string): void;
  onRotate(dir: 1 | -1): void;
  onDuplicate(): void;
  onDelete(): void;
}

/** Inspector for two or more selected items (or a lone area on the Build layer). */
export function MultiInspector({ museum: m, multi, includeAreas, onIncludeAreas, onChange, onRotate, onDuplicate, onDelete }: Props) {
  const walls = m.walls.filter((w) => multi.walls.includes(w.id));
  const allDefault = walls.every((w) => w.finish === undefined);
  const anyDefault = walls.some((w) => w.finish === undefined);
  const mixedDefault = anyDefault && !allDefault;
  const custom = walls.filter((w) => w.finish);
  const base = custom[0]?.finish;
  const differs: string[] = [];
  if (base) {
    if (custom.some((w) => w.finish!.textureId !== base.textureId)) differs.push('texture');
    if (custom.some((w) => w.finish!.color !== base.color)) differs.push('colour');
    if (custom.some((w) => w.finish!.tileSize !== base.tileSize)) differs.push('tile size');
  }
  const ids = walls.map((w) => w.id);
  const keyPrefix = `multi.finish.${ids[0] ?? ''}.${ids.length}`;
  const defaultBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (defaultBox.current) defaultBox.current.indeterminate = mixedDefault;
  }, [mixedDefault]);
  const rotatable = multi.walls.length + multi.zones.length + multi.areas.length > 0 || multi.spawn;

  return (
    <section className="panel">
      <h3>Selection <span className="muted">{selCount(multi)} item{selCount(multi) === 1 ? '' : 's'}</span></h3>
      <p className="multi-summary">{describeSel(multi)}</p>
      <div className="multi-actions">
        <button disabled={!rotatable} onClick={() => onRotate(-1)} title="Rotate counter-clockwise ( [ )">Rotate ⟲</button>
        <button disabled={!rotatable} onClick={() => onRotate(1)} title="Rotate clockwise ( ] )">Rotate ⟳</button>
        <button onClick={onDuplicate} title="Ctrl/Cmd+D">Duplicate</button>
        <button className="danger" onClick={onDelete} title="Delete">Delete</button>
      </div>
      <label className="check">
        <input type="checkbox" checked={includeAreas} onChange={(e) => onIncludeAreas(e.target.checked)} />
        Include areas when box-selecting on the Build layer
      </label>
      {walls.length > 0 && (
        <div className="finish">
          <div className="field-label">Finish of {walls.length} wall{walls.length === 1 ? '' : 's'}</div>
          <label className="check">
            <input
              ref={defaultBox}
              type="checkbox"
              checked={allDefault}
              onChange={(e) => onChange(setFinishForWalls(m, ids, e.target.checked ? undefined : { ...(base ?? m.settings.wallFinish) }), `${keyPrefix}.default`)}
            />
            Use default finish
          </label>
          {mixedDefault && <p className="hint">Mixed: some walls use the default finish, some have their own. Tick to reset all, or edit one below to give all the same finish.</p>}
          {!allDefault && base && (
            <>
              {differs.length > 0 && <p className="hint">Values differ between walls ({differs.join(', ')}); the first one is shown. Changing a value applies it to all.</p>}
              <FinishFields finish={base} museum={m} keyPrefix={keyPrefix} onChange={(f, key) => onChange(setFinishForWalls(m, ids, f), key)} />
            </>
          )}
        </div>
      )}
      <p className="hint">
        Shift+click adds or removes one item. Drag on empty canvas to box-select (Shift adds). Arrow keys nudge by one grid step
        (Shift: five). [ and ] rotate counter-clockwise / clockwise. Ctrl/Cmd+A selects all, Ctrl/Cmd+D duplicates.
        Paintings move and turn with their walls. Walls joined to a moved wall that is not selected detach.
      </p>
    </section>
  );
}
