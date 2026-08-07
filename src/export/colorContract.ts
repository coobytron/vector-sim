import type { SpectralLookProfile } from '../spectral/looks';
import { DEFAULT_SPECTRAL_CHROMA_GAIN } from '../spectral/color';

export const OUTPUT_COLOR_CONTRACT = {
  workingSpace: 'Linear sRGB',
  emissionMixing: 'Linear light',
  toneMap: 'Three.js ACESFilmicToneMapping',
  outputTransfer: 'sRGB',
  outputEncodes: 1,
  bloomInput: 'HDR emissive geometry only',
  spectralChromaGain: DEFAULT_SPECTRAL_CHROMA_GAIN,
} as const;

export interface OutputCaptureDescriptor {
  contract: typeof OUTPUT_COLOR_CONTRACT;
  look: string;
  exposure: number;
  outputSaturation: number;
  source: 'post-tone-mapped-canvas';
}

export function describeOutputCapture(look: SpectralLookProfile): OutputCaptureDescriptor {
  return {
    contract: OUTPUT_COLOR_CONTRACT,
    look: look.name,
    exposure: look.exposure,
    outputSaturation: look.outputSaturation,
    source: 'post-tone-mapped-canvas',
  };
}

export function downloadCanvasPng(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('The rendered canvas could not be encoded as PNG.'));
        return;
      }
      const anchor = document.createElement('a');
      const url = URL.createObjectURL(blob);
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      resolve();
    }, 'image/png');
  });
}

export function createCanvasVideoStream(canvas: HTMLCanvasElement, framesPerSecond = 30): MediaStream {
  if (typeof canvas.captureStream !== 'function') {
    throw new Error('Canvas captureStream is unavailable in this browser.');
  }
  return canvas.captureStream(framesPerSecond);
}
