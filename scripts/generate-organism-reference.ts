import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import sharp from 'sharp';
import { createMorphologyTopology } from '../src/organisms/morphology';
import {
  EDGE_KIND,
  NODE_ROLE,
  type MorphologyFamily,
  type OrganismDescriptor,
  type OrganismVisualState,
  type VisualDecodeInput,
} from '../src/organisms/types';
import { createDecodedCellVisual, decodeCellVisual } from '../src/organisms/visualState';
import type { QualityTier } from '../src/simulation/types';
import { evaluateSpectralColor, rgbToCss } from '../src/spectral/color';
import {
  GHOST_MEMBRANE_OPACITY,
  GHOST_PRIMARY_OPACITY,
  SPECTRAL_LOOKS,
  type SpectralLookName,
} from '../src/spectral/looks';

const width = 1536;
const height = 1024;
const seed = 0x5350_4543;
const morphologyPath = resolve('assets/reference/organism-morphology-reference.png');
const statePath = resolve('assets/reference/organism-state-reference.png');
const manifestPath = resolve('assets/reference/organism-reference.json');
const captureTier: QualityTier = {
  name: 'mobile',
  organisms: 3,
  slotsPerOrganism: 128,
  maxDpr: 1.25,
  longEdgeCap: 1280,
  targetFps: 30,
  targetFrameMs: 1000 / 30,
};
const topology = createMorphologyTopology(captureTier, seed);

interface Point {
  x: number;
  y: number;
  depth: number;
}

interface RenderSpec {
  descriptor: OrganismDescriptor;
  organismIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  look: SpectralLookName;
  state: OrganismVisualState | 'lifecycle';
  scale: number;
}

interface NodeRenderState {
  point: Point;
  radius: number;
  connectivity: number;
  emission: string | undefined;
  emissionStrength: number;
  baseTone: number;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return entities[character] ?? character;
  });
}

function project(
  positionOffset: number,
  descriptor: OrganismDescriptor,
  spec: RenderSpec,
): Point {
  const x = (topology.restPositions[positionOffset] ?? 0) - descriptor.center[0];
  const y = (topology.restPositions[positionOffset + 1] ?? 0) - descriptor.center[1];
  const z = (topology.restPositions[positionOffset + 2] ?? 0) - descriptor.center[2];
  const orientation = (spec.organismIndex / topology.organisms.length) * Math.PI * 2 + Math.PI;
  const cosine = Math.cos(orientation);
  const sine = Math.sin(orientation);
  const localX = x * cosine + z * sine;
  const localZ = -x * sine + z * cosine;
  return {
    x: spec.x + spec.width * 0.5 + (localX + localZ * 0.28) * spec.scale,
    y: spec.y + spec.height * 0.53 + (-y + localZ * 0.18) * spec.scale,
    depth: localZ,
  };
}

function lifecycleState(local: number, count: number): OrganismVisualState {
  const amount = local / Math.max(1, count - 1);
  if (amount < 0.18) return 'feeding';
  if (amount < 0.5) return 'dormant';
  if (amount < 0.72) return 'regenerating';
  if (amount < 0.92) return 'damaged';
  return 'death';
}

