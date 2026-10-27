// The player rig: a Group holding the camera. Moving the rig moves the head (desktop and XR).
import * as THREE from 'three';
import type { Museum, Vec2 } from '../shared/museum';
import { yawToRotationY } from '../shared/geometry';
import { PLAYER_RADIUS, resolveMove, pushOut, type Bounds } from './collision';

export const EYE_HEIGHT = 1.6;

const tmp = new THREE.Vector3();

export class Player {
  readonly rig = new THREE.Group();
  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private museum: Museum,
    readonly bounds: Bounds,
  ) {
    this.rig.name = 'rig';
    this.rig.add(camera);
    this.resetToSpawn();
  }

  resetToSpawn(): void {
    const s = this.museum.settings.spawn;
    const p = pushOut({ x: s.x, y: s.y }, this.museum.walls, this.museum.settings.wallThickness, PLAYER_RADIUS);
    this.rig.position.set(p.x, 0, p.y);
    this.rig.rotation.set(0, yawToRotationY(s.yawDeg), 0);
    this.resetDesktopCamera();
  }

  resetDesktopCamera(): void {
    this.camera.position.set(0, EYE_HEIGHT, 0);
    this.camera.rotation.set(0, 0, 0);
    this.camera.quaternion.set(0, 0, 0, 1);
  }

  /** Head position in plan coordinates (world x, z). */
  headPlan(): Vec2 {
    this.rig.updateMatrixWorld(true);
    this.camera.getWorldPosition(tmp);
    return { x: tmp.x, y: tmp.z };
  }

  /** Move the head by a plan-space delta with wall collision + sliding. */
  moveBy(delta: Vec2): void {
    const head = this.headPlan();
    const next = resolveMove(head, delta, this.museum.walls, this.museum.settings.wallThickness, PLAYER_RADIUS);
    this.rig.position.x += next.x - head.x;
    this.rig.position.z += next.y - head.y;
  }

  /** Put the head at plan position `p` (no collision; caller validates). */
  placeHeadAt(p: Vec2): void {
    const head = this.headPlan();
    this.rig.position.x += p.x - head.x;
    this.rig.position.z += p.y - head.y;
  }

  /** Rotate the view by `radians` (positive = counter-clockwise from above) around the head. */
  turn(radians: number): void {
    const before = this.headPlan();
    this.rig.rotation.y += radians;
    const after = this.headPlan();
    this.rig.position.x += before.x - after.x;
    this.rig.position.z += before.y - after.y;
  }
}
