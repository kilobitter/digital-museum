import * as THREE from 'three';
import { parseMuseum } from '../shared/validate';
import type { Museum } from '../shared/museum';
import { ZoneAudio } from './audio';
import { DesktopControls } from './desktop';
import { Player } from './player';
import { buildMuseumScene } from './scene';
import { hideOverlay, setControlsHint, showError, showLoading, showStart, toast } from './ui';
import { XRLocomotion } from './xr';

const MUSEUM_BASE = './museum/';
const urlFor = (file: string) => MUSEUM_BASE + file;

async function fetchMuseum(): Promise<Museum> {
  let res: Response;
  try {
    res = await fetch(MUSEUM_BASE + 'museum.json', { cache: 'no-cache' });
  } catch (e) {
    throw new MuseumError('Could not load museum.json', [`Network error: ${String(e)}`]);
  }
  if (!res.ok) throw new MuseumError('Could not load museum.json', [`HTTP ${res.status} for ${MUSEUM_BASE}museum.json`]);
  let json: unknown;
  try {
    json = await res.json();
  } catch (e) {
    throw new MuseumError('museum.json is not valid JSON', [String(e)]);
  }
  const parsed = parseMuseum(json);
  if (!parsed.ok) throw new MuseumError('museum.json is invalid', parsed.errors);
  return parsed.museum;
}

class MuseumError extends Error {
  constructor(
    readonly title: string,
    readonly details: string[],
  ) {
    super(title);
  }
}

async function xrSupported(): Promise<boolean> {
  try {
    return !!navigator.xr && (await navigator.xr.isSessionSupported('immersive-vr'));
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  showLoading('Reading museum…');
  const museum = await fetchMuseum();
  document.title = museum.name;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    throw new MuseumError('WebGL is not available', [String(e)]);
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = false;
  renderer.xr.enabled = true;
  renderer.xr.setFoveation(1);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf2f2f2);
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 200);

  const audio = new ZoneAudio();
  const total = museum.works.length + museum.zones.length;
  let done = 0;
  const progress = () => showLoading(`Loading media ${Math.min(++done, total)} / ${total}…`);
  showLoading(`Loading media 0 / ${total}…`);

  const [built, audioWarnings] = await Promise.all([
    buildMuseumScene(museum, urlFor, Math.min(4, renderer.capabilities.getMaxAnisotropy()), progress),
    audio.load(museum, urlFor, progress),
  ]);
  scene.add(built.group);
  const warnings = [...built.warnings, ...audioWarnings];

  const player = new Player(camera, museum, built.bounds);
  scene.add(player.rig);
  const desktop = new DesktopControls(player, renderer.domElement);
  const xr = new XRLocomotion(renderer, scene, player, museum);

  renderer.xr.addEventListener('sessionstart', () => {
    desktop.stop();
    hideOverlay();
    setControlsHint(null);
    xr.onSessionStart();
    void audio.start();
  });
  renderer.xr.addEventListener('sessionend', () => {
    xr.onSessionEnd();
    player.rig.position.y = 0;
    player.resetDesktopCamera();
    showStartScreen('VR session ended.');
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  document.addEventListener('visibilitychange', () => audio.setPaused(document.hidden));

  const supported = await xrSupported();

  async function enterVR(): Promise<void> {
    void audio.start();
    try {
      const session = await navigator.xr!.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor'],
      });
      await renderer.xr.setSession(session);
    } catch (e) {
      console.warn('[xr] could not start session', e);
      showStartScreen(`Could not start VR: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function showStartScreen(message?: string): void {
    showStart({
      name: museum.name,
      warnings,
      xrSupported: supported,
      message,
      onVR: () => void enterVR(),
      onDesktop: () => {
        hideOverlay();
        desktop.start(); // requests pointer lock inside the click gesture
        void audio.start();
      },
    });
  }
  showStartScreen();

  let last = performance.now();
  renderer.setAnimationLoop((time) => {
    const dt = Math.min(0.1, Math.max(0, (time - last) / 1000));
    last = time;
    try {
      if (renderer.xr.isPresenting) xr.update(dt, time / 1000);
      else desktop.update(dt);
      audio.update(player.headPlan());
    } catch (e) {
      console.error('[museum] frame error', e);
    }
    renderer.render(scene, camera);
  });

  if (warnings.length) toast(`${warnings.length} media file(s) failed to load`, 4000);
}

main().catch((e) => {
  console.error(e);
  if (e instanceof MuseumError) showError(e.title, e.details);
  else showError('Something went wrong', [e instanceof Error ? e.message : String(e)]);
});