function nodeStates(spec: RenderSpec): NodeRenderState[] {
  const states: NodeRenderState[] = [];
  const look = SPECTRAL_LOOKS[spec.look];
  const input: VisualDecodeInput = {
    energy: 0.55,
    health: 1,
    previousHealth: 1,
    activity: 0.62,
    thicknessSignal: 0,
    curvatureSignal: 0,
    connectivitySignal: 0.25,
    role: NODE_ROLE.structure,
    phase: 0,
  };
  const output = createDecodedCellVisual();
  for (let local = 0; local < spec.descriptor.count; local += 1) {
    const node = spec.descriptor.start + local;
    const role = topology.nodeRole[node] ?? NODE_ROLE.structure;
    const state = spec.state === 'lifecycle'
      ? lifecycleState(local, spec.descriptor.count)
      : spec.state;
    input.energy = state === 'feeding' ? 0.94 : state === 'starving' ? 0.08 : 0.56;
    input.health = state === 'death'
      ? 0
      : state === 'dying'
        ? 0.12
        : state === 'damaged'
          ? 0.5
          : state === 'regenerating'
            ? 0.82
            : 1;
    input.previousHealth = state === 'regenerating' ? 0.56 : input.health;
    input.activity = 0.38 + ((local * 17) % 19) / 31;
    input.thicknessSignal = Math.sin(local * 0.41) * 0.42;
    input.curvatureSignal = Math.cos(local * 0.29) * 0.36;
    input.connectivitySignal = Math.sin(local * 0.13) * 0.28;
    input.role = role as typeof input.role;
    input.phase = state === 'death' ? 0.08 : local / Math.max(1, spec.descriptor.count - 1);
    input.stateOverride = state;
    decodeCellVisual(input, output);
    const spectral = output.emissionStrength > 0
      ? evaluateSpectralColor(
          output.wavelengthNm,
          output.emissionStrength * 3.5 * look.emissionScale,
          look.exposure,
          undefined,
          look.outputSaturation,
        )
      : undefined;
    states.push({
      point: project(node * 3, spec.descriptor, spec),
      radius: (role === NODE_ROLE.core ? 4.5 : role === NODE_ROLE.junction ? 3.2 : role === NODE_ROLE.terminal ? 2.8 : 2.1) * output.thickness,
      connectivity: spec.state === 'lifecycle' ? Math.max(0.88, output.connectivity) : output.connectivity,
      emission: spectral ? rgbToCss(spectral.displayRgb) : undefined,
      emissionStrength: output.emissionStrength,
      baseTone: output.baseTone,
    });
  }
  return states;
}

function lookBase(look: SpectralLookName): { stroke: string; fill: string; opacity: number } {
  if (look === 'technical') return { stroke: '#34343a', fill: '#f8f8f6', opacity: 0.9 };
  if (look === 'ghost') {
    return { stroke: '#8a8a94', fill: '#f4f4f5', opacity: GHOST_PRIMARY_OPACITY };
  }
  return { stroke: '#65656c', fill: '#eeeeeb', opacity: 0.68 };
}

