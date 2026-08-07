import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { SpectralLookProfile } from '../spectral/looks';

export class SpectralPostProcessor {
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly outputPass: OutputPass;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    look: SpectralLookProfile,
  ) {
    THREE.ColorManagement.workingColorSpace = THREE.LinearSRGBColorSpace;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      look.bloomStrength,
      look.bloomRadius,
      look.bloomThreshold,
    );
    this.composer.addPass(this.bloomPass);
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
    this.setLook(look);
  }

  setLook(look: SpectralLookProfile): void {
    this.renderer.toneMappingExposure = look.exposure;
    this.bloomPass.strength = look.bloomStrength;
    this.bloomPass.radius = look.bloomRadius;
    this.bloomPass.threshold = look.bloomThreshold;
  }

  setExposure(exposure: number): void {
    this.renderer.toneMappingExposure = Math.min(4, Math.max(0, exposure));
  }

  render(deltaSeconds = 1 / 60): void {
    this.composer.render(deltaSeconds);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  dispose(): void {
    this.bloomPass.dispose();
    this.outputPass.dispose();
    this.composer.dispose();
  }
}
