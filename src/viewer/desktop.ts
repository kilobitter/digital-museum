// Desktop mode: pointer-lock mouse look (drag-look fallback) + WASD with collision.
import type { Player } from './player';
import { setControlsHint } from './ui';

const SPEED = 1.8; // m/s
const SENS = 0.0022;
const MAX_PITCH = (85 * Math.PI) / 180;

export class DesktopControls {
  active = false;
  private keys = new Set<string>();
  private pitch = 0;
  private dragging = false;
  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.active) return;
    this.keys.add(e.code);
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onBlur = () => this.keys.clear();

  constructor(
    private player: Player,
    private dom: HTMLElement,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    dom.addEventListener('mousedown', (e) => {
      if (!this.active || e.button !== 0) return;
      if (document.pointerLockElement !== dom) this.requestLock();
      this.dragging = true;
    });
    window.addEventListener('mouseup', () => (this.dragging = false));
    window.addEventListener('mousemove', (e) => {
      if (!this.active) return;
      if (document.pointerLockElement === dom || this.dragging) this.look(e.movementX, e.movementY);
    });
    document.addEventListener('pointerlockchange', () => {
      if (this.active) setControlsHint(this.hint());
    });
  }

  private hint(): string {
    return document.pointerLockElement === this.dom
      ? 'WASD / arrows: move · mouse: look · Esc: release mouse'
      : 'Click to look around · WASD / arrows: move';
  }

  private requestLock(): void {
    try {
      const r = this.dom.requestPointerLock() as unknown as Promise<void> | undefined;
      r?.catch?.(() => {}); // drag-look still works if the lock is refused
    } catch {
      /* drag-look fallback */
    }
  }

  start(): void {
    this.active = true;
    this.player.resetDesktopCamera();
    this.pitch = 0;
    this.requestLock();
    setControlsHint(this.hint());
  }

  stop(): void {
    this.active = false;
    this.keys.clear();
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
    setControlsHint(null);
  }

  private look(dx: number, dy: number): void {
    this.player.rig.rotation.y -= dx * SENS;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - dy * SENS));
    this.player.camera.rotation.set(this.pitch, 0, 0);
  }

  update(dt: number): void {
    if (!this.active) return;
    const k = this.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    if (!f && !r) return;
    const len = Math.hypot(f, r);
    const speed = SPEED * (k.has('ShiftLeft') || k.has('ShiftRight') ? 1.8 : 1);
    const yaw = this.player.rig.rotation.y;
    // forward = (-sin yaw, -cos yaw) in (x, z); right = (cos yaw, -sin yaw)
    const dx = (-Math.sin(yaw) * f + Math.cos(yaw) * r) / len;
    const dz = (-Math.cos(yaw) * f - Math.sin(yaw) * r) / len;
    this.player.moveBy({ x: dx * speed * dt, y: dz * speed * dt });
  }
}
