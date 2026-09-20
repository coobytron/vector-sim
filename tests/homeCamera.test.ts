import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { describe, expect, it } from 'vitest';
import { HOME_PRESETS } from '../src/environments/homePresets';
import { applyHomeCamera } from '../src/rendering/homeCamera';

describe('authored Home camera application', () => {
  it('preserves all twelve authored poses, targets and lenses through orbit updates', () => {
    const camera = new PerspectiveCamera(42, 1.7, 0.05, 40);
    const controls = new OrbitControls(camera);
    controls.enableDamping = true;
    controls.minDistance = 0.25;
    controls.maxDistance = 12;
    controls.maxPolarAngle = Math.PI * 0.49;

    for (const preset of Object.values(HOME_PRESETS)) {
      for (const view of preset.cameras) {
        applyHomeCamera(camera, controls, view);
        const expectedPosition = new Vector3(view.position.x, view.position.y, view.position.z);
        const expectedTarget = new Vector3(view.target.x, view.target.y, view.target.z);
        for (let frame = 0; frame < 5; frame += 1) controls.update();
        expect(camera.position.distanceTo(expectedPosition)).toBeLessThan(1e-10);
        expect(controls.target.distanceTo(expectedTarget)).toBeLessThan(1e-10);
        expect(camera.fov).toBe(view.fovDegrees);
        expect(camera.aspect).toBe(1.7);
        expect(controls.enableDamping).toBe(true);
        expect(camera.projectionMatrix.elements[5]).toBeCloseTo(
          1 / Math.tan(view.fovDegrees * Math.PI / 360), 10,
        );
      }
    }
  });

  it('returns to the selected macro view after orbiting instead of clamping to four meters', () => {
    const camera = new PerspectiveCamera();
    const controls = new OrbitControls(camera);
    controls.minDistance = 0.25;
    const view = HOME_PRESETS['tabletop-habitat'].cameras.find((entry) => entry.role === 'macro')!;
    applyHomeCamera(camera, controls, view);
    const original = camera.position.clone();
    camera.position.set(8, 6, 5);
    controls.target.set(1, 2, 3);
    controls.update();
    applyHomeCamera(camera, controls, view);
    expect(camera.position.distanceTo(original)).toBeLessThan(1e-10);
    expect(camera.position.distanceTo(controls.target)).toBeLessThan(4);
    expect(controls.enableDamping).toBe(false);
  });
});
