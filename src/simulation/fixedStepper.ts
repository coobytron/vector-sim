import type { FrameAdvance } from './types';

export class FixedStepper {
  private accumulator = 0;
  private previousSeconds: number | undefined;

  constructor(
    readonly stepSeconds = 1 / 30,
    readonly maxCatchUpSteps = 4,
  ) {}

  reset(nowSeconds?: number): void {
    this.accumulator = 0;
    this.previousSeconds = nowSeconds;
  }

  advance(nowSeconds: number, step: (dt: number) => void): FrameAdvance {
    if (this.previousSeconds === undefined) {
      this.previousSeconds = nowSeconds;
      return { alpha: 0, droppedSeconds: 0, steps: 0 };
    }

    const rawDelta = Math.max(0, nowSeconds - this.previousSeconds);
    this.previousSeconds = nowSeconds;
    const maximumAccepted = this.stepSeconds * this.maxCatchUpSteps;
    const acceptedDelta = Math.min(rawDelta, maximumAccepted);
    const droppedSeconds = Math.max(0, rawDelta - acceptedDelta);
    this.accumulator += acceptedDelta;

    let steps = 0;
    while (this.accumulator >= this.stepSeconds && steps < this.maxCatchUpSteps) {
      step(this.stepSeconds);
      this.accumulator -= this.stepSeconds;
      steps += 1;
    }

    return {
      alpha: Math.min(1, this.accumulator / this.stepSeconds),
      droppedSeconds,
      steps,
    };
  }
}

