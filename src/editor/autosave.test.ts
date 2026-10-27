import { describe, expect, it } from 'vitest';
import { shouldScheduleAutosave } from './autosave';

describe('shouldScheduleAutosave', () => {
  const a = {}, b = {};
  it('schedules when dirty and idle', () => expect(shouldScheduleAutosave({ ready: true, interacting: false, present: a, saved: b })).toBe(true));
  it('not during a gesture', () => expect(shouldScheduleAutosave({ ready: true, interacting: true, present: a, saved: b })).toBe(false));
  it('not when clean or not ready', () => {
    expect(shouldScheduleAutosave({ ready: true, interacting: false, present: a, saved: a })).toBe(false);
    expect(shouldScheduleAutosave({ ready: false, interacting: false, present: a, saved: b })).toBe(false);
  });
});
