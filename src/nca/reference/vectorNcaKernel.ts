import { CheckpointValidationError } from '../checkpoint/types';
import type { CheckpointTensor, LoadedCheckpoint } from '../checkpoint/types';

/**
 * Deterministic CPU reference for `vector_nca_mlp_v1`.
 *
 * Mirrors `training/vector_nca/core.py::VectorNCA.forward`:
 *
 * ```text
 * neighbor = roll(latent, shifts=1, dims=0)   # neighbor[i] = latent[i-1]
 * delta    = tanh(W2 · tanh(W1 · [latent, neighbor, sensors] + b1) + b2)
 * latent'  = latent + delta × updateRate
 * ```
 *
 * The rolled neighbor is P05a's deliberately simple stand-in for the final
 * graph neighborhood operator. It is part of the architecture identity, so the
 * reference reproduces it exactly rather than improving on it.
 *
 * Pure arithmetic on typed arrays: no Three.js, DOM, or GPU dependency.
 */
export class VectorNcaReferenceKernel {
  readonly latentChannels: number;
  readonly sensorChannels: number;
  readonly hiddenWidth: number;
  readonly inputWidth: number;
  readonly updateRate: number;

  private readonly hiddenWeights: Float32Array;
  private readonly hiddenBias: Float32Array;
  private readonly outputWeights: Float32Array;
  private readonly outputBias: Float32Array;
  private readonly inputScratch: Float32Array;
  private readonly hiddenScratch: Float32Array;

  constructor(checkpoint: LoadedCheckpoint) {
    if (checkpoint.architecture !== 'vector_nca_mlp_v1') {
      throw new CheckpointValidationError(
        'architecture',
        `reference kernel cannot execute ${checkpoint.architecture}`,
      );
    }

    this.latentChannels = checkpoint.latentChannels;
    this.sensorChannels = checkpoint.sensorChannels;
    this.hiddenWidth = checkpoint.hiddenWidth;
    this.inputWidth = this.latentChannels * 2 + this.sensorChannels;
    this.updateRate = checkpoint.updateRate;

    const tensor = (name: string): Float32Array =>
      (checkpoint.tensors[name] as CheckpointTensor).data;
    this.hiddenWeights = tensor('net.0.weight');
    this.hiddenBias = tensor('net.0.bias');
    this.outputWeights = tensor('net.2.weight');
    this.outputBias = tensor('net.2.bias');

    this.inputScratch = new Float32Array(this.inputWidth);
    this.hiddenScratch = new Float32Array(this.hiddenWidth);
  }

  /**
   * Advances every node one step. `latent` is `nodes × latentChannels` and
   * `sensors` is `nodes × sensorChannels`, both row-major.
   *
   * Reads the whole of `latent` before writing `out`, so passing the same array
   * for both is safe only when `out !== latent`; the runtime keeps two buffers.
   */
  step(latent: Float32Array, sensors: Float32Array, nodes: number, out: Float32Array): void {
    const { latentChannels, sensorChannels, hiddenWidth, inputWidth } = this;

    for (let node = 0; node < nodes; node += 1) {
      const latentOffset = node * latentChannels;
      const neighborOffset = ((node - 1 + nodes) % nodes) * latentChannels;
      const sensorOffset = node * sensorChannels;

      for (let channel = 0; channel < latentChannels; channel += 1) {
        this.inputScratch[channel] = latent[latentOffset + channel] as number;
        this.inputScratch[latentChannels + channel] = latent[neighborOffset + channel] as number;
      }
      for (let channel = 0; channel < sensorChannels; channel += 1) {
        this.inputScratch[latentChannels * 2 + channel] = sensors[sensorOffset + channel] as number;
      }

      for (let hidden = 0; hidden < hiddenWidth; hidden += 1) {
        let total = this.hiddenBias[hidden] as number;
        const weightOffset = hidden * inputWidth;
        for (let input = 0; input < inputWidth; input += 1) {
          total += (this.hiddenWeights[weightOffset + input] as number) * (this.inputScratch[input] as number);
        }
        this.hiddenScratch[hidden] = Math.tanh(total);
      }

      for (let channel = 0; channel < latentChannels; channel += 1) {
        let total = this.outputBias[channel] as number;
        const weightOffset = channel * hiddenWidth;
        for (let hidden = 0; hidden < hiddenWidth; hidden += 1) {
          total += (this.outputWeights[weightOffset + hidden] as number) * (this.hiddenScratch[hidden] as number);
        }
        const delta = Math.tanh(total);
        out[latentOffset + channel] =
          (latent[latentOffset + channel] as number) + delta * this.updateRate;
      }
    }
  }
}
