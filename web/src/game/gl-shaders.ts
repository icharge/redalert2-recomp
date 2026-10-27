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
uniform int bars;
uniform vec4 rect;
uniform vec2 pictureSize;
uniform vec2 outputSize;
in vec2 uv;
out vec4 color;
vec4 decoded(vec4 src) {
  if (format == 2) return vec4(texture(palette, vec2(src.r, 0.5)).rgb, 1.0);
  if (format == 3) return vec4(src.bgr, 1.0);
  return vec4(src.rgb, 1.0);
}
vec4 readPixel(ivec2 pixel) {
  return decoded(texelFetch(picture, clamp(pixel, ivec2(0), ivec2(pictureSize) - 1), 0));
}
vec4 linearColor(vec2 at) {
  vec2 base = floor(at - 0.5);
  vec2 weight = fract(at - 0.5);
  ivec2 p = ivec2(base);
  vec4 top = mix(readPixel(p), readPixel(p + ivec2(1, 0)), weight.x);
  vec4 bottom = mix(readPixel(p + ivec2(0, 1)), readPixel(p + ivec2(1, 1)), weight.x);
  return mix(top, bottom, weight.y);
}
vec4 blurredBars() {
  if (format != 2) return decoded(textureLod(picture, uv, 5.0)) * 0.5;
  vec4 sum = vec4(0.0);
  for (int y = -2; y <= 2; y++)
    for (int x = -2; x <= 2; x++)
      sum += readPixel(ivec2(uv * pictureSize) + ivec2(x, y) * 16);
  return sum * (0.02 * 0.5);
}
void main() {
  vec2 local = (uv - rect.xy) / rect.zw;
  bool outside = any(lessThan(uv, rect.xy)) || any(greaterThan(uv, rect.xy + rect.zw));
  if (outside) { color = bars == 1 ? blurredBars() : vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 sampleUv = clamp(local, vec2(0.0), vec2(1.0));
  vec4 src;
  if (scaleMode == 0 || scaleMode == 3 || scaleMode == 4) {
    src = readPixel(ivec2(floor(sampleUv * pictureSize)));
  } else if (scaleMode == 1) {
    src = format == 2 ? linearColor(sampleUv * pictureSize) : decoded(texture(picture, sampleUv));
  } else {
    float k = max(1.0, floor(min(rect.z * outputSize.x / pictureSize.x, rect.w * outputSize.y / pictureSize.y)));
    vec2 p = sampleUv * pictureSize;
    vec2 sharpUv = (floor(p) + clamp((fract(p) - 0.5) * k + 0.5, 0.0, 1.0)) / pictureSize;
    src = format == 2 ? linearColor(sharpUv * pictureSize) : decoded(texture(picture, sharpUv));
  }
  if (scaleMode == 4 && mod(floor(sampleUv.y * pictureSize.y), 3.0) == 1.0) src.rgb *= 0.78;
  color = src;
}`;
