/** Autosave is only scheduled when there are unsaved changes and no pointer gesture is in progress. */
export function shouldScheduleAutosave(s: { ready: boolean; interacting: boolean; present: unknown; saved: unknown }): boolean {
  return s.ready && !s.interacting && s.present !== s.saved;
}