function renderOrganism(spec: RenderSpec): string {
  const nodes = nodeStates(spec);
  const base = lookBase(spec.look);
  const faces: Array<{ depth: number; svg: string }> = [];
  for (let face = 0; face < topology.faces.length / 3; face += 1) {
    const aNode = topology.faces[face * 3] ?? 0;
    const bNode = topology.faces[face * 3 + 1] ?? aNode;
    const cNode = topology.faces[face * 3 + 2] ?? aNode;
    if ((topology.nodeOrganism[aNode] ?? -1) !== spec.organismIndex) continue;
    const a = nodes[aNode - spec.descriptor.start];
    const b = nodes[bNode - spec.descriptor.start];
    const c = nodes[cNode - spec.descriptor.start];
    if (!a || !b || !c) continue;
    const connectivity = Math.min(a.connectivity, b.connectivity, c.connectivity);
    const centerX = (a.point.x + b.point.x + c.point.x) / 3;
    const centerY = (a.point.y + b.point.y + c.point.y) / 3;
    const point = (node: NodeRenderState) => {
      const x = centerX + (node.point.x - centerX) * connectivity;
      const y = centerY + (node.point.y - centerY) * connectivity;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    };
    const fill = spec.look === 'technical' ? '#f7f7f5' : '#dfe1e4';
    const opacity = spec.look === 'ghost'
      ? GHOST_MEMBRANE_OPACITY
      : spec.look === 'technical' ? 0.025 : 0.075;
    faces.push({
      depth: (a.point.depth + b.point.depth + c.point.depth) / 3,
      svg: `<polygon points="${point(a)} ${point(b)} ${point(c)}" fill="${fill}" stroke="${base.stroke}" stroke-width="0.45" opacity="${opacity.toFixed(3)}"/>`,
    });
  }
  const edges: Array<{ depth: number; svg: string }> = [];
  for (let edge = 0; edge < topology.edges.length / 2; edge += 1) {
    const startNode = topology.edges[edge * 2] ?? 0;
    const endNode = topology.edges[edge * 2 + 1] ?? startNode;
    if ((topology.nodeOrganism[startNode] ?? -1) !== spec.organismIndex) continue;
    const start = nodes[startNode - spec.descriptor.start];
    const end = nodes[endNode - spec.descriptor.start];
    if (!start || !end) continue;
    const connectivity = Math.min(start.connectivity, end.connectivity);
    const mx = (start.point.x + end.point.x) * 0.5;
    const my = (start.point.y + end.point.y) * 0.5;
    const sx = mx + (start.point.x - mx) * connectivity;
    const sy = my + (start.point.y - my) * connectivity;
    const ex = mx + (end.point.x - mx) * connectivity;
    const ey = my + (end.point.y - my) * connectivity;
    const kind = topology.edgeKind[edge] ?? EDGE_KIND.structure;
    const ribbon = kind === EDGE_KIND.ribbon || kind === EDGE_KIND.contour;
    const width = ribbon ? (spec.look === 'technical' ? 1.3 : 2.8) : 1.15;
    const dash = spec.look === 'technical' && kind === EDGE_KIND.contour ? ' stroke-dasharray="4 5"' : '';
    const emission = end.emissionStrength >= start.emissionStrength ? end.emission : start.emission;
    const emissionStrength = Math.max(start.emissionStrength, end.emissionStrength);
    const glow = emission && emissionStrength > 0
      ? `<line x1="${sx.toFixed(2)}" y1="${sy.toFixed(2)}" x2="${ex.toFixed(2)}" y2="${ey.toFixed(2)}" stroke="${emission}" stroke-width="${(width + 2.2).toFixed(1)}" stroke-linecap="round" opacity="${Math.min(0.96, 0.35 + emissionStrength * 0.55).toFixed(2)}" filter="url(#glow)"/>`
      : '';
    edges.push({
      depth: (start.point.depth + end.point.depth) * 0.5,
      svg: `<line x1="${sx.toFixed(2)}" y1="${sy.toFixed(2)}" x2="${ex.toFixed(2)}" y2="${ey.toFixed(2)}" stroke="${base.stroke}" stroke-width="${width}" stroke-linecap="round" opacity="${base.opacity}"${dash}/>${glow}`,
    });
  }

  const faceSvg = faces.sort((a, b) => a.depth - b.depth).map((face) => face.svg).join('');
  const edgeSvg = edges.sort((a, b) => a.depth - b.depth).map((edge) => edge.svg).join('');
  const nodeSvg = nodes
    .map((node) => {
      const neutral = Math.round(224 + node.baseTone * 25);
      const baseNode = `<circle cx="${node.point.x.toFixed(2)}" cy="${node.point.y.toFixed(2)}" r="${node.radius.toFixed(2)}" fill="rgb(${neutral} ${neutral} ${neutral})" stroke="${base.stroke}" stroke-width="${spec.look === 'technical' ? 1.1 : 0.65}" opacity="${base.opacity + 0.08}"/>`;
      const glow = node.emission
        ? `<circle cx="${node.point.x.toFixed(2)}" cy="${node.point.y.toFixed(2)}" r="${(node.radius * 1.38).toFixed(2)}" fill="${node.emission}" opacity="${Math.min(1, 0.38 + node.emissionStrength * 0.6).toFixed(2)}" filter="url(#glow)"/>`
        : '';
      return `${baseNode}${glow}`;
    })
    .join('');
  return `${faceSvg}${edgeSvg}${nodeSvg}`;
}

