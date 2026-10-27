// WebXR locomotion: teleport arc (right stick forward), snap turn (right stick sideways),
// smooth walking (left stick, toggled with the left X button). Everything is defensive:
// gamepads / handedness may be missing or arrive late.
import * as THREE from 'three';
import { computeArc, isTeleportTargetValid, PLAYER_RADIUS } from './collision';
import type { Player } from './player';
import type { Museum } from '../shared/museum';
import { recentreCorrection } from './recentre';

const SNAP_RAD = (30 * Math.PI) / 180;
const SMOOTH_SPEED = 1.4;
const DEADZONE = 0.15;
const ARC_POINTS = 41;

function axes(gp: Gamepad): { x: number; y: number } {
  const a = gp.axes;
  // xr-standard: [touchpad x, touchpad y, thumbstick x, thumbstick y]
  if (a.length >= 4) return { x: a[2] ?? 0, y: a[3] ?? 0 };
  return { x: a[0] ?? 0, y: a[1] ?? 0 };
}

class Hud {
  readonly mesh: THREE.Mesh;
  private canvas = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  private hideAt = 0;
  constructor(camera: THREE.Camera) {
    this.canvas.width = 1024;
    this.canvas.height = 192;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.13), mat);
    this.mesh.position.set(0, -0.2, -0.9);
    this.mesh.renderOrder = 999;
    this.mesh.visible = false;
    camera.add(this.mesh);
  }
  show(text: string, now: number, seconds = 3): void {
    const g = this.canvas.getContext('2d')!;
    g.clearRect(0, 0, 1024, 192);
    g.fillStyle = 'rgba(0,0,0,0.7)';
    g.beginPath();
    g.roundRect(0, 0, 1024, 192, 40);
    g.fill();
    g.fillStyle = '#fff';
    g.font = '52px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 512, 96, 960);
    this.tex.needsUpdate = true;
    this.mesh.visible = true;
    this.hideAt = now + seconds;
  }
  tick(now: number): void {
    if (this.mesh.visible && now > this.hideAt) this.mesh.visible = false;
  }
  hide(): void {
    this.mesh.visible = false;
  }
}

