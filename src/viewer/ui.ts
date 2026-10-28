// Minimal DOM overlay helpers (loading / error / start screens, toast).
const overlay = () => document.getElementById('overlay') as HTMLElement;
const panel = () => document.getElementById('panel') as HTMLElement;

function reset(cls = ''): HTMLElement {
  const p = panel();
  p.className = cls;
  p.replaceChildren();
  overlay().hidden = false;
  return p;
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export function showLoading(text: string): void {
  const p = reset();
  el('h1', 'Loading…', p);
  el('p', text, p);
}

/** Asks the visitor to click before the browser's folder-access prompt can be shown. */
export function showAllowAccess(folderName: string, onClick: () => void): void {
  const p = reset();
  el('h1', 'Allow access to your folder', p);
  el('p', 'Your browser needs your permission to read the museum from your computer. Nothing is uploaded.', p);
  const btns = el('div', undefined, p);
  btns.className = 'btns';
  const b = el('button', `Allow access to ${folderName}`, btns);
  b.className = 'primary';
  b.onclick = onClick;
}

export function showError(title: string, details: string[] = []): void {
  const p = reset('error');
  el('h1', title, p);
  if (details.length) {
    const ul = el('ul', undefined, p);
    for (const d of details) el('li', d, ul);
  }
}

export interface StartOptions {
  name: string;
  warnings: string[];
  xrSupported: boolean;
  onVR: () => void;
  onDesktop: () => void;
  message?: string;
}

export function showStart(o: StartOptions): void {
  const p = reset();
  el('h1', o.name, p);
  el('p', o.xrSupported ? 'Put on your headset or explore from this screen.' : 'Explore from this screen. (VR is not available in this browser.)', p);
  el('p', 'Sound will start when you press a button.', p);
  if (o.message) el('p', o.message, p).style.color = '#f0a0a0';
  if (o.warnings.length) el('p', `${o.warnings.length} media file(s) could not be loaded (see console).`, p).style.color = '#e0c070';
  const btns = el('div', undefined, p);
  btns.className = 'btns';
  if (o.xrSupported) {
    const b = el('button', 'Enter VR', btns);
    b.className = 'primary';
    b.onclick = o.onVR;
  }
  const d = el('button', 'Walk on desktop', btns);
  if (!o.xrSupported) d.className = 'primary';
  d.onclick = o.onDesktop;
}

export function hideOverlay(): void {
  overlay().hidden = true;
}

let toastTimer = 0;
export function toast(text: string, ms = 2500): void {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = text;
  t.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), ms);
}

export function setControlsHint(text: string | null): void {
  const c = document.getElementById('controls');
  if (!c) return;
  c.hidden = text === null;
  c.textContent = text ?? '';
}
