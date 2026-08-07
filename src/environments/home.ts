import * as THREE from 'three';

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

function box(
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  material = porcelain,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createHomeEnvironment(): THREE.Group {
  const home = new THREE.Group();
  home.name = 'home-graybox';

  home.add(box(6.4, 0.12, 4.8, 0, -0.06, 0));
  home.add(box(6.4, 3.2, 0.12, 0, 1.6, -2.34));
  home.add(box(0.12, 3.2, 4.8, -3.14, 1.6, 0));
  home.add(box(1.8, 0.11, 0.8, 0.8, 0.76, -0.6, porcelainLight));
  home.add(box(0.11, 0.75, 0.11, 0.1, 0.375, -0.9));
  home.add(box(0.11, 0.75, 0.11, 1.5, 0.375, -0.3));

  for (let step = 0; step < 5; step += 1) {
    home.add(box(0.9, 0.18, 0.42, -2.3, 0.09 + step * 0.18, 1.5 - step * 0.38));
  }

  const windowFrame = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.45, 1.1, 0.03)),
    graphite,
  );
  windowFrame.position.set(1.7, 1.85, -2.24);
  home.add(windowFrame);

  const threshold = box(0.85, 0.025, 0.16, 2.7, 0.02, 0.55, porcelainLight);
  threshold.name = 'field-food-threshold';
  home.add(threshold);

  const faultGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-3.05, 0.35, -0.6),
    new THREE.Vector3(-3.05, 0.8, -0.35),
    new THREE.Vector3(-3.05, 1.2, -0.7),
    new THREE.Vector3(-3.05, 1.6, -0.45),
  ]);
  const fault = new THREE.Line(faultGeometry, graphite);
  fault.name = 'field-kill-fault';
  home.add(fault);

  return home;
}

