import type { PerspectiveCamera } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { HomeCameraPreset } from '../environments/homePresets';

/** Apply an authored view without carrying over the previous orbit's momentum. */
export function applyHomeCamera(
  camera: PerspectiveCamera,
  controls: OrbitControls,
  preset: HomeCameraPreset,
): void {
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  camera.position.set(preset.position.x, preset.position.y, preset.position.z);
  controls.target.set(preset.target.x, preset.target.y, preset.target.z);
  camera.fov = preset.fovDegrees;
  camera.updateProjectionMatrix();
  controls.update();
  controls.enableDamping = damping;
}