export class XRLocomotion {
  smooth = false;
  private controllers: THREE.Group[] = [];
  private arcLine: THREE.Line;
  private arcPositions = new Float32Array(ARC_POINTS * 3);
  private marker: THREE.Mesh;
  private aiming = false;
  private teleportTarget: { x: number; y: number } | null = null;
  private xWasDown = false;
  private snapReady = true;
  private needsRecentre = true;
  private framesSinceStart = 0;
  private hud: Hud;
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    private player: Player,
    private museum: Museum,
  ) {
    this.hud = new Hud(player.camera);

    for (let i = 0; i < 2; i++) {
      const c = renderer.xr.getController(i);
      c.userData.handedness = '';
      c.addEventListener('connected', (e) => {
        c.userData.handedness = (e as unknown as { data?: XRInputSource }).data?.handedness ?? '';
      });
      c.addEventListener('disconnected', () => (c.userData.handedness = ''));
      // simple pointer model: small body + thin ray; no network fetches
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.018, 0.1, 10),
        new THREE.MeshBasicMaterial({ color: 0x333333 }),
      );
      body.rotation.x = Math.PI / 2;
      c.add(body);
      player.rig.add(c);
      this.controllers.push(c);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.arcPositions, 3));
    this.arcLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x33dd66 }));
    this.arcLine.frustumCulled = false;
    this.arcLine.visible = false;
    scene.add(this.arcLine);

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.15, 0.25, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x33dd66, side: THREE.DoubleSide }),
    );
    this.marker.visible = false;
    scene.add(this.marker);
  }

  onSessionStart(): void {
    this.needsRecentre = true;
    this.framesSinceStart = 0;
    this.aiming = false;
    this.snapReady = true;
    this.xWasDown = false;
    this.hud.show('Right stick: forward = teleport, sideways = turn · X: smooth walking', performance.now() / 1000, 6);
  }

  onSessionEnd(): void {
    this.aiming = false;
    this.arcLine.visible = false;
    this.marker.visible = false;
    this.hud.hide();
  }

  private controllerFor(hand: 'left' | 'right'): THREE.Group | null {
    return (
      this.controllers.find((c) => c.userData.handedness === hand) ??
      (this.controllers.some((c) => c.userData.handedness) ? null : this.controllers[hand === 'left' ? 0 : 1] ?? null)
    );
  }

  update(dt: number, now: number): void {
    const session = this.renderer.xr.getSession();
    if (!session) return;
    this.hud.tick(now);

    // Recentre once a real XR pose has been applied. three.js copies the viewer pose into the camera
    // inside renderer.render(), i.e. after this update(), so frame 1 still holds the stale desktop pose.
    this.framesSinceStart++;
    if (this.needsRecentre && this.framesSinceStart >= 2) {
      this.player.rig.updateMatrixWorld(true);
      this.player.camera.getWorldPosition(this.v1);
      this.player.camera.getWorldDirection(this.v2);
      const spawn = this.museum.settings.spawn;
      const c = recentreCorrection({ x: this.v2.x, y: this.v2.z }, spawn.yawDeg);
      this.player.turn(c.dyaw); // rotate about the head
      this.player.placeHeadAt({ x: spawn.x, y: spawn.y });
      if (this.v1.y < 0.3) this.player.rig.position.y = 1.6; // reference space is eye-level, not floor-level
      this.needsRecentre = false;
    }

    let left: Gamepad | null = null;
    let right: Gamepad | null = null;
    try {
      for (const src of session.inputSources) {
        if (!src.gamepad) continue;
        if (src.handedness === 'left') left = src.gamepad;
        else if (src.handedness === 'right') right = src.gamepad;
      }
    } catch (e) {
      console.warn('[xr] input sources unavailable', e);
      return;
    }

    // X button toggles smooth locomotion
    const xDown = !!left && left.buttons.length > 4 && left.buttons[4].pressed;
    if (xDown && !this.xWasDown) {
      this.smooth = !this.smooth;
      this.hud.show(this.smooth ? 'Smooth walking (left stick) · X to switch back' : 'Teleport mode · X for smooth walking', now);
    }
    this.xWasDown = xDown;

    // smooth walking, head-relative
    if (this.smooth && left) {
      const s = axes(left);
      const mag = Math.hypot(s.x, s.y);
      if (mag > DEADZONE) {
        this.player.camera.getWorldDirection(this.v1);
        let fx = this.v1.x;
        let fz = this.v1.z;
        const fl = Math.hypot(fx, fz);
        if (fl > 1e-3) {
          fx /= fl; fz /= fl;
          const k = Math.min(1, (mag - DEADZONE) / (1 - DEADZONE)) / mag; // rescale past deadzone
          const fwd = -s.y * k;
          const rgt = s.x * k;
          // right = (-fz, fx) in (x, z)
          this.player.moveBy({
            x: (fx * fwd - fz * rgt) * SMOOTH_SPEED * dt,
            y: (fz * fwd + fx * rgt) * SMOOTH_SPEED * dt,
          });
        }
      }
    }

    // right stick: snap turn + teleport aim
    if (right) {
      const s = axes(right);
      if (Math.abs(s.x) < 0.3) this.snapReady = true;
      else if (this.snapReady && Math.abs(s.x) > 0.7 && !this.aiming) {
        this.snapReady = false;
        this.player.turn(s.x > 0 ? -SNAP_RAD : SNAP_RAD); // right = clockwise from above
      }

      const wantAim = s.y < -0.6 && Math.abs(s.x) < 0.6;
      if (wantAim) this.aim();
      else if (this.aiming) {
        const t = this.teleportTarget;
        if (t) this.player.placeHeadAt(t);
        this.endAim();
      }
    } else if (this.aiming) {
      this.endAim();
    }
  }

  private aim(): void {
    const c = this.controllerFor('right');
    if (!c) return;
    this.player.rig.updateMatrixWorld(true);
    c.getWorldPosition(this.v1);
    c.getWorldDirection(this.v2).negate(); // controller forward = -z
    const arc = computeArc(this.v1, this.v2);
    this.aiming = true;
    const n = Math.min(arc.points.length, ARC_POINTS);
    for (let i = 0; i < n; i++) {
      this.arcPositions[i * 3] = arc.points[i].x;
      this.arcPositions[i * 3 + 1] = arc.points[i].y;
      this.arcPositions[i * 3 + 2] = arc.points[i].z;
    }
    const geo = this.arcLine.geometry;
    geo.setDrawRange(0, n);
    geo.getAttribute('position').needsUpdate = true;

    let valid = false;
    this.teleportTarget = null;
    if (arc.hit) {
      const to = { x: arc.hit.x, y: arc.hit.z };
      valid = isTeleportTargetValid(
        this.player.headPlan(),
        to,
        this.museum.walls,
        this.museum.settings.wallThickness,
        PLAYER_RADIUS,
        this.player.bounds,
      );
      if (valid) this.teleportTarget = to;
      this.marker.position.set(to.x, 0.01, to.y);
    }
    const color = valid ? 0x33dd66 : 0xdd4433;
    (this.arcLine.material as THREE.LineBasicMaterial).color.setHex(color);
    (this.marker.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.arcLine.visible = true;
    this.marker.visible = !!arc.hit;
  }

  private endAim(): void {
    this.aiming = false;
    this.teleportTarget = null;
    this.arcLine.visible = false;
    this.marker.visible = false;
  }
}
