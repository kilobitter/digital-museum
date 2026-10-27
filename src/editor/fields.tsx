import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">{children}</span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

interface NumProps {
  value: number;
  onChange(v: number): void;
  min?: number;
  max?: number;
  /** Require > min instead of >= min. */
  exclusiveMin?: boolean;
  step?: number;
  unit?: string;
}

const fmt = (n: number) => String(Math.round(n * 1e4) / 1e4);

/** Number input that tolerates half-typed values: only calls onChange for valid numbers in range. */
export function NumField({ value, onChange, min, max, exclusiveMin, step = 0.1, unit }: NumProps) {
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current || Number(text) !== value) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const valid = (n: number) =>
    Number.isFinite(n) && (min === undefined || (exclusiveMin ? n > min : n >= min)) && (max === undefined || n <= max);
  const bad = text.trim() !== '' && !valid(Number(text));
  return (
    <span className="numfield">
      <input
        type="number"
        className={bad ? 'bad' : ''}
        value={text}
        step={step}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setText(fmt(value));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = e.target.value.trim() === '' ? NaN : Number(e.target.value);
          if (valid(n)) onChange(n);
        }}
      />
      {unit && <span className="unit">{unit}</span>}
    </span>
  );
}
