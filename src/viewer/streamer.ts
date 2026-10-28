// Streams painting + label textures in and out around the visitor (see streaming.ts for the policy).
import * as THREE from 'three';
import type { Vec2 } from '../shared/museum';
import { labelTexture, loadTexture, placeholderTexture } from './textures';
import { WORK_OFFSET, type PaintingSlot } from './scene';
import { PAINTING_LIMITS, planStreaming, type StreamLimits } from './streaming';

interface Live {
  group: THREE.Group;
  disposables: { dispose(): void }[];
}

const REPLAN_MOVE = 0.5; // metres of head movement before the plan is recomputed

export class PaintingStreamer {
  private readonly live = new Map<string, Live>();
  private readonly loading = new Set<string>();
  /** Current request token per in-flight id; a request whose token was dropped or replaced is discarded. */
  private readonly tokens = new Map<string, number>();
  private seq = 0;
  private readonly resident = new Set<string>();
  private readonly byId: Map<string, PaintingSlot>;
  private placeholder: THREE.Texture | null = null;
  private lastPlanned: Vec2 | null = null;
  private lastHead: Vec2 = { x: 0, y: 0 };
  private idleWaiters: (() => void)[] = [];
  private onSettled: (() => void) | null = null;
  readonly warnings: string[] = [];

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly slots: readonly PaintingSlot[],
    private readonly urlFor: (file: string) => string,
    private readonly anisotropy: number,
    private readonly limits: StreamLimits = PAINTING_LIMITS,
  ) {
    this.byId = new Map(slots.map((s) => [s.id, s]));
  }

  get residentCount(): number {
    return this.resident.size;
  }

  /** Per-frame hook: replans only after the head has moved a little. */
  update(head: Vec2): void {
    this.lastHead = head;
    if (this.lastPlanned && Math.hypot(head.x - this.lastPlanned.x, head.y - this.lastPlanned.y) < REPLAN_MOVE) return;
    this.replan();
  }

  /** Load everything wanted around `head` and resolve when it is all in (used before the start screen). */
  async prime(head: Vec2, onProgress?: (done: number, total: number) => void): Promise<void> {
    this.lastHead = head;
    const probe = planStreaming(head, this.slots, this.resident, this.loading, { ...this.limits, maxConcurrent: Infinity });
    const total = probe.load.length;
    let done = 0;
    this.onSettled = () => onProgress?.(Math.min(++done, total), total);
    onProgress?.(0, total);
    this.replan();
    if (this.loading.size > 0) await new Promise<void>((res) => this.idleWaiters.push(res));
    this.onSettled = null;
  }

  private replan(): void {
    this.lastPlanned = { ...this.lastHead };
    const plan = planStreaming(this.lastHead, this.slots, this.resident, this.loading, this.limits);
    for (const id of plan.unload) this.release(id);
    for (const id of plan.load) void this.start(id);
    if (this.loading.size === 0 && plan.load.length === 0) this.flushIdle();
  }

  private flushIdle(): void {
    const w = this.idleWaiters;
    this.idleWaiters = [];
    for (const f of w) f();
  }

  private async start(id: string): Promise<void> {
    const slot = this.byId.get(id);
    if (!slot) return;
    const token = ++this.seq;
    this.tokens.set(id, token);
    this.loading.add(id);
    let tex: THREE.Texture | null = null;
    let missing = false;
    try {
      tex = await loadTexture(this.urlFor(slot.media.file), this.anisotropy);
    } catch (e) {
      missing = true;
      const msg = `image '${slot.media.file}' for work '${slot.media.title || slot.id}' could not be loaded: ${String(e)}`;
      if (!this.warnings.includes(msg)) {
        console.warn('[museum]', msg);
        this.warnings.push(msg);
      }
    }
    const current = this.tokens.get(id) === token;
    if (current) {
      this.tokens.delete(id);
      this.loading.delete(id);
    }
    if (!current) {
      tex?.dispose();
      this.after();
      return;
    }
    this.show(slot, missing ? (this.placeholder ??= placeholderTexture()) : tex!, missing ? null : tex);
    this.after();
  }

  private after(): void {
    this.onSettled?.();
    // A finished load frees a concurrency slot: keep the queue moving.
    this.replan();
  }

  private show(slot: PaintingSlot, map: THREE.Texture, owned: THREE.Texture | null): void {
    const g = new THREE.Group();
    g.position.copy(slot.position);
    g.rotation.y = slot.rotationY;
    const disposables: { dispose(): void }[] = [];
    const imgGeo = new THREE.PlaneGeometry(slot.w, slot.h);
    const imgMat = new THREE.MeshBasicMaterial({ map });
    const img = new THREE.Mesh(imgGeo, imgMat);
    img.position.z = WORK_OFFSET;
    g.add(img);
    disposables.push(imgGeo, imgMat);
    if (owned) disposables.push(owned);
    const m = slot.media;
    if (m.title || m.artist || m.description) {
      const { texture: lt, w: lw, h: lh } = labelTexture(m, this.anisotropy);
      const lg = new THREE.PlaneGeometry(lw, lh);
      const lm = new THREE.MeshBasicMaterial({ map: lt });
      const label = new THREE.Mesh(lg, lm);
      // local +x is the viewer's right while facing the wall (plane faces +z); bottom-aligned with the work
      label.position.set(slot.w / 2 + 0.1 + lw / 2, -slot.h / 2 + lh / 2, WORK_OFFSET);
      g.add(label);
      disposables.push(lt, lg, lm);
    }
    this.parent.add(g);
    this.live.set(slot.id, { group: g, disposables });
    this.resident.add(slot.id);
  }

  private release(id: string): void {
    if (this.loading.has(id)) {
      this.tokens.delete(id);
      this.loading.delete(id);
      return;
    }
    const l = this.live.get(id);
    if (!l) return;
    this.parent.remove(l.group);
    for (const d of l.disposables) d.dispose();
    this.live.delete(id);
    this.resident.delete(id);
  }
}
