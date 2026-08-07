#version 300 es

in vec4 state;
out vec4 nextState;

void main() {
  nextState = tanh(state * 0.985 + vec4(0.0001));
  gl_Position = vec4(0.0);
}

