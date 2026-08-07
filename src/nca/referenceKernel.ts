import { SeededRandom } from '../simulation/prng';
import referenceFixture from './models/reference-fixture-v1.json';

export interface KernelOutputs {
  latentDelta: Float32Array;
  acceleration: Float32Array;
}

export class ReferenceNcaKernel {
  readonly inputWidth: number;
  readonly hiddenWidth: number;
  readonly outputWidth: number;

  private readonly hiddenWeights: Float32Array;
  private readonly hiddenBias: Float32Array;
  private readonly outputWeights: Float32Array;
  private readonly outputBias: Float32Array;
  private readonly hiddenScratch: Float32Array;
  private readonly inputScratch: Float32Array;
  private readonly outputScratch: Float32Array;

  constructor(
    readonly channels = referenceFixture.channels,
    hiddenWidth = referenceFixture.hiddenWidth,
    seed = referenceFixture.weightSeed,
  ) {
    this.inputWidth = channels * 2 + 4;
    this.hiddenWidth = hiddenWidth;
    this.outputWidth = channels + 3;

    this.hiddenWeights = new Float32Array(this.hiddenWidth * this.inputWidth);
    this.hiddenBias = new Float32Array(this.hiddenWidth);
    this.outputWeights = new Float32Array(this.outputWidth * this.hiddenWidth);
    this.outputBias = new Float32Array(this.outputWidth);
    this.hiddenScratch = new Float32Array(this.hiddenWidth);
    this.inputScratch = new Float32Array(this.inputWidth);
    this.outputScratch = new Float32Array(this.outputWidth);

    const random = new SeededRandom(seed);
    const hiddenScale = Math.sqrt(2 / this.inputWidth) * 0.4;
    const outputScale = Math.sqrt(2 / this.hiddenWidth) * 0.22;
    for (let index = 0; index < this.hiddenWeights.length; index += 1) {
      this.hiddenWeights[index] = random.signed() * hiddenScale;
    }
    for (let index = 0; index < this.outputWeights.length; index += 1) {
      this.outputWeights[index] = random.signed() * outputScale;
    }
  }

  evaluate(
    latent: Float32Array,
    latentOffset: number,
    neighborLatent: Float32Array,
    neighborOffset: number,
    energy: number,
    health: number,
    food: number,
    kill: number,
    outputs: KernelOutputs,
  ): void {
    for (let channel = 0; channel < this.channels; channel += 1) {
      this.inputScratch[channel] = latent[latentOffset + channel] ?? 0;
      this.inputScratch[this.channels + channel] = neighborLatent[neighborOffset + channel] ?? 0;
    }
    this.inputScratch[this.channels * 2] = energy;
    this.inputScratch[this.channels * 2 + 1] = health;
    this.inputScratch[this.channels * 2 + 2] = food;
    this.inputScratch[this.channels * 2 + 3] = kill;

    for (let hidden = 0; hidden < this.hiddenWidth; hidden += 1) {
      let total = this.hiddenBias[hidden] ?? 0;
      const weightOffset = hidden * this.inputWidth;
      for (let input = 0; input < this.inputWidth; input += 1) {
        total += (this.hiddenWeights[weightOffset + input] ?? 0) * (this.inputScratch[input] ?? 0);
      }
      this.hiddenScratch[hidden] = Math.tanh(total);
    }

    for (let output = 0; output < this.outputWidth; output += 1) {
      let total = this.outputBias[output] ?? 0;
      const weightOffset = output * this.hiddenWidth;
      for (let hidden = 0; hidden < this.hiddenWidth; hidden += 1) {
        total += (this.outputWeights[weightOffset + hidden] ?? 0) * (this.hiddenScratch[hidden] ?? 0);
      }
      this.outputScratch[output] = Math.tanh(total);
    }

    for (let channel = 0; channel < this.channels; channel += 1) {
      outputs.latentDelta[channel] = (this.outputScratch[channel] ?? 0) * 0.1;
    }
    outputs.acceleration[0] = (this.outputScratch[this.channels] ?? 0) * 0.12;
    outputs.acceleration[1] = (this.outputScratch[this.channels + 1] ?? 0) * 0.12;
    outputs.acceleration[2] = (this.outputScratch[this.channels + 2] ?? 0) * 0.12;
  }
}
