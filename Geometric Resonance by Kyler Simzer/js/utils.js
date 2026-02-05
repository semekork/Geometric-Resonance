// ============================================================================
// UTILITIES & MATH HELPERS
// ============================================================================

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const fract = (x) => x - Math.floor(x);
export const hash1 = (n) => fract(Math.sin(n * 12.9898) * 43758.5453123);

// Easing functions
export const easeOutQuad = (t) => t * (2 - t);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutExpo = (t) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export const smoothstep = (a, b, t) => {
  const x = clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};
export const smootherstep = (a, b, t) => {
  const x = clamp((t - a) / (b - a), 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

// Noise functions
export const hash2 = (x, y) => fract(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453);
export const hash3 = (x, y, z) => fract(Math.sin(x * 12.9898 + y * 78.233 + z * 45.164) * 43758.5453);

// Perlin-like noise interpolation
export const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export const gradNoise = (x, y, z) => {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = fade(xf), v = fade(yf), w = fade(zf);

  const n000 = hash3(xi, yi, zi) * 2 - 1;
  const n001 = hash3(xi, yi, zi + 1) * 2 - 1;
  const n010 = hash3(xi, yi + 1, zi) * 2 - 1;
  const n011 = hash3(xi, yi + 1, zi + 1) * 2 - 1;
  const n100 = hash3(xi + 1, yi, zi) * 2 - 1;
  const n101 = hash3(xi + 1, yi, zi + 1) * 2 - 1;
  const n110 = hash3(xi + 1, yi + 1, zi) * 2 - 1;
  const n111 = hash3(xi + 1, yi + 1, zi + 1) * 2 - 1;

  return lerp(
    lerp(lerp(n000, n100, u), lerp(n010, n110, u), v),
    lerp(lerp(n001, n101, u), lerp(n011, n111, u), v),
    w
  );
};

export const noise3D = (x, y, z) => (fract(Math.sin(x * 12.9898 + y * 78.233 + z * 45.164) * 43758.5453) * 2 - 1);

export const foldTheta = (theta, n) => {
  const sector = TAU / Math.max(1, n);
  let a = (theta + Math.PI) % sector;
  if (a < 0) a += sector;
  return a * n;
};
