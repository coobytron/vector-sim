import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const failures = [];
const required = [
  'src/spectral/color.ts',
  'src/spectral/events.ts',
  'src/spectral/looks.ts',
  'src/rendering/spectralPostProcessor.ts',
  'src/rendering/spectralCalibrationScene.ts',
  'src/rendering/homeSpectralEmitters.ts',
  'src/export/colorContract.ts',
  'src/ui/spectralPanel.ts',
  'tests/spectralColor.test.ts',
  'tests/spectralEvents.test.ts',
  'tests/outputColorContract.test.ts',
  'scripts/generate-spectral-reference.ts',
  'docs/P03-SPECTRAL-COLOR.md',
  'docs/adr/0002-linear-spectral-output.md',
  'assets/reference/spectral-calibration-reference.png',
  'assets/reference/spectral-calibration-reference.json',
];

for (const path of required) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) failures.push(`Missing P03 file: ${path}`);
  else if (statSync(absolute).size === 0) failures.push(`Empty P03 file: ${path}`);
}

const read = (path) => readFileSync(resolve(root, path), 'utf8');
const color = read('src/spectral/color.ts');
for (const term of [
  'wavelengthToXyz',
  'xyzToLinearSrgb',
  'gamutMapSpectralRgb',
  'SPECTRAL_CLAMP_MIN_NM = 470',
  'SPECTRAL_CLAMP_MAX_NM = 620',
  'lifeDeathToWavelength',
  'DEFAULT_SPECTRAL_CHROMA_GAIN = 1.18',
  'DEFAULT_OUTPUT_SATURATION = 0.14',
  'boostSpectralChroma',
  'adjustLinearSaturation',
  'spectralEmissionLinear',
  'acesFilmicToneMap',
  'linearToSrgb',
  'srgbToLinear',
]) {
  if (!color.includes(term)) failures.push(`Spectral core is missing: ${term}`);
}

const post = read('src/rendering/spectralPostProcessor.ts');
for (const term of [
  'THREE.LinearSRGBColorSpace',
  'THREE.SRGBColorSpace',
  'THREE.ACESFilmicToneMapping',
  'UnrealBloomPass',
  'HueSaturationShader',
  'OutputPass',
]) {
  if (!post.includes(term)) failures.push(`Post-processing contract is missing: ${term}`);
}

const output = read('src/export/colorContract.ts');
for (const term of ['outputEncodes: 1', "source: 'post-tone-mapped-canvas'", 'captureStream']) {
  if (!output.includes(term)) failures.push(`Output color contract is missing: ${term}`);
}

const events = read('src/spectral/events.ts');
for (const event of ['feeding', 'hazard', 'damage', 'regeneration', 'mutation', 'death']) {
  if (!events.includes(`'${event}'`)) failures.push(`Semantic spectral event is missing: ${event}`);
}

const manifest = JSON.parse(read('assets/reference/spectral-calibration-reference.json'));
if (manifest.schema !== 'vector-sim-spectral-reference-v3') {
  failures.push('Unexpected spectral reference schema.');
}
if (manifest.width !== 1536 || manifest.height !== 1024) {
  failures.push('Spectral reference must remain 1536×1024.');
}
if (manifest.outputEncodes !== 1 || manifest.outputTransfer !== 'sRGB') {
  failures.push('Spectral reference must record exactly one sRGB output transfer.');
}
if (
  manifest.wavelengthRangeNm?.[0] !== 470 ||
  manifest.wavelengthRangeNm?.[1] !== 620 ||
  manifest.semanticAnchorsNm?.life !== 470 ||
  manifest.semanticAnchorsNm?.death !== 620
) {
  failures.push('Spectral reference must clamp 470 nm life to 620 nm death.');
}
if (manifest.spectralChromaGain !== 1.18 || manifest.outputSaturation !== 0.14) {
  failures.push('Spectral reference must record the approved richer-color grade.');
}
const png = readFileSync(resolve(root, 'assets/reference/spectral-calibration-reference.png'));
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
if (width !== manifest.width || height !== manifest.height) {
  failures.push(`Spectral PNG dimensions ${width}×${height} do not match its manifest.`);
}
const sha256 = createHash('sha256').update(png).digest('hex');
if (sha256 !== manifest.sha256) failures.push('Spectral PNG digest does not match its manifest.');

const decisions = read('docs/DECISIONS.md');
for (const term of ['D012 | Accepted — P03', 'ACES filmic', 'one final sRGB transfer']) {
  if (!decisions.includes(term)) failures.push(`P03 decision log is missing: ${term}`);
}

const documentation = read('docs/P03-SPECTRAL-COLOR.md');
for (const term of [
  '470–620 nm',
  'Blue is life',
  'Red is death',
  'Live, PNG, and video agreement',
  'at most 1/255',
  'Linear RGB',
  'Display RGB',
  '1.18×',
  '+0.14',
]) {
  if (!documentation.includes(term)) failures.push(`P03 documentation is missing: ${term}`);
}

const packageJson = JSON.parse(read('package.json'));
for (const script of ['capture:spectral', 'validate:p03', 'qa']) {
  if (!packageJson.scripts?.[script]) failures.push(`Missing npm script: ${script}`);
}

if (failures.length > 0) {
  console.error('\nP03 validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('P03 linear-light spectral color package is structurally valid.');
