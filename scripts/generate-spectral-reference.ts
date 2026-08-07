import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import { evaluateSpectralColor, rgbToCss } from '../src/spectral/color';
import { sampleSpectralEvent, type SpectralEvent } from '../src/spectral/events';

const width = 1536;
const height = 1024;
const outputPath = resolve('assets/reference/spectral-calibration-reference.png');
const manifestPath = resolve('assets/reference/spectral-calibration-reference.json');
const events: SpectralEvent[] = [
  'feeding',
  'hazard',
  'damage',
  'regeneration',
  'mutation',
  'death',
];

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

function wavelengthBand(): string {
  const segments = 100;
  const left = 88;
  const top = 188;
  const bandWidth = width - left * 2;
  const segmentWidth = bandWidth / segments;
  const rectangles = Array.from({ length: segments }, (_, index) => {
    const amount = index / (segments - 1);
    const wavelength = 380 + amount * 400;
    const sample = evaluateSpectralColor(wavelength, 2.4, 0.86);
    return `<rect x="${(left + index * segmentWidth).toFixed(2)}" y="${top}" width="${(segmentWidth + 0.5).toFixed(2)}" height="72" fill="${rgbToCss(sample.displayRgb)}"/>`;
  }).join('');
  const ticks = [380, 420, 460, 500, 540, 580, 620, 660, 700, 740, 780]
    .map((wavelength) => {
      const x = left + ((wavelength - 380) / 400) * bandWidth;
      return `<line x1="${x}" y1="268" x2="${x}" y2="278" class="hair"/><text x="${x}" y="300" text-anchor="middle" class="micro">${wavelength}</text>`;
    })
    .join('');
  return `${rectangles}<rect x="${left}" y="${top}" width="${bandWidth}" height="72" rx="8" fill="none" class="outline"/>${ticks}`;
}

function intensityCards(): string {
  const strengths = [0.25, 0.5, 1, 2, 4, 8];
  const left = 88;
  const gap = 18;
  const cardWidth = (width - left * 2 - gap * (strengths.length - 1)) / strengths.length;
  return strengths
    .map((intensity, index) => {
      const sample = evaluateSpectralColor(510, intensity, 0.86);
      const x = left + index * (cardWidth + gap);
      const display = `${sample.displayRgb.r.toFixed(3)} ${sample.displayRgb.g.toFixed(3)} ${sample.displayRgb.b.toFixed(3)}`;
      return `
        <g transform="translate(${x} 378)">
          <rect width="${cardWidth}" height="132" rx="15" class="card"/>
          <circle cx="38" cy="42" r="20" fill="${rgbToCss(sample.displayRgb)}"/>
          <text x="70" y="39" class="card-title">${intensity.toFixed(2)}×</text>
          <text x="70" y="58" class="micro">510 NM / ACES</text>
          <text x="20" y="101" class="mono">${display}</text>
        </g>`;
    })
    .join('');
}

function semanticCards(): string {
  const left = 88;
  const gap = 18;
  const cardWidth = (width - left * 2 - gap * (events.length - 1)) / events.length;
  return events
    .map((event, index) => {
      const semantic = sampleSpectralEvent(event, 0.42);
      const sample = evaluateSpectralColor(semantic.wavelengthNm, semantic.intensityScale * 2.8, 0.86);
      const x = left + index * (cardWidth + gap);
      const hue = rgbToCss(sample.displayRgb);
      return `
        <g transform="translate(${x} 610)">
          <rect width="${cardWidth}" height="190" rx="15" class="card"/>
          <path d="M22 66 C58 30 112 102 ${cardWidth - 22} 52" fill="none" stroke="${hue}" stroke-width="7" stroke-linecap="round"/>
          <circle cx="22" cy="66" r="7" fill="${hue}"/>
          <circle cx="${cardWidth - 22}" cy="52" r="7" fill="${hue}"/>
          <text x="20" y="118" class="card-title">${event.toUpperCase()}</text>
          <text x="20" y="140" class="micro">${escapeXml(semantic.motion)}</text>
          <text x="20" y="165" class="body-small">${escapeXml(semantic.formCue)}</text>
        </g>`;
    })
    .join('');
}

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    text { font-family: Helvetica, Arial, sans-serif; fill: #242428; }
    .title { font-size: 52px; font-weight: 500; letter-spacing: -2.4px; }
    .subtitle { font-size: 13px; letter-spacing: 2.2px; fill: #747479; }
    .section { font-size: 12px; letter-spacing: 2px; fill: #747479; }
    .micro { font-size: 10px; letter-spacing: 1px; fill: #77777c; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9px; fill: #5f5f64; }
    .card-title { font-size: 17px; font-weight: 500; letter-spacing: -0.2px; }
    .body-small { font-size: 10px; fill: #55555b; }
    .card { fill: #fbfbf9; stroke: rgba(36,36,40,0.13); }
    .outline { stroke: rgba(36,36,40,0.15); }
    .hair { stroke: rgba(36,36,40,0.25); }
  </style>
  <rect width="1536" height="1024" fill="#f7f7f5"/>
  <text x="88" y="82" class="subtitle">VECTOR SIM / P03 / REFERENCE CAPTURE</text>
  <text x="88" y="139" class="title">Spectral color calibration</text>
  <text x="1448" y="98" text-anchor="end" class="micro">LINEAR sRGB → ACES → sRGB</text>
  <text x="88" y="174" class="section">WAVELENGTH / 380–780 NM / INTENSITY 2.4× / EXPOSURE 0.86</text>
  ${wavelengthBand()}
  <text x="88" y="352" class="section">HIGHLIGHT ROLLOFF / 510 NM / NEUTRAL WHITE SATURATION ABOVE 3.25×</text>
  ${intensityCards()}
  <text x="88" y="582" class="section">SEMANTIC SYSTEM / COLOR + MOTION + FORM</text>
  ${semanticCards()}
  <line x1="88" y1="856" x2="1448" y2="856" class="hair"/>
  <text x="88" y="898" class="section">OUTPUT CONTRACT</text>
  <text x="88" y="930" class="body-small">CIE 1931 analytic fit → spectral gamut map → HDR linear emission and bloom → ACES filmic tone map → one sRGB transfer.</text>
  <text x="88" y="958" class="body-small">Idle architecture remains neutral. Saturated color is limited to a named source, path, boundary, or graph-state transition.</text>
  <text x="1448" y="958" text-anchor="end" class="micro">1536 × 1024 / DETERMINISTIC</text>
</svg>`;

await mkdir(dirname(outputPath), { recursive: true });
await sharp(Buffer.from(svg)).png({ compressionLevel: 9, adaptiveFiltering: false }).toFile(outputPath);
const png = await readFile(outputPath);
const sha256 = createHash('sha256').update(png).digest('hex');
const manifest = {
  schema: 'vector-sim-spectral-reference-v1',
  width,
  height,
  sha256,
  wavelengthRangeNm: [380, 780],
  exposure: 0.86,
  toneMap: 'Three.js ACESFilmicToneMapping',
  outputTransfer: 'sRGB',
  outputEncodes: 1,
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated ${outputPath} (${sha256})`);
