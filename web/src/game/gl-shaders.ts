import type { Scale } from "./protocol";

export const SCALE_MODE: Record<Scale, number> = {
  nearest: 0,
  smooth: 1,
  sharp: 2,
  integer: 3,
  crt: 4,
};

export const VERTEX_SOURCE = `#version 300 es
out vec2 uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  uv = vec2(p.x, 1.0 - p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D picture;
uniform sampler2D palette;
uniform int format;
uniform int scaleMode;
uniform vec4 rect;
in vec2 uv;
out vec4 color;
void main() {
  vec2 local = (uv - rect.xy) / rect.zw;
  if (any(lessThan(local, vec2(0.0))) || any(greaterThan(local, vec2(1.0)))) { color=vec4(0.0,0.0,0.0,1.0); return; }
  vec4 src = texture(picture, local);
  if (format == 2) { color=vec4(texture(palette, vec2(src.r, 0.5)).rgb, 1.0); return; }
  if (format == 3) { color=vec4(src.bgr, 1.0); return; }
  color=src;
}`;
