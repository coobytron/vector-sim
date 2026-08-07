import type { QualityTier } from '../simulation/types';
import pingPongFragment from '../rendering/shaders/benchmark-pingpong.frag.glsl?raw';
import transformFeedbackVertex from '../rendering/shaders/benchmark-transform-feedback.vert.glsl?raw';
import emptyFragment from '../rendering/shaders/empty.frag.glsl?raw';
import fullscreenVertex from '../rendering/shaders/fullscreen.vert.glsl?raw';
import { summarize, type DistributionSummary } from './statistics';

export interface GpuProbeResult {
  candidate: 'webgl2-ping-pong' | 'webgl2-transform-feedback';
  supported: boolean;
  workload: string;
  samples?: DistributionSummary;
  reason?: string;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to allocate WebGL shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'Unknown shader compile error';
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function link(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  varyings?: string[],
): WebGLProgram {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to allocate WebGL program.');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  if (varyings) gl.transformFeedbackVaryings(program, varyings, gl.INTERLEAVED_ATTRIBS);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'Unknown program link error';
    gl.deleteProgram(program);
    throw new Error(log);
  }
  return program;
}

function createContext(): WebGL2RenderingContext | null {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 16;
  return canvas.getContext('webgl2', {
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
}

function pingPongProbe(tier: QualityTier): GpuProbeResult {
  const gl = createContext();
  const workload = `${tier.organisms * tier.slotsPerOrganism} cells × 6 RGBA32F passes (24-channel proxy)`;
  if (!gl) return { candidate: 'webgl2-ping-pong', supported: false, workload, reason: 'WebGL2 unavailable' };
  if (!gl.getExtension('EXT_color_buffer_float')) {
    return {
      candidate: 'webgl2-ping-pong',
      supported: false,
      workload,
      reason: 'EXT_color_buffer_float unavailable',
    };
  }

  try {
    const width = 256;
    const nodes = tier.organisms * tier.slotsPerOrganism;
    const height = Math.ceil(nodes / width);
    gl.canvas.width = width;
    gl.canvas.height = height;
    gl.viewport(0, 0, width, height);

    const program = link(
      gl,
      fullscreenVertex,
      pingPongFragment,
    );
    const vao = gl.createVertexArray();
    const framebuffer = gl.createFramebuffer();
    const textures = [gl.createTexture(), gl.createTexture()];
    if (!vao || !framebuffer || !textures[0] || !textures[1]) throw new Error('GPU allocation failed.');
    const initial = new Float32Array(width * height * 4);
    for (let index = 0; index < initial.length; index += 1) initial[index] = (index % 17) / 17;
    for (const texture of textures) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, initial);
    }
    gl.bindVertexArray(vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'uState'), 0);

    let source = 0;
    const run = (): void => {
      for (let pass = 0; pass < 6; pass += 1) {
        const target = 1 - source;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, textures[source] ?? null);
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_2D,
          textures[target] ?? null,
          0,
        );
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        source = target;
      }
    };
    for (let warmup = 0; warmup < 12; warmup += 1) run();
    gl.finish();
    const samples: number[] = [];
    for (let sample = 0; sample < 60; sample += 1) {
      const start = performance.now();
      run();
      gl.finish();
      samples.push(performance.now() - start);
    }

    for (const texture of textures) gl.deleteTexture(texture);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { candidate: 'webgl2-ping-pong', supported: true, workload, samples: summarize(samples) };
  } catch (error) {
    return {
      candidate: 'webgl2-ping-pong',
      supported: false,
      workload,
      reason: error instanceof Error ? error.message : 'Unknown probe error',
    };
  }
}

function transformFeedbackProbe(tier: QualityTier): GpuProbeResult {
  const gl = createContext();
  const nodes = tier.organisms * tier.slotsPerOrganism;
  const vertexCount = nodes * 6;
  const workload = `${nodes} cells × 6 vec4 records (24-channel proxy)`;
  if (!gl) {
    return { candidate: 'webgl2-transform-feedback', supported: false, workload, reason: 'WebGL2 unavailable' };
  }

  try {
    const program = link(
      gl,
      transformFeedbackVertex,
      emptyFragment,
      ['nextState'],
    );
    const location = gl.getAttribLocation(program, 'state');
    const buffers = [gl.createBuffer(), gl.createBuffer()];
    const feedback = gl.createTransformFeedback();
    if (!buffers[0] || !buffers[1] || !feedback) throw new Error('Transform-feedback allocation failed.');
    const initial = new Float32Array(vertexCount * 4);
    for (let index = 0; index < initial.length; index += 1) initial[index] = (index % 19) / 19;
    for (const buffer of buffers) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, initial, gl.DYNAMIC_COPY);
    }
    gl.useProgram(program);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, feedback);
    gl.enable(gl.RASTERIZER_DISCARD);
    let source = 0;
    const run = (): void => {
      const target = 1 - source;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers[source] ?? null);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 0, 0);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buffers[target] ?? null);
      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, 0, vertexCount);
      gl.endTransformFeedback();
      source = target;
    };
    for (let warmup = 0; warmup < 12; warmup += 1) run();
    gl.finish();
    const samples: number[] = [];
    for (let sample = 0; sample < 60; sample += 1) {
      const start = performance.now();
      run();
      gl.finish();
      samples.push(performance.now() - start);
    }
    gl.disable(gl.RASTERIZER_DISCARD);
    for (const buffer of buffers) gl.deleteBuffer(buffer);
    gl.deleteTransformFeedback(feedback);
    gl.deleteProgram(program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return {
      candidate: 'webgl2-transform-feedback',
      supported: true,
      workload,
      samples: summarize(samples),
    };
  } catch (error) {
    return {
      candidate: 'webgl2-transform-feedback',
      supported: false,
      workload,
      reason: error instanceof Error ? error.message : 'Unknown probe error',
    };
  }
}

export function runGpuMicrobenchmarks(tier: QualityTier): GpuProbeResult[] {
  return [pingPongProbe(tier), transformFeedbackProbe(tier)];
}
