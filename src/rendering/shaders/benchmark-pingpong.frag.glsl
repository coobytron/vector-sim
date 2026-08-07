#version 300 es
precision highp float;

uniform sampler2D uState;
out vec4 nextState;

void main() {
  ivec2 size = textureSize(uState, 0);
  ivec2 position = ivec2(gl_FragCoord.xy);
  ivec2 neighborPosition = ivec2(min(position.x + 1, size.x - 1), position.y);
  vec4 selfState = texelFetch(uState, position, 0);
  vec4 neighbor = texelFetch(uState, neighborPosition, 0);
  nextState = tanh(selfState * 0.985 + neighbor * 0.015 + vec4(0.0001));
}

