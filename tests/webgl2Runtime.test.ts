import { describe, expect, it } from 'vitest';
import fixture from '../src/nca/models/p06a-reference-checkpoint.json';
import {
  WebGlNcaRuntime,
  loadBrowserCheckpoint,
} from '../src/nca';
import type { BrowserCheckpointContainer } from '../src/nca';

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
  readonly MAX_TEXTURE_SIZE = 3379;

  shaderSources: string[] = [];
  textureUploads = 0;
  drawCalls = 0;

  createTexture() { return {} as WebGLTexture; }
  bindTexture() {}
  texParameteri() {}
  texImage2D() {}
  texSubImage2D() { this.textureUploads += 1; }
  createFramebuffer() { return {} as WebGLFramebuffer; }
  bindFramebuffer() {}
  framebufferTexture2D() {}
  checkFramebufferStatus() { return this.FRAMEBUFFER_COMPLETE; }
  createShader() { return {} as WebGLShader; }
  shaderSource(_shader: WebGLShader, source: string) { this.shaderSources.push(source); }
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
  drawArrays() { this.drawCalls += 1; }
  deleteFramebuffer() {}
  deleteTexture() {}
  deleteVertexArray() {}
  getParameter() { return 16_384; }
  getExtension() { return {}; }
}

const checkpoint = loadBrowserCheckpoint(
  fixture as unknown as BrowserCheckpointContainer,
);
const NODES = 4;

function state(): Float32Array {
  return Float32Array.from(
    { length: NODES * checkpoint.latentChannels },
    (_unused, index) => Math.sin(index * 0.1),
  );
}

function sensors(): Float32Array {
  return Float32Array.from(
    { length: NODES * checkpoint.sensorChannels },
    (_unused, index) => Math.cos(index * 0.2),
  );
}

describe('WebGlNcaRuntime contract', () => {
  it('rejects invalid node counts', () => {
    expect(
      () => new WebGlNcaRuntime({ gl: new FakeGl() as never, checkpoint, nodeCount: 0 }),
    ).toThrow(/nodeCount/);
  });

  it('rejects seeds and sensors that do not cover every channel', () => {
    const runtime = new WebGlNcaRuntime({
      gl: new FakeGl() as never,
      checkpoint,
      nodeCount: NODES,
    });
    expect(() => runtime.seed(new Float32Array(NODES * 4))).toThrow(/latentChannels/);
    expect(() => runtime.setSensors(new Float32Array(NODES))).toThrow(/sensorChannels/);
    runtime.dispose();
  });

  it('compiles the MLP shader and supports state controls without readback', () => {
    const gl = new FakeGl();
    const runtime = new WebGlNcaRuntime({
      gl: gl as never,
      checkpoint,
      nodeCount: NODES,
    });

    expect(gl.shaderSources.some((source) => source.includes('HIDDEN_WIDTH = 64'))).toBe(true);
    expect(gl.shaderSources.some((source) => source.includes('hiddenWeightAt'))).toBe(true);

    runtime.seed(state());
    runtime.setSensors(sensors());
    runtime.setPaused(true);
    expect(runtime.step()).toBe(false);
    runtime.singleStep();
    expect(runtime.telemetry.steps).toBe(1);
    expect(gl.drawCalls).toBe(1);

    const uploadsBeforeLesion = gl.textureUploads;
    runtime.lesion([0, 3, -1, 99]);
    expect(gl.textureUploads - uploadsBeforeLesion).toBe(
      2 * runtime.layout.stateBlocks,
    );

    runtime.reset(new Float32Array(NODES * checkpoint.latentChannels));
    expect(runtime.telemetry.steps).toBe(0);
    runtime.dispose();
  });
});
