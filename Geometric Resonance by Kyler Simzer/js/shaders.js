// ============================================================================
// SHADER DEFINITIONS
// ============================================================================

export const shaders = {
  // Background pattern shader
  bgVert: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,

  bgFrag: `
    precision highp float;
    varying vec2 vUv;
    uniform float uTime, uPhase, uPatternStrength, uSymmetry, uEnergy, uBass, uMid, uHigh, uNegative, uBeatPulse, uReactiveBg;
    uniform vec2 uResolution;
    uniform vec3 uBgColor, uAccentA, uAccentB;
    uniform int uPattern;
    float sat(float x){ return clamp(x, 0.0, 1.0); }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    vec3 mixScreen(vec3 a, vec3 b, float t){ return mix(a, 1.0 - (1.0 - a) * (1.0 - b), t); }
    void main(){
      vec2 uv = vUv;
      float aspect = uResolution.x / max(uResolution.y, 1.0);
      vec3 base = uBgColor;
      vec2 p = uv * 2.0 - 1.0;
      p.x *= aspect;
      float r = length(p), a = atan(p.y, p.x);
      float n = max(uSymmetry, 1.0);
      float sector = 6.28318530718 / n;
      float asym = mod(a + 3.14159265359, sector) * n;
      float ph = uPhase;
      float reactMult = uReactiveBg > 0.5 ? 1.0 : 0.0;
      float pat = 0.0;
      if (uPattern == 1) {
        pat = 0.55 * sin((10.0 + uBass * 10.0 * reactMult) * r - ph * 0.35) * cos((2.0 + uMid * 4.0 * reactMult) * asym + ph * 0.25)
            + 0.35 * sin((18.0 + uHigh * 20.0 * reactMult) * r + (3.0 + uHigh * 4.0 * reactMult) * asym - ph * 0.55);
      } else if (uPattern == 2) {
        float s = 6.0 + uMid * 10.0 * reactMult;
        float rot = ph * 0.08;
        mat2 R = mat2(cos(rot), -sin(rot), sin(rot), cos(rot));
        vec2 q = R * p;
        float gx = abs(fract(q.x * s) - 0.5), gy = abs(fract(q.y * s) - 0.5);
        pat = (1.0 - sat(min(gx, gy) * 18.0)) * (0.6 + 0.4 * sin(ph * 0.25 + r * 3.0));
      } else if (uPattern == 3) {
        pat = 0.25 * (sin(p.x * (2.0 + uBass * 3.0 * reactMult) + ph * 0.15) + sin(p.y * (3.0 + uMid * 4.0 * reactMult) - ph * 0.12)
            + sin((p.x + p.y) * (4.0 + uHigh * 6.0 * reactMult) + ph * 0.10) + sin(r * (6.0 + uEnergy * 8.0 * reactMult) - ph * 0.08));
      } else if (uPattern == 4) {
        pat = sin(r * 8.0 - ph * 0.2) * 0.5 + sin(asym * 3.0 + ph * 0.1) * 0.3;
      } else if (uPattern == 5) {
        for (float i = 1.0; i <= 5.0; i++) {
          float freq = i * (1.0 + uEnergy * 0.5 * reactMult);
          pat += (sin(p.x * freq + ph * 0.2 * i) + sin(p.y * freq + ph * 0.15 * i)) / i;
        }
        pat *= 0.15;
      }
      float strength = uPatternStrength * (0.25 + 0.75 * uEnergy * reactMult);
      vec3 accent = mix(uAccentA, uAccentB, sat(0.5 + 0.5 * sin(ph * 0.06 + r * 2.0)));
      base = mixScreen(base, accent * (0.35 + 0.65 * sat(pat * 0.8 + 0.2)), strength);
      base += accent * uBeatPulse * 0.15 * reactMult * (1.0 - r * 0.5);
      base = mix(base, base * (0.55 + 0.45 * smoothstep(1.35, 0.15, r)), 0.70);
      base += (hash(uv * uResolution.xy + fract(uTime) * 100.0) - 0.5) * 0.03;
      if (uNegative > 0.5) base = mix(mix(base, vec3(1.0), 0.82), vec3(1.0) - base * 0.55, 0.6);
      gl_FragColor = vec4(base, 1.0);
    }
  `,

  // Rim glow shader
  rimVert: 'varying vec3 vN, vW, vPos; void main(){ vN = normalize(normalMatrix * normal); vW = (modelMatrix * vec4(position, 1.0)).xyz; vPos = position; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }',
  rimFrag: 'uniform vec3 uColor; uniform float uIntensity, uPower, uTime; varying vec3 vN, vW, vPos; void main(){ vec3 V = normalize(cameraPosition - vW); float fres = pow(1.0 - clamp(dot(normalize(vN), V), 0.0, 1.0), uPower); float irid = sin(length(vPos) * 3.0 + uTime * 2.0) * 0.5 + 0.5; vec3 col = mix(uColor, uColor * vec3(1.2, 0.9, 1.1), irid * 0.3); gl_FragColor = vec4(col * fres * uIntensity, fres * 0.85); }',

  // Particle shader
  particleVert: `
    attribute float size;
    attribute vec3 color;
    varying vec3 vColor;
    varying float vSize;
    uniform float uEnergy, uPixelRatio, uTime, uSizeMult;
    void main() {
      vColor = color;
      vSize = size;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float depth = -mv.z;
      float sizeScale = 250.0 / max(depth, 1.0);
      float pulse = 1.0 + sin(uTime * 2.5 + position.x * 0.3 + position.y * 0.2) * 0.15 * uEnergy;
      gl_PointSize = size * sizeScale * uPixelRatio * (0.9 + uEnergy * 0.5) * pulse * uSizeMult;
      gl_Position = projectionMatrix * mv;
    }
  `,

  particleFrag: `
    varying vec3 vColor;
    varying float vSize;
    uniform float uEnergy, uBrightness;
    void main() {
      vec2 center = gl_PointCoord - 0.5;
      float d = length(center);
      float coreGlow = exp(-d * 10.0);
      float midGlow = exp(-d * 5.0) * 0.5;
      float outerGlow = exp(-d * 2.5) * 0.25;
      float totalGlow = coreGlow + midGlow + outerGlow;
      vec3 glowColor = vColor * (0.9 + coreGlow * 0.3);
      glowColor += vec3(0.05, 0.02, 0.08) * outerGlow * uEnergy;
      float alpha = totalGlow * (0.75 + uEnergy * 0.25) * uBrightness;
      if (alpha < 0.02) discard;
      gl_FragColor = vec4(glowColor * totalGlow * uBrightness, alpha);
    }
  `,

  // Light ray shader
  lightRayVert: 'varying float vY; void main() { vY = position.y / 50.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  lightRayFrag: 'uniform vec3 uColor; uniform float uIntensity; varying float vY; void main() { gl_FragColor = vec4(uColor, (1.0 - vY) * uIntensity * (1.0 - vY)); }',

  // Aurora shader
  auroraVert: 'uniform float uTime, uEnergy; varying vec2 vUv; varying float vDisp; void main() { vUv = uv; vec3 pos = position; float wave = sin(pos.x * 0.15 + uTime * 0.5) * cos(pos.x * 0.08 + uTime * 0.3) + sin(pos.x * 0.22 + uTime * 0.7) * 0.5; pos.z += wave * (3.0 + uEnergy * 5.0); vDisp = wave; gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0); }',
  auroraFrag: 'uniform vec3 uColorA, uColorB; uniform float uEnergy; varying vec2 vUv; varying float vDisp; void main() { vec3 col = mix(uColorA, uColorB, vUv.y + vDisp * 0.2); float alpha = (1.0 - vUv.y) * 0.3 * (0.5 + uEnergy) * smoothstep(0.0, 0.3, vUv.y); gl_FragColor = vec4(col, alpha); }',

  // Energy field shader
  energyFieldVert: 'uniform float uTime, uEnergy; varying vec3 vNormal, vPos; void main() { vNormal = normal; vPos = position; vec3 pos = position; float pulse = sin(length(position) * 2.0 - uTime * 3.0) * 0.5 + 0.5; pos += normal * pulse * uEnergy * 2.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0); }',
  energyFieldFrag: 'uniform vec3 uColor; uniform float uTime, uEnergy; varying vec3 vNormal, vPos; void main() { float fresnel = pow(1.0 - abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))), 3.0); float pattern = sin(vPos.x * 5.0 + uTime) * sin(vPos.y * 5.0 + uTime * 1.3) * sin(vPos.z * 5.0 + uTime * 0.7); gl_FragColor = vec4(uColor, fresnel * 0.15 * (0.5 + uEnergy) * (0.5 + pattern * 0.5)); }',

  // Shockwave shader
  shockwaveVert: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  shockwaveFrag: `
    uniform vec3 uColor;
    uniform float uOpacity;
    varying vec2 vUv;
    void main() {
      vec2 p = vUv - 0.5;
      float r = length(p) * 2.0;
      float ring = exp(-pow(abs(r - 1.0) * 3.5, 2.0));
      float fade = smoothstep(1.6, 0.0, r);
      float a = ring * fade * uOpacity;
      if (a < 0.01) discard;
      gl_FragColor = vec4(uColor, a);
    }
  `,

  // Screen FX shader (post-processing)
  screenVert: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,

  screenFrag: `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    uniform float uHigh;
    uniform float uAnamorphic;
    uniform float uScanlines;
    uniform float uKaleidoscope;
    uniform float uKaleidoscopeSegments;
    uniform float uFilmLook;
    uniform float uNegative;
    uniform float uBeatPulse;
    uniform float uGlitch;

    float sat(float x){ return clamp(x, 0.0, 1.0); }
    float rand(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    vec3 toLuma(vec3 c){ float l = dot(c, vec3(0.299, 0.587, 0.114)); return vec3(l); }
    vec3 adjustContrast(vec3 c, float k){ return (c - 0.5) * k + 0.5; }
    vec3 adjustSaturation(vec3 c, float s){ float l = dot(c, vec3(0.299, 0.587, 0.114)); return mix(vec3(l), c, s); }

    void main() {
      vec2 uv = vUv;
      if (uKaleidoscope > 0.5) {
        vec2 p = uv - 0.5;
        float r = length(p);
        float a = atan(p.y, p.x);
        float n = max(1.0, uKaleidoscopeSegments);
        float sector = 6.28318530718 / n;
        a = mod(a + 6.28318530718, sector);
        a = abs(a - sector * 0.5);
        p = vec2(cos(a), sin(a)) * r;
        uv = p + 0.5;
      }
      if (uGlitch > 0.001) {
        float band = floor(uv.y * 24.0);
        float n = rand(vec2(band, floor(uTime * 6.0)));
        uv.x += (n - 0.5) * 0.08 * uGlitch;
        uv.y += (rand(vec2(band * 3.7, uTime * 0.4)) - 0.5) * 0.03 * uGlitch;
      }
      vec2 dir = uv - 0.5;
      float d = length(dir) + 1e-6;
      dir /= d;
      vec2 off = dir * uAberration * (0.002 + 0.004 * sat(uHigh));
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;
      if (uAnamorphic > 0.001) {
        vec2 o = vec2(off.x * 6.0, 0.0);
        vec3 smear = 0.5 * (texture2D(tDiffuse, uv + o).rgb + texture2D(tDiffuse, uv - o).rgb);
        col = mix(col, smear, uAnamorphic * 0.35);
      }
      if (uFilmLook > 0.5 && uFilmLook < 1.5) {
        col = adjustContrast(col, 1.08);
        col *= vec3(1.03, 1.00, 0.98);
      } else if (uFilmLook >= 1.5 && uFilmLook < 2.5) {
        col = adjustSaturation(col, 0.80);
        col = mix(col, col * vec3(1.06, 1.02, 0.92) + vec3(0.02, 0.015, 0.0), 0.55);
      } else if (uFilmLook >= 2.5 && uFilmLook < 3.5) {
        col = adjustSaturation(col, 1.25);
        col = adjustContrast(col, 1.05);
      } else if (uFilmLook >= 3.5) {
        col = mix(col, col + toLuma(col) * 0.06, 0.35);
        col = mix(col, vec3(1.0) - (vec3(1.0) - col) * 0.92, 0.15);
      }
      float vig = smoothstep(0.86, 0.28, distance(uv, vec2(0.5)));
      col *= mix(1.0, vig, sat(uVignette));
      if (uScanlines > 0.001) {
        float s = 0.5 + 0.5 * sin(uv.y * uResolution.y * 3.14159265);
        col *= 1.0 - uScanlines * 0.09 * s;
      }
      float g = (rand(uv * uResolution.xy + fract(uTime) * 1000.0) - 0.5);
      col += g * (0.06 * uGrain) * (0.35 + 0.65 * sat(uHigh));
      col += vec3(1.0) * uBeatPulse * 0.08;
      if (uNegative > 0.5) {
        col = mix(col, vec3(1.0) - col, 0.75);
      }
      gl_FragColor = vec4(col, 1.0);
    }
  `
};
