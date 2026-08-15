import { describe, expect, it } from 'vitest';

import { WebGlNcaRuntime } from '../src/nca';

class FakeGl {
  readonly TEXTURE_2D = 3553;
  readonly TEXTURE_MIN_FILTER = 10241;
  readonly TEXTURE_MAG_FILTER = 10240;
  readonly TEXTURE_WRAP_S = 10242;
  readonly TEXTURE_WRAP_T = 10243;
  readonly NEAREST = 9728;
  readonly CLAMP_TO_EDGE = 33071;
  readonly RGBA32F = 34836;
  readonly RGBA = 6408;
  readonly FLOAT = 5126;
  readonly FRAMEBUFFER = 36160;
  readonly COLOR_ATTACHMENT0 = 36064;
  readonly FRAMEBUFFER_COMPLETE = 36053;
  readonly VERTEX_SHADER = 35633;
  readonly FRAGMENT_SHADER = 35632;
  readonly COMPILE_STATUS = 35713;
  readonly LINK_STATUS = 35714;
  readonly TRIANGLES = 4;
  readonly TEXTURE0 = 33984;

  createTexture() { return {} as WebGLTexture; }
  bindTexture() {}
  texParameteri() {}
  texImage2D() {}
  texSubImage2D() {}
  createFramebuffer() { return {} as WebGLFramebuffer; }
  bindFramebuffer() {}
  framebufferTexture2D() {}
  checkFramebufferStatus() { return this.FRAMEBUFFER_COMPLETE; }
  createShader() { return {} as WebGLShader; }
  shaderSource() {}
  compileShader() {}
  getShaderParameter() { return true; }
  getShaderInfoLog() { return ''; }
  deleteShader() {}
  createProgram() { return {} as WebGLProgram; }
  attachShader() {}
  linkProgram() {}
  deleteProgram() {}
  getProgramParameter() { return true; }
  getProgramInfoLog() { return ''; }
  createVertexArray() { return {} as WebGLVertexArrayObject; }
  useProgram() {}
  bindVertexArray() {}
  viewport() {}
  activeTexture() {}
  getUniformLocation() { return {} as WebGLUniformLocation; }
  uniform1i() {}
  drawArrays() {}
  deleteFramebuffer() {}
  deleteTexture() {}
  deleteVertexArray() {}
}

const checkpoint = {
  manifest: { dtype: 'float32' },
} as never;

describe('WebGlNcaRuntime contract', () => {
  it('rejects invalid node counts', () => {
    expect(() => new WebGlNcaRuntime({ gl: new FakeGl() as never, checkpoint, nodeCount: 0 })).toThrow(/nodeCount/);
  });

  it('supports pause, forced single-step, seed, lesion, and telemetry', () => {
    const runtime = new WebGlNcaRuntime({ gl: new FakeGl() as never, checkpoint, nodeCount: 4 });
    runtime.seed(new Float32Array([1, 2, 3, 4]));
    runtime.setPaused(true);
    expect(runtime.step()).toBe(false);
    runtime.singleStep();
    expect(runtime.telemetry.steps).toBe(1);
    runtime.lesion([0, 3, -1, 99]);
    runtime.reset(new Float32Array([0, 0, 0, 0]));
    expect(runtime.telemetry.steps).toBe(0);
    runtime.dispose();
  });
});
