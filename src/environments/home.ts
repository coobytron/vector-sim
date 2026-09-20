import * as THREE from 'three';
import { createHomeGeometryParts, type HomeGeometryPart } from './homeGeometry';
import {
  selectHomePreset,
  type HomePresetManifest,
} from './homePresets';

const porcelain = new THREE.MeshStandardMaterial({
  color: 0xe8e8e4,
  roughness: 0.88,
  metalness: 0,
});

const porcelainLight = new THREE.MeshStandardMaterial({
  color: 0xf4f4f1,
  roughness: 0.8,
  metalness: 0,
});

const graphite = new THREE.LineBasicMaterial({
  color: 0xa3a3a0,
  transparent: true,
  opacity: 0.45,
});

function materialFor(part: Extract<HomeGeometryPart, { kind: 'box' }>): THREE.Material {
  return part.material === 'porcelain-light' ? porcelainLight : porcelain;
}

function objectFor(part: HomeGeometryPart): THREE.Object3D {
  if (part.kind === 'box') {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(part.size[0], part.size[1], part.size[2]),
      materialFor(part),
    );
    mesh.position.set(part.position[0], part.position[1], part.position[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = part.id;
    mesh.userData.role = part.role;
    if (part.fieldSourceId) mesh.userData.fieldSourceId = part.fieldSourceId;
    return mesh;
  }

  if (part.kind === 'frame') {
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(part.size[0], part.size[1], part.size[2])),
      graphite,
    );
    frame.position.set(part.position[0], part.position[1], part.position[2]);
    frame.name = part.id;
    frame.userData.role = part.role;
    if (part.fieldSourceId) frame.userData.fieldSourceId = part.fieldSourceId;
    return frame;
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(
    part.points.map((point) => new THREE.Vector3(point[0], point[1], point[2])),
  );
  const line = new THREE.Line(geometry, graphite);
  line.name = part.id;
  line.userData.role = part.role;
  if (part.fieldSourceId) line.userData.fieldSourceId = part.fieldSourceId;
  return line;
}

export function createHomeEnvironment(
  preset: HomePresetManifest = selectHomePreset(null),
): THREE.Group {
  const home = new THREE.Group();
  home.name = `home-${preset.id}`;
  home.userData.presetId = preset.id;
  home.userData.seed = preset.seed;

  for (const part of createHomeGeometryParts(preset)) {
    home.add(objectFor(part));
  }

  return home;
}
