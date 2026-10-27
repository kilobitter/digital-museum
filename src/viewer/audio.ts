// Ambient audio zones, streamed: compressed bytes are fetched and decoded only for zones near the
// visitor (AUDIO_LIMITS.loadRadius from the zone edge) and released again beyond unloadRadius.
// One looping AudioBufferSourceNode per resident zone, gain driven per frame.
import { distanceInside, zoneGain } from '../shared/zones';
import type { AudioZone, Museum, Vec2 } from '../shared/museum';
import { AUDIO_LIMITS, planByDistance, type StreamLimits } from './streaming';

interface Voice {
  zone: AudioZone;
  gain: GainNode;
  source: AudioBufferSourceNode;
}

interface Decoded {
  promise: Promise<AudioBuffer>;
  /** Zones that currently hold this buffer; it is dropped when the last one lets go. */
  refs: Set<string>;
}

const REPLAN_MOVE = 0.5;

export class ZoneAudio {
  private ctx: AudioContext | null = null;
  private museum: Museum | null = null;
  private urlFor: (file: string) => string = (f) => f;
  private voices = new Map<string, Voice>();
  private loading = new Map<string, number>(); // zone id -> request token
  private failed = new Set<string>();
  private decoded = new Map<string, Decoded>(); // media file -> decoded buffer
  private started = false;
  private seq = 0;
  private lastPlanned: Vec2 | null = null;
  private lastHead: Vec2 = { x: 0, y: 0 };
  private idleWaiters: (() => void)[] = [];
  private onSettled: (() => void) | null = null;
  readonly warnings: string[] = [];

  constructor(private readonly limits: StreamLimits = AUDIO_LIMITS) {
    try {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) this.ctx = new Ctor();
    } catch (e) {
      console.warn('[audio] AudioContext unavailable; zones will be silent', e);
    }
  }

  /** Number of zones whose audio is currently decoded and playable. */
  get decodedCount(): number {
    return this.voices.size;
  }

  /** Number of distinct decoded buffers held in memory. */
  get bufferCount(): number {
    return this.decoded.size;
  }

  init(museum: Museum, urlFor: (file: string) => string): void {
    this.museum = museum;
    this.urlFor = urlFor;
  }

  /** Load the zones near `head` before the start screen. Resolves with the warnings so far. */
  async prime(head: Vec2, onProgress?: (done: number, total: number) => void): Promise<string[]> {
    if (!this.ctx || !this.museum) return this.warnings;
    this.lastHead = head;
    const probe = this.plan(head, { ...this.limits, maxConcurrent: Infinity });
    const total = probe.load.length;
    let done = 0;
    this.onSettled = () => onProgress?.(Math.min(++done, total), total);
    onProgress?.(0, total);
    this.replan();
    if (this.loading.size > 0) await new Promise<void>((res) => this.idleWaiters.push(res));
    this.onSettled = null;
    return this.warnings;
  }

  private plan(head: Vec2, limits: StreamLimits) {
    const entries = this.museum!.zones
      .filter((z) => !this.failed.has(z.id))
      .map((z) => ({ id: z.id, dist: Math.max(0, -distanceInside(z.shape, head)) }));
    return planByDistance(entries, new Set(this.voices.keys()), new Set(this.loading.keys()), limits);
  }

  private replan(): void {
    this.lastPlanned = { ...this.lastHead };
    const plan = this.plan(this.lastHead, this.limits);
    for (const id of plan.unload) this.release(id);
    for (const id of plan.load) void this.loadZone(id);
    if (this.loading.size === 0 && plan.load.length === 0) {
      const w = this.idleWaiters;
      this.idleWaiters = [];
      for (const f of w) f();
    }
  }

  private async loadZone(zoneId: string): Promise<void> {
    const ctx = this.ctx;
    const zone = this.museum?.zones.find((z) => z.id === zoneId);
    if (!ctx || !zone) return;
    const media = this.museum!.media.find((m) => m.id === zone.mediaId);
    const token = ++this.seq;
    this.loading.set(zoneId, token);
    let file = '';
    try {
      if (!media) throw new Error('media entry missing');
      file = media.file;
      let d = this.decoded.get(file);
      if (!d) {
        const url = this.urlFor(file);
        d = {
          refs: new Set(),
          promise: (async () => {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return ctx.decodeAudioData(await res.arrayBuffer());
          })(),
        };
        this.decoded.set(file, d);
      }
      d.refs.add(zoneId);
      const buffer = await d.promise;
      if (this.loading.get(zoneId) !== token) return; // released while loading
      this.loading.delete(zoneId);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0; // ramps up from silence, also when the visitor is already inside
      source.connect(gain).connect(ctx.destination);
      this.voices.set(zoneId, { zone, gain, source });
      if (this.started) this.startSource(source);
    } catch (e) {
      if (this.loading.get(zoneId) === token) {
        this.loading.delete(zoneId);
        this.failed.add(zoneId);
        this.dropRef(zoneId, file);
        const msg = `audio for zone '${zone.name || zone.id}' (${media?.file ?? zone.mediaId}) skipped: ${String(e)}`;
        console.warn('[museum]', msg);
        this.warnings.push(msg);
      }
    }
    this.onSettled?.();
    this.replan();
  }

  private startSource(source: AudioBufferSourceNode): void {
    try { source.start(); } catch (e) { console.warn('[audio] start failed', e); }
  }

  private dropRef(zoneId: string, file: string): void {
    const d = this.decoded.get(file);
    if (!d) return;
    d.refs.delete(zoneId);
    if (d.refs.size === 0) this.decoded.delete(file);
  }

  private release(zoneId: string): void {
    const zone = this.museum?.zones.find((z) => z.id === zoneId);
    const file = this.museum?.media.find((m) => m.id === zone?.mediaId)?.file ?? '';
    if (this.loading.has(zoneId)) {
      this.loading.delete(zoneId);
      this.dropRef(zoneId, file);
      return;
    }
    const v = this.voices.get(zoneId);
    if (!v) return;
    try { v.source.stop(); } catch { /* never started */ }
    v.source.disconnect();
    v.gain.disconnect();
    v.source.buffer = null;
    this.voices.delete(zoneId);
    this.dropRef(zoneId, file);
  }

  /** Call from a user gesture. */
  async start(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      if (ctx.state !== 'running') await ctx.resume();
    } catch (e) {
      console.warn('[audio] resume failed', e);
    }
    if (!this.started) {
      this.started = true;
      for (const v of this.voices.values()) this.startSource(v.source);
    }
  }

  setPaused(paused: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.started) return;
    (paused ? ctx.suspend() : ctx.resume()).catch(() => {});
  }

  /** `p` is the listener in plan coordinates. Smooths gain to avoid zipper noise. */
  update(p: Vec2): void {
    const ctx = this.ctx;
    if (!ctx || !this.museum) return;
    this.lastHead = p;
    if (!this.lastPlanned || Math.hypot(p.x - this.lastPlanned.x, p.y - this.lastPlanned.y) >= REPLAN_MOVE) this.replan();
    if (!this.started) return;
    for (const v of this.voices.values()) {
      v.gain.gain.setTargetAtTime(zoneGain(v.zone, p), ctx.currentTime, 0.08);
    }
  }
}
