// Ambient audio zones: one looping AudioBufferSourceNode per zone, gain driven per frame.
import { zoneGain } from '../shared/zones';
import type { AudioZone, Museum, Vec2 } from '../shared/museum';

interface Voice {
  zone: AudioZone;
  gain: GainNode;
  source: AudioBufferSourceNode;
}

export class ZoneAudio {
  private ctx: AudioContext | null = null;
  private voices: Voice[] = [];
  private started = false;

  constructor() {
    try {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) this.ctx = new Ctor();
    } catch (e) {
      console.warn('[audio] AudioContext unavailable; zones will be silent', e);
    }
  }

  /** Fetch + decode every zone's audio. Failures skip that zone (collected in the returned warnings). */
  async load(museum: Museum, urlFor: (file: string) => string, onProgress?: () => void): Promise<string[]> {
    const warnings: string[] = [];
    const ctx = this.ctx;
    if (!ctx) return warnings;
    const cache = new Map<string, Promise<AudioBuffer>>();
    await Promise.all(
      museum.zones.map(async (zone) => {
        const media = museum.media.find((m) => m.id === zone.mediaId);
        try {
          if (!media) throw new Error('media entry missing');
          let p = cache.get(media.file);
          if (!p) {
            p = (async () => {
              const res = await fetch(urlFor(media.file));
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              return ctx.decodeAudioData(await res.arrayBuffer());
            })();
            cache.set(media.file, p);
          }
          const buffer = await p;
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.loop = true;
          const gain = ctx.createGain();
          gain.gain.value = 0;
          source.connect(gain).connect(ctx.destination);
          this.voices.push({ zone, gain, source });
        } catch (e) {
          const msg = `audio for zone '${zone.name || zone.id}' (${media?.file ?? zone.mediaId}) skipped: ${String(e)}`;
          console.warn('[museum]', msg);
          warnings.push(msg);
        } finally {
          onProgress?.();
        }
      }),
    );
    return warnings;
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
      for (const v of this.voices) {
        try { v.source.start(); } catch (e) { console.warn('[audio] start failed', e); }
      }
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
    if (!ctx || !this.started) return;
    for (const v of this.voices) {
      v.gain.gain.setTargetAtTime(zoneGain(v.zone, p), ctx.currentTime, 0.08);
    }
  }
}
