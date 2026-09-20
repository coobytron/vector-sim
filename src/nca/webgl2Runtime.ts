import type { LoadedCheckpoint } from './checkpoint/types';
import { atlasTexel, createWebGlNcaAtlasLayout, packNodeChannels } from './webgl2Layout';
import type { WebGlNcaAtlasLayout } from './webgl2Layout';
import {
  buildVectorNcaMlpFragmentShader,
  packVectorNcaWeights,
  type PackedFloatTexture,
  type VectorNcaWeightTextures,
} from './webgl2Mlp';

export interface WebGlNcaRuntimeOptions {
  gl: WebGL2RenderingContext;
  checkpoint: LoadedCheckpoint;
  nodeCount: number;
}

export interface WebGlNcaTelemetry {
  readonly steps: number;
  readonly lastStepMs: number;
  readonly maxStepMs: number;
}

function isWebGl2Context(value: unknown): value is WebGL2RenderingContext {
  if (typeof value !== 'object' || value === null) return false;
  const gl = value as Record<string, unknown>;
  return (
    typeof gl.createTexture === 'function' &&
    typeof gl.createShader === 'function' &&
    typeof gl.createProgram === 'function' &&
    typeof gl.createFramebuffer === 'function' &&
    typeof gl.createVertexArray === 'function'
  );
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('webgl2 nca: failed to create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown shader compile error';
    gl.deleteShader(shader);
    throw new Error(`webgl2 nca shader error: ${log}`);
  }
  return shader;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error('webgl2 nca: failed to create program');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown program link error';
    gl.deleteProgram(program);
    throw new Error(`webgl2 nca link error: ${log}`);
  }
  return program;
}

const VERTEX = `#version 300 es
precision highp float;
const vec2 POS[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
void main(){ vec2 p = POS[gl_VertexID]; gl_Position = vec4(p,0.0,1.0); }
`;

export class WebGlNcaRuntime {
  readonly gl: WebGL2RenderingContext;
  readonly checkpoint: LoadedCheckpoint;
  readonly nodeCount: number;
  readonly textureWidth: number;
  readonly textureHeight: number;
  readonly layout: WebGlNcaAtlasLayout;

  private readonly textures: [WebGLTexture, WebGLTexture];
  private readonly framebuffers: [WebGLFramebuffer, WebGLFramebuffer];
  private readonly sensorTexture: WebGLTexture;
  private readonly checkpointTextures: {
    readonly hiddenWeights: WebGLTexture;
    readonly hiddenBias: WebGLTexture;
    readonly outputWeights: WebGLTexture;
    readonly outputBias: WebGLTexture;
  };
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private activeIndex: 0 | 1 = 0;
  private paused = false;
  private telemetryState: WebGlNcaTelemetry = { steps: 0, lastStepMs: 0, maxStepMs: 0 };

  constructor(options: WebGlNcaRuntimeOptions) {
    const { gl, checkpoint, nodeCount } = options;
    if (!isWebGl2Context(gl)) throw new Error('webgl2 nca: WebGL2 context required');
    if (!Number.isInteger(nodeCount) || nodeCount <= 0) {
      throw new Error('webgl2 nca: nodeCount must be positive');
    }
    if (checkpoint.manifest.dtype !== 'float32') {
      throw new Error(`webgl2 nca: unsupported dtype ${checkpoint.manifest.dtype}`);
    }
    if (
      typeof gl.getExtension === 'function' &&
      gl.getExtension('EXT_color_buffer_float') === null
    ) {
      throw new Error('webgl2 nca: EXT_color_buffer_float is required for RGBA32F state');
    }

    this.gl = gl;
    this.checkpoint = checkpoint;
    this.nodeCount = nodeCount;

    const reportedMaxTextureSize =
      typeof gl.getParameter === 'function'
        ? Number(gl.getParameter(gl.MAX_TEXTURE_SIZE))
        : 16_384;
    const maxTextureSize =
      Number.isFinite(reportedMaxTextureSize) && reportedMaxTextureSize > 0
        ? Math.floor(reportedMaxTextureSize)
        : 16_384;

    this.layout = createWebGlNcaAtlasLayout(checkpoint, nodeCount, maxTextureSize);
    this.textureWidth = this.layout.stateTextureWidth;
    this.textureHeight = this.layout.stateTextureHeight;

    const textureA = this.makeTexture(this.textureWidth, this.textureHeight);
    const textureB = this.makeTexture(this.textureWidth, this.textureHeight);
    this.textures = [textureA, textureB];
    this.framebuffers = [this.makeFramebuffer(textureA), this.makeFramebuffer(textureB)];

    this.sensorTexture = this.makeTexture(
      this.layout.sensorTextureWidth,
      this.layout.sensorTextureHeight,
      new Float32Array(
        this.layout.sensorTextureWidth * this.layout.sensorTextureHeight * 4,
      ),
    );

    const packedWeights = packVectorNcaWeights(checkpoint, maxTextureSize);
    this.checkpointTextures = {
      hiddenWeights: this.makePackedTexture(packedWeights.hiddenWeights),
      hiddenBias: this.makePackedTexture(packedWeights.hiddenBias),
      outputWeights: this.makePackedTexture(packedWeights.outputWeights),
      outputBias: this.makePackedTexture(packedWeights.outputBias),
    };

    this.program = createProgram(
      gl,
      VERTEX,
      buildVectorNcaMlpFragmentShader(checkpoint, this.layout, packedWeights),
    );
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('webgl2 nca: failed to create vertex array');
    this.vao = vao;

    gl.useProgram(this.program);
    this.assignSampler('sourceState', 0);
    this.assignSampler('sensorState', 1);
    this.assignSampler('hiddenWeights', 2);
    this.assignSampler('hiddenBias', 3);
    this.assignSampler('outputWeights', 4);
    this.assignSampler('outputBias', 5);
  }

