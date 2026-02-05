import * as THREE from 'three';
import { clamp, lerp, fract, easeInOutSine } from './utils.js';

// ============================================================================
// COLOR HELPERS & HARMONIZATION
// ============================================================================

export const tmpHSL1 = { h: 0, s: 0, l: 0 };
export const tmpHSL2 = { h: 0, s: 0, l: 0 };

export const palette = {
  hOffset: 0,
  hOffsetTarget: 0,
  globalHueShift: 0
};

export function applyColorTheme(scene, bgUniforms, config, colorThemes) {
  const theme = colorThemes[config.colorTheme];
  if (theme) {
    config.colorPrimary = theme.primary;
    config.colorSecondary = theme.secondary;
    config.colorBg = theme.bg;

    document.getElementById('colorPrimary').value = theme.primary;
    document.getElementById('colorSecondary').value = theme.secondary;
    document.getElementById('colorBg').value = theme.bg;
  }

  scene.fog.color = new THREE.Color(config.colorBg);
  bgUniforms.uBgColor.value.set(config.colorBg);
  bgUniforms.uAccentA.value.set(config.colorPrimary);
  bgUniforms.uAccentB.value.set(config.colorSecondary);
}

export function getHarmonizedColor(energy, bandMix01, config, palette, audio, music) {
  const c1 = new THREE.Color(config.colorPrimary);
  const c2 = new THREE.Color(config.colorSecondary);
  c1.getHSL(tmpHSL1);
  c2.getHSL(tmpHSL2);

  const rawMix = bandMix01 * config.colorReactivity + energy * config.colorReactivity * 0.4;
  const mixAmt = clamp(easeInOutSine(rawMix), 0, 1);

  let h = lerp(tmpHSL1.h, tmpHSL2.h, mixAmt) + palette.hOffset + palette.globalHueShift;

  if (config.colorCycle) {
    h += 0.018 * Math.sin(music.phase * 0.06);
    h += 0.008 * Math.sin(music.phase * 0.15 + Math.PI / 3);
  }

  if (config.synesthesia && Number.isFinite(audio.rootNote)) {
    const chromaMax = Math.max(...audio.chroma);
    if (chromaMax > 0.1) {
      const noteHue = audio.rootNote / 12;
      h = lerp(h, noteHue, 0.35 * (chromaMax / (chromaMax + 0.5)));
    }
  }
  h = fract(h);

  const baseSat = lerp(tmpHSL1.s, tmpHSL2.s, mixAmt);
  const satBoost = audio.transientSharpness * 0.15 + audio.smoothHighMid * 0.1;
  const s = clamp(baseSat * (0.75 + 0.50 * audio.smoothHigh + satBoost), 0.1, 0.98);

  const baseLum = lerp(tmpHSL1.l, tmpHSL2.l, mixAmt);
  const lumBoost = audio.onsetKick * 0.15 + audio.spectralFlux * 0.08;
  const l = clamp(baseLum * (0.50 + 0.70 * energy + lumBoost), 0.08, 0.88);

  return new THREE.Color().setHSL(h, s, l);
}

export function setBgPatternFromConfig(bgUniforms, config) {
  const map = { none: 0, mandala: 1, lattice: 2, plasma: 3, voronoi: 4, waves: 5 };
  bgUniforms.uPattern.value = map[config.bgPattern] || 0;
}