function documentShell(title: string, subtitle: string, body: string, footer: string): string {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <style>
    text { font-family: Helvetica, Arial, sans-serif; fill: #242428; }
    .title { font-size: 48px; font-weight: 500; letter-spacing: -2px; }
    .subtitle { font-size: 12px; letter-spacing: 2.2px; fill: #747479; }
    .label { font-size: 11px; letter-spacing: 1.6px; fill: #66666c; }
    .family { font-size: 24px; font-weight: 500; letter-spacing: -0.7px; }
    .body { font-size: 11px; fill: #66666c; }
    .card { fill: #fbfbf9; stroke: rgba(36,36,40,0.13); }
    .hair { stroke: rgba(36,36,40,0.16); }
  </style>
  <rect width="1536" height="1024" fill="#f7f7f5"/>
  <text x="72" y="66" class="subtitle">VECTOR SIM / P04 / DETERMINISTIC CAPTURE</text>
  <text x="72" y="119" class="title">${escapeXml(title)}</text>
  <text x="72" y="148" class="body">${escapeXml(subtitle)}</text>
  ${body}
  <line x1="72" y1="964" x2="1464" y2="964" class="hair"/>
  <text x="72" y="991" class="body">${escapeXml(footer)}</text>
  <text x="1464" y="991" text-anchor="end" class="label">SEED ${seed} / 1536 × 1024</text>
</svg>`;
}

function morphologySvg(): string {
  const cardWidth = 446;
  const gap = 22;
  const left = 72;
  const top = 182;
  const cards = topology.organisms.map((descriptor, index) => {
    const x = left + index * (cardWidth + gap);
    const spec: RenderSpec = {
      descriptor,
      organismIndex: index,
      x,
      y: top + 58,
      width: cardWidth,
      height: 454,
      look: 'porcelain',
      state: 'lifecycle',
      scale: descriptor.family === 'ribbon' ? 245 : descriptor.family === 'branching' ? 235 : 300,
    };
    return `
      <g>
        <rect x="${x}" y="${top}" width="${cardWidth}" height="562" rx="22" class="card"/>
        <text x="${x + 22}" y="${top + 34}" class="label">${descriptor.family.toUpperCase()} / ${descriptor.count} NODES</text>
        <text x="${x + 22}" y="${top + 65}" class="family">${descriptor.family === 'branching' ? 'Dendritic reach' : descriptor.family === 'ribbon' ? 'Calligraphic flow' : 'Radial shell'}</text>
        ${renderOrganism(spec)}
        <line x1="${x + 22}" y1="${top + 504}" x2="${x + cardWidth - 22}" y2="${top + 504}" class="hair"/>
        <text x="${x + 22}" y="${top + 530}" class="body">BLUE LIFE → WHITE REST → BLUE REPAIR → CORAL DAMAGE → RED DEATH</text>
      </g>`;
  }).join('');
  const lookLabels: Array<[SpectralLookName, string]> = [
    ['porcelain', 'PORCELAIN / SOLID WHITE'],
    ['technical', 'TECHNICAL / CONTOUR'],
    ['ghost', 'GHOST / TRANSLUCENT'],
  ];
  const looks = lookLabels.map(([look, label], index) => {
    const x = left + index * (cardWidth + gap);
    const descriptor = topology.organisms[2];
    if (!descriptor) return '';
    const spec: RenderSpec = {
      descriptor,
      organismIndex: 2,
      x,
      y: 790,
      width: cardWidth,
      height: 125,
      look,
      state: 'feeding',
      scale: 75,
    };
    return `<g><rect x="${x}" y="766" width="${cardWidth}" height="166" rx="18" class="card"/><text x="${x + 18}" y="794" class="label">${label}</text>${renderOrganism(spec)}</g>`;
  }).join('');
  return documentShell(
    '3D vector organism grammar',
    'One graph contract, three morphology families, localized causal emission, and fixed pooled geometry.',
    `${cards}${looks}`,
    'Points, edges, tapered ribbons, contour loops, junctions, terminals, gaps, and forward markers share one NCA decode.',
  );
}

function stateSvg(): string {
  const states: OrganismVisualState[] = [
    'dormant',
    'feeding',
    'starving',
    'damaged',
    'mutating',
    'dying',
    'death',
    'regenerating',
  ];
  const cardWidth = 330;
  const cardHeight = 350;
  const gapX = 24;
  const gapY = 24;
  const left = 72;
  const top = 182;
  const cards = states.map((state, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const x = left + column * (cardWidth + gapX);
    const y = top + row * (cardHeight + gapY);
    const organismIndex = index % topology.organisms.length;
    const descriptor = topology.organisms[organismIndex];
    if (!descriptor) return '';
    const spec: RenderSpec = {
      descriptor,
      organismIndex,
      x,
      y: y + 90,
      width: cardWidth,
      height: 220,
      look: 'porcelain',
      state,
      scale: descriptor.family === 'ribbon' ? 150 : descriptor.family === 'branching' ? 135 : 155,
    };
    const cue = state === 'dormant'
      ? 'white / stable'
      : state === 'feeding'
        ? 'blue / transfer wave'
        : state === 'starving'
          ? 'white / reduced thickness'
          : state === 'damaged'
            ? 'coral / fractured edges'
            : state === 'mutating'
              ? 'middle-band / local pulse'
              : state === 'dying'
                ? 'red approach / retraction'
                : state === 'death'
                  ? '620 nm / collapse'
                  : 'blue / outward reconnection';
    return `<g><rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="20" class="card"/><text x="${x + 20}" y="${y + 30}" class="label">${descriptor.family.toUpperCase()}</text><text x="${x + 20}" y="${y + 60}" class="family">${state}</text>${renderOrganism(spec)}<text x="${x + 20}" y="${y + 326}" class="body">${cue.toUpperCase()}</text></g>`;
  }).join('');
  return documentShell(
    'Lifecycle is color + form',
    'Each state changes topology, thickness, opacity, or direction—never hue alone.',
    cards,
    'Blue is life. Red is death. Damage approaches red but never owns the 620 nm endpoint.',
  );
}

interface RenderedReference {
  /** Digest of the drawing itself. Pure string output, so it is reproducible. */
  readonly sourceSha256: string;
  /** Digest of the raster. Host-dependent: see the note on `sources` below. */
  readonly pngSha256: string;
}

/**
 * The SVG source is the reproducible artifact. Rasterization resolves
 * `font-family` against host-installed fonts, so the label text — and therefore
 * the PNG bytes — differ between machines even when the drawing is identical.
 * Both digests are recorded: `sources` is the portable evidence baseline and
 * `files` pins the bytes actually committed here.
 *
 * The SVG itself lands in `.tmp/` rather than `assets/`: at ~800 KB each these
 * are build intermediates, and the digest is what carries the evidence. Compare
 * two hosts by regenerating and diffing the manifest — an unchanged `sources`
 * entry beside a changed `files` entry is font fallback, not a drawing change.
 */
async function render(svg: string, path: string): Promise<RenderedReference> {
  await mkdir(dirname(path), { recursive: true });
  await mkdir(resolve('.tmp/organism-reference'), { recursive: true });
  await writeFile(
    resolve('.tmp/organism-reference', basename(path).replace(/\.png$/, '.svg')),
    svg,
  );
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9, adaptiveFiltering: false }).toFile(path);
  const png = await readFile(path);
  return {
    sourceSha256: createHash('sha256').update(svg).digest('hex'),
    pngSha256: createHash('sha256').update(png).digest('hex'),
  };
}

const morphology = await render(morphologySvg(), morphologyPath);
const state = await render(stateSvg(), statePath);
const morphologySha256 = morphology.pngSha256;
const stateSha256 = state.pngSha256;
const manifest = {
  schema: 'vector-sim-organism-reference-v1',
  width,
  height,
  seed,
  families: topology.organisms.map((organism) => organism.family as MorphologyFamily),
  states: [
    'dormant',
    'feeding',
    'starving',
    'damaged',
    'mutating',
    'dying',
    'death',
    'regenerating',
  ],
  looks: ['porcelain', 'technical', 'ghost'],
  cameraDistances: ['overview', 'mid', 'macro'],
  captureRoute: '?organisms=1&seed=1397769539&tick=180&state=feeding&look=porcelain&distance=mid&nca=frozen',
  files: {
    'organism-morphology-reference.png': morphologySha256,
    'organism-state-reference.png': stateSha256,
  },
  sources: {
    'organism-morphology-reference.svg': morphology.sourceSha256,
    'organism-state-reference.svg': state.sourceSha256,
  },
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Generated P04 organism references (${morphologySha256}, ${stateSha256})\n`);