  private assignSampler(name: string, unit: number): void {
    const location = this.gl.getUniformLocation(this.program, name);
    if (location !== null) this.gl.uniform1i(location, unit);
  }

  private makePackedTexture(packed: PackedFloatTexture): WebGLTexture {
    return this.makeTexture(packed.width, packed.height, packed.data);
  }

  private makeTexture(
    width: number,
    height: number,
    data: Float32Array | null = null,
  ): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error('webgl2 nca: failed to create texture');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      width,
      height,
      0,
      gl.RGBA,
      gl.FLOAT,
      data,
    );
    return texture;
  }

  private makeFramebuffer(texture: WebGLTexture): WebGLFramebuffer {
    const gl = this.gl;
    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) throw new Error('webgl2 nca: failed to create framebuffer');
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('webgl2 nca: incomplete framebuffer');
    }
    return framebuffer;
  }

  private bindTextureUnit(unit: number, texture: WebGLTexture): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }

  setPaused(value: boolean): void {
    this.paused = value;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get telemetry(): WebGlNcaTelemetry {
    return this.telemetryState;
  }

  get currentTexture(): WebGLTexture {
    return this.textures[this.activeIndex];
  }

  seed(latentState: Float32Array): void {
    const gl = this.gl;
    const expected = this.nodeCount * this.checkpoint.latentChannels;
    if (latentState.length !== expected) {
      throw new Error(
        `webgl2 nca: seed length ${latentState.length} must equal nodes × latentChannels (${expected})`,
      );
    }
    const packed = packNodeChannels(
      latentState,
      this.checkpoint.latentChannels,
      this.layout,
      'state',
    );
    for (const texture of this.textures) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        this.textureWidth,
        this.textureHeight,
        gl.RGBA,
        gl.FLOAT,
        packed,
      );
    }
    this.activeIndex = 0;
    this.telemetryState = { steps: 0, lastStepMs: 0, maxStepMs: 0 };
  }

  setSensors(sensorState: Float32Array): void {
    const expected = this.nodeCount * this.checkpoint.sensorChannels;
    if (sensorState.length !== expected) {
      throw new Error(
        `webgl2 nca: sensor length ${sensorState.length} must equal nodes × sensorChannels (${expected})`,
      );
    }
    const packed = packNodeChannels(
      sensorState,
      this.checkpoint.sensorChannels,
      this.layout,
      'sensor',
    );
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.sensorTexture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.layout.sensorTextureWidth,
      this.layout.sensorTextureHeight,
      gl.RGBA,
      gl.FLOAT,
      packed,
    );
  }

  reset(latentState: Float32Array): void {
    this.seed(latentState);
  }

  lesion(indices: readonly number[]): void {
    const gl = this.gl;
    for (const index of indices) {
      if (!Number.isInteger(index) || index < 0 || index >= this.nodeCount) continue;
      const zero = new Float32Array(4);
      gl.bindTexture(gl.TEXTURE_2D, this.currentTexture);
      for (let block = 0; block < this.layout.stateBlocks; block += 1) {
        const [x, y] = atlasTexel(this.layout, index, block, 'state');
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          x,
          y,
          1,
          1,
          gl.RGBA,
          gl.FLOAT,
          zero,
        );
      }
    }
  }

  step(force = false): boolean {
    if (this.paused && !force) return false;
    const gl = this.gl;
    const started = performance.now();
    const nextIndex = this.activeIndex === 0 ? 1 : 0;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, this.textureWidth, this.textureHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[nextIndex]);

    this.bindTextureUnit(0, this.currentTexture);
    this.bindTextureUnit(1, this.sensorTexture);
    this.bindTextureUnit(2, this.checkpointTextures.hiddenWeights);
    this.bindTextureUnit(3, this.checkpointTextures.hiddenBias);
    this.bindTextureUnit(4, this.checkpointTextures.outputWeights);
    this.bindTextureUnit(5, this.checkpointTextures.outputBias);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.activeIndex = nextIndex;

    const elapsed = performance.now() - started;
    this.telemetryState = {
      steps: this.telemetryState.steps + 1,
      lastStepMs: elapsed,
      maxStepMs: Math.max(this.telemetryState.maxStepMs, elapsed),
    };
    return true;
  }

  singleStep(): void {
    this.step(true);
  }

  dispose(): void {
    const gl = this.gl;
    for (const framebuffer of this.framebuffers) gl.deleteFramebuffer(framebuffer);
    for (const texture of this.textures) gl.deleteTexture(texture);
    gl.deleteTexture(this.sensorTexture);
    gl.deleteTexture(this.checkpointTextures.hiddenWeights);
    gl.deleteTexture(this.checkpointTextures.hiddenBias);
    gl.deleteTexture(this.checkpointTextures.outputWeights);
    gl.deleteTexture(this.checkpointTextures.outputBias);
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
  }
}
