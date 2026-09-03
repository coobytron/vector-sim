import type { LoadedCheckpoint } from './checkpoint/types';

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

function createProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
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
out vec2 uv;
void main(){ vec2 p = POS[gl_VertexID]; uv = p * 0.5 + 0.5; gl_Position = vec4(p,0.0,1.0); }
`;

const COPY_FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D sourceState;
out vec4 outState;
void main(){ outState = texture(sourceState, uv); }
`;

export class WebGlNcaRuntime {
  readonly gl: WebGL2RenderingContext;
  readonly checkpoint: LoadedCheckpoint;
  readonly nodeCount: number;
  readonly textureWidth: number;
  readonly textureHeight: number;

  private readonly textures: [WebGLTexture, WebGLTexture];
  private readonly framebuffers: [WebGLFramebuffer, WebGLFramebuffer];
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private activeIndex: 0 | 1 = 0;
  private paused = false;
  private telemetryState: WebGlNcaTelemetry = { steps: 0, lastStepMs: 0, maxStepMs: 0 };

  constructor(options: WebGlNcaRuntimeOptions) {
    const { gl, checkpoint, nodeCount } = options;
    if (!isWebGl2Context(gl)) throw new Error('webgl2 nca: WebGL2 context required');
    if (!Number.isInteger(nodeCount) || nodeCount <= 0) throw new Error('webgl2 nca: nodeCount must be positive');
    if (checkpoint.manifest.dtype !== 'float32') throw new Error(`webgl2 nca: unsupported dtype ${checkpoint.manifest.dtype}`);

    this.gl = gl;
    this.checkpoint = checkpoint;
    this.nodeCount = nodeCount;
    this.textureWidth = Math.ceil(Math.sqrt(nodeCount));
    this.textureHeight = Math.ceil(nodeCount / this.textureWidth);

    const textureA = this.makeTexture();
    const textureB = this.makeTexture();
    this.textures = [textureA, textureB];
    this.framebuffers = [this.makeFramebuffer(textureA), this.makeFramebuffer(textureB)];
    this.program = createProgram(gl, VERTEX, COPY_FRAGMENT);
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('webgl2 nca: failed to create vertex array');
    this.vao = vao;
  }

  private makeTexture(): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error('webgl2 nca: failed to create texture');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.textureWidth, this.textureHeight, 0, gl.RGBA, gl.FLOAT, null);
    return texture;
  }

  private makeFramebuffer(texture: WebGLTexture): WebGLFramebuffer {
    const gl = this.gl;
    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) throw new Error('webgl2 nca: failed to create framebuffer');
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('webgl2 nca: incomplete framebuffer');
    }
    return framebuffer;
  }

  setPaused(value: boolean): void { this.paused = value; }
  get isPaused(): boolean { return this.paused; }
  get telemetry(): WebGlNcaTelemetry { return this.telemetryState; }
  get currentTexture(): WebGLTexture { return this.textures[this.activeIndex]; }

  seed(rgbaState: Float32Array): void {
    const gl = this.gl;
    const capacity = this.textureWidth * this.textureHeight * 4;
    if (rgbaState.length > capacity) throw new Error(`webgl2 nca: seed length ${rgbaState.length} exceeds capacity ${capacity}`);
    const padded = new Float32Array(capacity);
    padded.set(rgbaState);
    for (const texture of this.textures) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.textureWidth, this.textureHeight, gl.RGBA, gl.FLOAT, padded);
    }
    this.activeIndex = 0;
    this.telemetryState = { steps: 0, lastStepMs: 0, maxStepMs: 0 };
  }

  reset(rgbaState: Float32Array): void { this.seed(rgbaState); }

  lesion(indices: readonly number[]): void {
    const gl = this.gl;
    for (const index of indices) {
      if (!Number.isInteger(index) || index < 0 || index >= this.nodeCount) continue;
      const x = index % this.textureWidth;
      const y = Math.floor(index / this.textureWidth);
      const zero = new Float32Array(4);
      gl.bindTexture(gl.TEXTURE_2D, this.currentTexture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, 1, 1, gl.RGBA, gl.FLOAT, zero);
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
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.currentTexture);
    const location = gl.getUniformLocation(this.program, 'sourceState');
    gl.uniform1i(location, 0);
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

  singleStep(): void { this.step(true); }

  dispose(): void {
    const gl = this.gl;
    for (const framebuffer of this.framebuffers) gl.deleteFramebuffer(framebuffer);
    for (const texture of this.textures) gl.deleteTexture(texture);
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
  }
}
