// The "Check museum" results: what would go wrong for visitors, grouped by severity. Shows a report; never recomputes itself.
import type { CheckItem, CheckReport, CheckSeverity } from './museumCheck';

const GROUPS: { severity: CheckSeverity; title: string }[] = [
  { severity: 'problem', title: 'Problems' },
  { severity: 'warning', title: 'Warnings' },
  { severity: 'info', title: 'Notes' },
];
/** The Notes group starts collapsed when it has more items than this (missing artists can be a long list). */
const COLLAPSE_ABOVE = 5;

interface Props {
  report: CheckReport;
  /** The museum has been edited since the report was made. */
  stale: boolean;
  onRun(): void;
  onClose(): void;
  onPick(item: CheckItem): void;
}

function Item({ item, onPick }: { item: CheckItem; onPick(item: CheckItem): void }) {
  const clickable = !!item.target || !!item.at;
  return (
    <li className={'check-' + item.severity}>
      {clickable ? <button className="link" onClick={() => onPick(item)}>{item.message}</button> : item.message}
    </li>
  );
}

export function CheckPanel({ report, stale, onRun, onClose, onPick }: Props) {
  return (
    <div className="error-panel left check-panel" role="region" aria-label="Museum check">
      <div className="row">
        <strong>Check museum</strong>
        <span className="grow" />
        <button className={stale ? 'primary' : ''} onClick={onRun}>Run again</button>
        <button onClick={onClose}>Close</button>
      </div>
      <p className="hint">What a visitor walking from the start point would run into. Walking only: it does not know about teleporting in VR.</p>
      {stale && <p className="check-stale">The museum changed since this check. Run it again to see the current state.</p>}
      {report.items.length === 0 ? (
        <p className="check-clear">
          Nothing found. Checked: rooms and audio zones that cannot be walked to, doorways too narrow to walk through, labels that
          stick out or run into a wall, overlapping paintings and labels, and paintings without an artist.
        </p>
      ) : (
        GROUPS.map(({ severity, title }) => {
          const items = report.items.filter((i) => i.severity === severity);
          if (items.length === 0) return null;
          const list = <ul className="warnings check-list">{items.map((it, i) => <Item key={i} item={it} onPick={onPick} />)}</ul>;
          return (
            <section key={severity} className="check-group">
              {severity === 'info' && items.length > COLLAPSE_ABOVE ? (
                <details>
                  <summary><h4>{title} <span className={'badge ' + severity}>{items.length}</span></h4></summary>
                  {list}
                </details>
              ) : (
                <>
                  <h4>{title} <span className={'badge ' + severity}>{items.length}</span></h4>
                  {list}
                </>
              )}
            </section>
          );
        })
      )}
      <p className="hint">Took {Math.max(1, Math.round(report.ms))} ms.</p>
    </div>
  );
}
