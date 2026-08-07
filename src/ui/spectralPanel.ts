import {
  evaluateSpectralColor,
  formatRgb,
  LIFE_WAVELENGTH_NM,
  rgbToCss,
  SPECTRAL_CLAMP_MAX_NM,
  SPECTRAL_CLAMP_MIN_NM,
  type SpectralColorSample,
} from '../spectral/color';
import type { SpectralLookProfile } from '../spectral/looks';

export interface SpectralPanelController {
  setLook(look: SpectralLookProfile): void;
  dispose(): void;
}

export function createSpectralPanel(
  parent: HTMLElement,
  initialLook: SpectralLookProfile,
  onSample: (sample: SpectralColorSample) => void,
  onExposure: (exposure: number) => void,
): SpectralPanelController {
  let currentLook = initialLook;
  const panel = document.createElement('aside');
  panel.className = 'spectral-panel';
  panel.innerHTML = `
    <div class="spectral-panel__heading">
      <div>
        <p class="eyebrow">Linear-light probe</p>
        <h2>Spectral calibration</h2>
      </div>
      <span class="spectral-chip" data-spectral-chip aria-hidden="true"></span>
    </div>
    <label class="spectral-slider">
      <span>Wavelength <output data-wavelength-output>${LIFE_WAVELENGTH_NM} nm</output></span>
      <input type="range" min="${SPECTRAL_CLAMP_MIN_NM}" max="${SPECTRAL_CLAMP_MAX_NM}" step="1" value="${LIFE_WAVELENGTH_NM}" data-wavelength>
    </label>
    <label class="spectral-slider">
      <span>Intensity <output data-intensity-output>2.50×</output></span>
      <input type="range" min="0" max="10" step="0.05" value="2.5" data-intensity>
    </label>
    <label class="spectral-slider">
      <span>Exposure <output data-exposure-output>${initialLook.exposure.toFixed(2)}</output></span>
      <input type="range" min="0.4" max="1.4" step="0.01" value="${initialLook.exposure}" data-exposure>
    </label>
    <dl class="spectral-values">
      <div><dt>Linear RGB</dt><dd data-linear-rgb>—</dd></div>
      <div><dt>Display RGB</dt><dd data-display-rgb>—</dd></div>
      <div><dt>Tone map</dt><dd>ACES filmic</dd></div>
      <div><dt>Output</dt><dd>sRGB · once</dd></div>
    </dl>
    <p class="spectral-stage">CIE fit → 1.18× chroma → linear bloom → saturation → ACES → sRGB</p>
    <div class="semantic-key" aria-label="Semantic event key">
      <span>${LIFE_WAVELENGTH_NM} nm / life</span><span>${SPECTRAL_CLAMP_MAX_NM} nm / death</span>
      <span>Feed / directed</span><span>Hazard / held</span><span>Damage / fracture</span>
      <span>Regen / outward</span><span>Mutation / pulse</span><span>Death / collapse</span>
    </div>
  `;
  parent.append(panel);

  const wavelength = panel.querySelector<HTMLInputElement>('[data-wavelength]');
  const intensity = panel.querySelector<HTMLInputElement>('[data-intensity]');
  const exposure = panel.querySelector<HTMLInputElement>('[data-exposure]');
  const wavelengthOutput = panel.querySelector<HTMLOutputElement>('[data-wavelength-output]');
  const intensityOutput = panel.querySelector<HTMLOutputElement>('[data-intensity-output]');
  const exposureOutput = panel.querySelector<HTMLOutputElement>('[data-exposure-output]');
  const linearOutput = panel.querySelector<HTMLElement>('[data-linear-rgb]');
  const displayOutput = panel.querySelector<HTMLElement>('[data-display-rgb]');
  const chip = panel.querySelector<HTMLElement>('[data-spectral-chip]');
  if (
    !wavelength ||
    !intensity ||
    !exposure ||
    !wavelengthOutput ||
    !intensityOutput ||
    !exposureOutput ||
    !linearOutput ||
    !displayOutput ||
    !chip
  ) {
    throw new Error('Spectral calibration panel is incomplete.');
  }

  const update = (): void => {
    const sample = evaluateSpectralColor(
      Number(wavelength.value),
      Number(intensity.value),
      Number(exposure.value),
      undefined,
      currentLook.outputSaturation,
    );
    wavelengthOutput.value = `${sample.wavelengthNm.toFixed(0)} nm`;
    intensityOutput.value = `${sample.intensity.toFixed(2)}×`;
    exposureOutput.value = sample.exposure.toFixed(2);
    linearOutput.textContent = formatRgb(sample.linearRgb);
    displayOutput.textContent = formatRgb(sample.displayRgb);
    chip.style.background = rgbToCss(sample.displayRgb);
    onExposure(sample.exposure);
    onSample(sample);
  };

  wavelength.addEventListener('input', update);
  intensity.addEventListener('input', update);
  exposure.addEventListener('input', update);
  update();

  return {
    setLook(look: SpectralLookProfile): void {
      currentLook = look;
      exposure.value = String(look.exposure);
      update();
    },
    dispose(): void {
      panel.remove();
    },
  };
}
