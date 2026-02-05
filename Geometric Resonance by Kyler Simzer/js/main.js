import * as THREE from 'three';
import { TAU, clamp, lerp, fract, hash1, gradNoise, smoothstep, foldTheta } from './utils.js';
import { AudioAnalyzer } from './audioAnalyzer.js';
import { MotionCoordinator } from './motionCoordinator.js';
import { config, colorThemes } from './config.js';
import { shaders } from './shaders.js';
import { initRenderer, initBackgroundScene, initMainScene, initPostProcessing, updateTrailMode, initAudio } from './sceneSetup.js';
import { applyColorTheme, getHarmonizedColor, setBgPatternFromConfig, palette } from './colorHelpers.js';
import { buildMainGeometry, buildSecondary, buildWaveformRing, buildFreqBars, buildRings, buildShockwaves, spawnShockwave } from './sceneObjects.js';
import { createGeometry } from './geometryBuilders.js';

// ============================================================================
// MAIN APPLICATION
// ============================================================================

// Initialize core systems
const renderer = initRenderer();
const { scene: bgScene, camera: bgCam, uniforms: bgUniforms } = initBackgroundScene(config);
const { scene, camera } = initMainScene(config);
const { composer, bloomPass, afterimagePass, screenFXPass } = initPostProcessing(renderer, bgScene, bgCam, scene, camera, config);
const { audioEl, audioCtx, analyser, sourceNode, gainNode, mediaDest, freqData, timeData } = initAudio();

// Audio and animation systems
const audio = new AudioAnalyzer();
const motion = new MotionCoordinator();

// Scene objects
let wireframeMesh, particleSystem, connectionLines, rimMesh;
let innerMesh, outerMesh, waveformRing, freqBars = [], rings = [];
let floatingParticles, floatingData = [];
let lightRays = [], auroraLayer, energyFieldMesh, orbitalRings = [];
let shockwaves = [];
let vertexData = [];

// Animation state
let beatPulse = 0;
let _lastFrameTime = 0;
let _animationTime = 0;
let _lastFFTUpdate = 0;
let modelSpin = 0;
let playing = false;

const music = { beats: 0, phase: 0, bpmSmooth: 120, lastSeenBar: -1 };
const shockState = { lastTime: -1e9 };
const camState = {
  angle: 0, targetAngle: 0, height: 0, targetHeight: 0,
  distance: config.cameraDistance, targetDistance: config.cameraDistance,
  look: new THREE.Vector3(), targetLook: new THREE.Vector3(),
  roll: 0, targetRoll: 0, appliedRoll: 0,
  autoMode: config.cameraMode, autoAngleOffset: 0, autoAngleOffsetTarget: 0,
  autoHeightBias: 0, autoHeightBiasTarget: 0, autoRoll: 0, autoRollTarget: 0,
  shake: new THREE.Vector3(), drunk: new THREE.Vector3()
};

const _pool = {
  tmp: new THREE.Vector3(),
  targetPos: new THREE.Vector3(),
  axisY: new THREE.Vector3(0, 1, 0),
  quat: new THREE.Quaternion(),
  vi: new THREE.Vector3(),
  vj: new THREE.Vector3()
};

// Presets
let presets = {};
try {
  presets = JSON.parse(localStorage.getItem('geometricResonancePresets') || '{}');
} catch (e) { }

// ============================================================================
// INITIALIZATION FUNCTIONS
// ============================================================================

function buildEnvironment() {
  const envObjects = [];
  if (floatingParticles) scene.remove(floatingParticles);
  floatingData = [];

  const fpPos = new Float32Array(500 * 3);
  const fpCol = new Float32Array(500 * 3);
  for (let i = 0; i < 500; i++) {
    const theta = Math.random() * TAU;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 15 + Math.random() * 50;
    fpPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    fpPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    fpPos[i * 3 + 2] = r * Math.cos(phi);
    fpCol[i * 3] = fpCol[i * 3 + 1] = fpCol[i * 3 + 2] = 1;
    floatingData.push({
      r, theta, phi,
      speed: 0.1 + Math.random() * 0.4,
      band: Math.floor(Math.random() * 64),
      phase: Math.random() * TAU
    });
  }

  const fpGeom = new THREE.BufferGeometry();
  fpGeom.setAttribute('position', new THREE.BufferAttribute(fpPos, 3));
  fpGeom.setAttribute('color', new THREE.BufferAttribute(fpCol, 3));
  floatingParticles = new THREE.Points(
    fpGeom,
    new THREE.PointsMaterial({
      size: 0.1,
      vertexColors: true,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending
    })
  );
  scene.add(floatingParticles);
  floatingParticles.visible = config.showDeepParticles;

  if (config.environment === 'grid') {
    const grid = new THREE.GridHelper(100, 50, 0x222222, 0x111111);
    grid.position.y = -20;
    envObjects.push(grid);
    scene.add(grid);
  } else if (config.environment === 'stars') {
    const starPos = new Float32Array(3000 * 3);
    for (let i = 0; i < 3000; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 250;
      starPos[i * 3 + 1] = (Math.random() - 0.5) * 250;
      starPos[i * 3 + 2] = (Math.random() - 0.5) * 250;
    }
    const sGeom = new THREE.BufferGeometry();
    sGeom.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const stars = new THREE.Points(sGeom, new THREE.PointsMaterial({ size: 0.18, color: 0xffffff, transparent: true, opacity: 0.7 }));
    envObjects.push(stars);
    scene.add(stars);
  } else if (config.environment === 'nebula') {
    for (let i = 0; i < 6; i++) {
      const neb = new THREE.Mesh(
        new THREE.SphereGeometry(35 + i * 12, 20, 20),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color().setHSL(0.58 + i * 0.08, 0.6, 0.12),
          transparent: true,
          opacity: 0.04,
          side: THREE.BackSide,
          blending: THREE.AdditiveBlending
        })
      );
      neb.userData = { rotSpeed: 0.001 * (i + 1) };
      envObjects.push(neb);
      scene.add(neb);
    }
  }

  return envObjects;
}

function buildLightRays() {
  lightRays.forEach(r => scene.remove(r));
  lightRays = [];
  if (!config.showLightRays) return;

  for (let i = 0; i < 12; i++) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(1, 1, 1) },
        uIntensity: { value: 0.3 }
      },
      vertexShader: shaders.lightRayVert,
      fragmentShader: shaders.lightRayFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });

    const ray = new THREE.Mesh(new THREE.ConeGeometry(0.3, 50, 8, 1, true), mat);
    ray.rotation.x = Math.PI;
    ray.rotation.z = (i / 12) * TAU;
    ray.userData = { baseAngle: ray.rotation.z, speed: 0.1 + Math.random() * 0.2 };
    lightRays.push(ray);
    scene.add(ray);
  }
}

function buildAurora() {
  if (auroraLayer) scene.remove(auroraLayer);
  if (!config.showAurora) return;

  auroraLayer = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 30, 64, 32),
    new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColorA: { value: new THREE.Color(0x00ff88) },
        uColorB: { value: new THREE.Color(0xff00ff) },
        uEnergy: { value: 0 }
      },
      vertexShader: shaders.auroraVert,
      fragmentShader: shaders.auroraFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    })
  );
  auroraLayer.position.set(0, 25, -30);
  auroraLayer.rotation.x = -0.3;
  scene.add(auroraLayer);
}

function buildEnergyField() {
  if (energyFieldMesh) scene.remove(energyFieldMesh);
  if (!config.showEnergyField) return;

  energyFieldMesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(20, 3),
    new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x4488ff) },
        uEnergy: { value: 0 }
      },
      vertexShader: shaders.energyFieldVert,
      fragmentShader: shaders.energyFieldFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      wireframe: true
    })
  );
  scene.add(energyFieldMesh);
}

function buildOrbitals() {
  orbitalRings.forEach(r => scene.remove(r));
  orbitalRings = [];
  if (!config.showOrbitals) return;

  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(10 + i * 3, 0.05, 8, 128),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending
      })
    );
    ring.userData = { index: i, speed: (i + 1) * 0.3 };
    orbitalRings.push(ring);
    scene.add(ring);
  }
}

// Initialize all geometry
applyColorTheme(scene, bgUniforms, config, colorThemes);
setBgPatternFromConfig(bgUniforms, config);

const result = buildMainGeometry(scene, config, vertexData, audio, clamp);
wireframeMesh = result.wireframeMesh;
particleSystem = result.particleSystem;
connectionLines = result.connectionLines;
rimMesh = result.rimMesh;

const secondary = buildSecondary(scene, config);
innerMesh = secondary.innerMesh;
outerMesh = secondary.outerMesh;

waveformRing = buildWaveformRing(scene, config);
freqBars = buildFreqBars(scene, config);
rings = buildRings(scene, config);

buildEnvironment();
shockwaves = buildShockwaves(scene, config);
buildLightRays();
buildAurora();
buildEnergyField();
buildOrbitals();

// Setup spectrum overlay
const specCanvas = document.getElementById('spectrum-overlay');
const specCtx = specCanvas.getContext('2d');
specCanvas.width = window.innerWidth;
specCanvas.height = 50;

function drawSpectrum() {
  if (!config.showSpectrum || !analyser) {
    specCanvas.style.opacity = '0';
    return;
  }
  specCanvas.style.opacity = '0.5';
  specCtx.clearRect(0, 0, specCanvas.width, specCanvas.height);
  const barW = specCanvas.width / 64;
  const primary = new THREE.Color(config.colorPrimary);
  const secondary = new THREE.Color(config.colorSecondary);

  for (let i = 0; i < 64; i++) {
    const v = audio.getBand(i);
    const h = v * 48;
    const t = i / 64;
    const col = primary.clone().lerp(secondary, t);
    specCtx.fillStyle = `rgba(${Math.floor(col.r * 255)}, ${Math.floor(col.g * 255)}, ${Math.floor(col.b * 255)}, ${0.25 + v * 0.6})`;
    specCtx.fillRect(i * barW, specCanvas.height - h, barW - 1, h);
  }
}

function updateMusicClock(dt) {
  const bpm = audio.getBPM() || 120;
  music.bpmSmooth = lerp(music.bpmSmooth, bpm, 0.08);
  music.beats += dt * (clamp(music.bpmSmooth, 50, 220) / 60);
  music.phase = music.beats * TAU;
}

// ============================================================================
// PRESET SYSTEM
// ============================================================================

window.openPresetModal = () => {
  document.getElementById('preset-modal').style.display = 'block';
  renderPresetList();
};

window.closePresetModal = () => {
  document.getElementById('preset-modal').style.display = 'none';
};

window.savePreset = () => {
  const name = document.getElementById('preset-name').value.trim();
  if (!name) return;
  presets[name] = JSON.parse(JSON.stringify(config));
  localStorage.setItem('geometricResonancePresets', JSON.stringify(presets));
  renderPresetList();
};

window.loadPreset = (name) => {
  if (!presets[name]) return;
  Object.assign(config, presets[name]);

  const setToggle = (id, on) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', !!on);
  };

  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el && typeof v !== 'undefined' && v !== null) el.value = v;
  };

  setVal('form', config.form);
  setVal('colorTheme', config.colorTheme);
  setVal('cameraMode', config.cameraMode);
  setVal('particleMode', config.particleMode);
  setVal('trailMode', config.trailMode);
  setVal('environment', config.environment);
  setVal('bgPattern', config.bgPattern);

  setToggle('toggleModelSpin', config.modelSpinEnabled);
  setToggle('toggleModelSpinReactive', config.modelSpinReactive);
  setToggle('toggleModelPulse', config.modelPulseEnabled);
  setVal('modelSpinSpeed', config.modelSpinSpeed);
  setVal('modelSpinAxis', config.modelSpinAxis);
  setVal('modelSpinReactivity', config.modelSpinReactivity);
  setVal('modelPulseAmount', config.modelPulseAmount);

  applyColorTheme(scene, bgUniforms, config, colorThemes);
  setBgPatternFromConfig(bgUniforms, config);
  updateTrailMode(afterimagePass, config.trailMode);

  scene.fog.density = config.fogDensity;
  camera.fov = config.cameraFov;
  camera.updateProjectionMatrix();

  closePresetModal();
};

window.deletePreset = (name) => {
  delete presets[name];
  localStorage.setItem('geometricResonancePresets', JSON.stringify(presets));
  renderPresetList();
};

function renderPresetList() {
  const list = document.getElementById('preset-list');
  list.innerHTML = '';
  Object.keys(presets).forEach(name => {
    const item = document.createElement('div');
    item.style.cssText = 'padding:10px;background:rgba(255,255,255,0.03);border-radius:8px;margin-bottom:8px;cursor:pointer;color:rgba(255,255,255,0.7);display:flex;justify-content:space-between;';
    item.innerHTML = `<span onclick="loadPreset('${name}')">${name}</span><span style="color:rgba(255,100,100,0.6);cursor:pointer;" onclick="deletePreset('${name}')">✕</span>`;
    list.appendChild(item);
  });
}

function randomize() {
  const forms = ['icosahedron', 'octahedron', 'dodecahedron', 'torus', 'torusKnot', 'sphere', 'mobius', 'gyroid', 'hopfFibration', 'seashell'];
  const themes = Object.keys(colorThemes);
  const cameras = ['orbit', 'reactive', 'cinematic', 'spiral', 'figure8', 'vortex', 'pendulum'];
  const particles = ['vertex', 'swarm', 'explode', 'orbital', 'magnetic', 'wave', 'vortex', 'aurora'];
  const trails = ['none', 'light', 'medium', 'heavy', 'smear'];
  const envs = ['void', 'stars', 'nebula', 'grid'];
  const patterns = ['none', 'mandala', 'lattice', 'plasma', 'voronoi', 'waves'];

  config.form = forms[Math.floor(Math.random() * forms.length)];
  config.density = Math.floor(Math.random() * 4) + 1;
  config.colorTheme = themes[Math.floor(Math.random() * themes.length)];
  config.cameraMode = cameras[Math.floor(Math.random() * cameras.length)];
  config.particleMode = particles[Math.floor(Math.random() * particles.length)];
  config.trailMode = trails[Math.floor(Math.random() * trails.length)];
  config.environment = envs[Math.floor(Math.random() * envs.length)];
  config.bgPattern = patterns[Math.floor(Math.random() * patterns.length)];
  config.symmetry = [3, 4, 6, 8, 12][Math.floor(Math.random() * 5)];
  config.sensitivity = 0.6 + Math.random() * 1.8;
  config.turbulence = Math.random() * 1.5;
  config.bloomStrength = 0.4 + Math.random() * 1.2;
  config.cameraSpeed = 0.3 + Math.random() * 1.2;
  config.cameraShake = Math.random() * 1.0;
  config.bgPatternStrength = 0.1 + Math.random() * 0.5;
  config.showLightRays = Math.random() > 0.7;
  config.showAurora = Math.random() > 0.7;
  config.showEnergyField = Math.random() > 0.8;
  config.showOrbitals = Math.random() > 0.7;

  applyColorTheme(scene, bgUniforms, config, colorThemes);
  setBgPatternFromConfig(bgUniforms, config);
  updateTrailMode(afterimagePass, config.trailMode);

  document.getElementById('form').value = config.form;
  document.getElementById('colorTheme').value = config.colorTheme;
  document.getElementById('cameraMode').value = config.cameraMode;
  document.getElementById('particleMode').value = config.particleMode;
  document.getElementById('trailMode').value = config.trailMode;
  document.getElementById('environment').value = config.environment;
  document.getElementById('bgPattern').value = config.bgPattern;
}

// ============================================================================
// ANIMATION LOOP
// ============================================================================

const getFFTInterval = () => 1000 / (60 - config.smoothness * 30);

function animate(timestamp) {
  requestAnimationFrame(animate);
  if (!timestamp) timestamp = performance.now();

  const rawDt = _lastFrameTime ? (timestamp - _lastFrameTime) / 1000 : 0.016;
  const dt = Math.min(rawDt, 0.05);
  _lastFrameTime = timestamp;
  _animationTime += dt;
  const t = _animationTime;

  // Model spin
  if (config.modelSpinEnabled) {
    modelSpin += dt * (0.24 * config.cameraSpeed * config.modelSpinSpeed);
  }

  let isBeat = false;
  if (analyser && playing) {
    if ((timestamp - _lastFFTUpdate) >= getFFTInterval()) {
      _lastFFTUpdate = timestamp;
      analyser.getByteFrequencyData(freqData);
      analyser.getByteTimeDomainData(timeData);
    }
    const smoothingAlpha = 0.18 + config.smoothness * 0.15;
    isBeat = audio.analyze(freqData, timeData, dt, null, null, smoothingAlpha);

    motion.update(audio, dt, music.phase, config.smoothness);

    document.getElementById('bpm-display').textContent = `${audio.getBPM()} BPM`;
    document.getElementById('energy-display').textContent = `Energy: ${(audio.energy * 100).toFixed(0)}%`;
    document.getElementById('bar-display').textContent = `Bar: ${audio.barCount}`;
    document.getElementById('note-display').textContent = `Note: ${audio.noteName}`;
  }

  updateMusicClock(dt);

  if (config.hueRotateSpeed > 0) {
    palette.globalHueShift += dt * config.hueRotateSpeed * 0.1;
    palette.globalHueShift = fract(palette.globalHueShift);
  }

  if (audio.barCount !== music.lastSeenBar) {
    music.lastSeenBar = audio.barCount;
    if (config.barLockColors) palette.hOffsetTarget = (hash1(audio.barCount * 0.97) - 0.5) * 0.10;
    if (config.cameraAutoAngles && audio.barCount > 0 && audio.barCount % 16 === 0) {
      const modes = ['orbit', 'reactive', 'cinematic', 'spiral', 'figure8', 'vortex', 'pendulum'];
      camState.autoMode = modes[Math.floor(Math.random() * modes.length)];
      camState.autoAngleOffsetTarget = (Math.random() * 2 - 1) * (Math.PI * 0.45);
      camState.autoHeightBiasTarget = (Math.random() * 2 - 1) * 7.0;
      camState.autoRollTarget = (Math.random() * 2 - 1) * (Math.PI / 18);
    }
  }
  palette.hOffset = lerp(palette.hOffset, palette.hOffsetTarget, dt * 0.8);

  const { smoothSubBass, smoothBass, smoothLowMid, smoothMid, smoothHighMid, smoothHigh, smoothBrilliance, spectralCentroid, spectralFlux, energy, transientSharpness, onsetSnare, onsetHihat } = audio;
  const phase = music.phase;
  const sens = config.sensitivity;
  const symN = config.symmetry;

  beatPulse = motion.pulse;

  // Spawn shockwave
  if (config.showShockwaves) {
    const canSpawn = (t - shockState.lastTime) > config.shockwaveCooldown;
    const strongTransient = motion.impact > config.shockwaveImpactThreshold;
    if (canSpawn && (isBeat || strongTransient)) {
      shockState.lastTime = t;
      const col = getHarmonizedColor(energy, 0.5, config, palette, audio, music);
      spawnShockwave(shockwaves, config, col, isBeat ? 1.0 : 0.75);
    }
  }

  // Update background
  bgUniforms.uTime.value = t;
  bgUniforms.uPhase.value = phase;
  bgUniforms.uSymmetry.value = symN;
  bgUniforms.uEnergy.value = motion.swell;
  bgUniforms.uBass.value = motion.lowMotion;
  bgUniforms.uMid.value = motion.midMotion;
  bgUniforms.uHigh.value = motion.highMotion;
  bgUniforms.uNegative.value = config.negativeSpace ? 1.0 : 0.0;
  bgUniforms.uBeatPulse.value = motion.pulse;
  bgUniforms.uReactiveBg.value = config.reactiveBg ? 1.0 : 0.0;
  bgUniforms.uPatternStrength.value = config.bgPatternStrength;

  // Main geometry
  if (wireframeMesh && particleSystem) {
    const react = config.modelSpinReactive ? config.modelSpinReactivity : 0;
    const baseY = modelSpin;
    const baseX = modelSpin * 0.455;
    const baseZ = modelSpin * 0.273;
    const centroidFactor = lerp(1.0, (0.85 + 0.35 * spectralCentroid), react);

    let rotY = baseY + motion.midMotion * 0.06 * react;
    let rotX = baseX * centroidFactor;
    let rotZ = baseZ + motion.highMotion * 0.04 * react;

    if (config.modelSpinAxis === 'y') {
      rotX = 0;
      rotZ = 0;
    }

    wireframeMesh.rotation.y = rotY;
    wireframeMesh.rotation.x = rotX;
    wireframeMesh.rotation.z = rotZ;

    const targetScale = motion.scaleSuggestion * (0.95 + sens * 0.05);
    const pulseAmt = config.modelPulseEnabled ? config.modelPulseAmount : 0;
    const meshScale = lerp(1.0, targetScale, pulseAmt);
    wireframeMesh.scale.setScalar(meshScale);

    wireframeMesh.material.opacity = config.negativeSpace ? 0.12 : (0.22 + motion.swell * 0.42);
    wireframeMesh.material.color.copy(
      config.negativeSpace ? new THREE.Color(0x080808) : getHarmonizedColor(motion.swell, 0.5, config, palette, audio, music)
    );

    if (rimMesh) {
      rimMesh.visible = config.negativeSpace;
      rimMesh.rotation.copy(wireframeMesh.rotation);
      rimMesh.scale.copy(wireframeMesh.scale);
      rimMesh.material.uniforms.uColor.value.copy(getHarmonizedColor(motion.swell, 0.5, config, palette, audio, music));
      rimMesh.material.uniforms.uTime.value = t;
    }

    // Update particles
    const pos = particleSystem.geometry.attributes.position.array;
    const col = particleSystem.geometry.attributes.color.array;
    const sizes = particleSystem.geometry.attributes.size.array;
    const pMode = config.particleMode;
    const turb = config.turbulence;
    const cohe = config.cohesion;

    const noiseOffset = t * 0.15;
    const particlePulse = motion.pulse;
    const particleImpact = motion.impact;

    for (let i = 0; i < vertexData.length; i++) {
      const vd = vertexData[i];
      const freqVal = clamp(audio.getBand(vd.band) * 1.2 * sens, 0, 1.5);
      const onset = audio.getOnset(vd.band) * 0.6;
      const thetaSym = foldTheta(vd.theta, symN);

      let disp = 1.0;

      if (config.fieldMode === 'harmonic') {
        const h1 = Math.sin(thetaSym + 2.0 * vd.phi + phase * 0.04);
        const h2 = Math.sin(2.0 * thetaSym - 3.0 * vd.phi + phase * 0.028);
        disp = 1.0 + freqVal * 0.5 * h1 + motion.lowMotion * 0.4 * h2 + particlePulse * 0.15 + onset * 0.08;
      } else if (config.fieldMode === 'curl') {
        const noiseVal = gradNoise(vd.base.x * 0.08 + noiseOffset, vd.base.y * 0.08, vd.base.z * 0.08 + t * 0.1);
        disp = 1 + freqVal * 0.45 + onset * 0.25 + noiseVal * 0.2 * turb + particlePulse * 0.18;
      } else if (config.fieldMode === 'spiral') {
        const spiralWave = Math.sin(thetaSym + phase * 0.18 + motion.lowMotion * 2.0);
        disp = 1 + freqVal * 0.45 + onset * 0.25 + spiralWave * 0.22 * sens + particlePulse * 0.18;
      } else {
        const noiseVal = gradNoise(vd.base.x * 0.12 + noiseOffset, vd.base.y * 0.12, vd.base.z * 0.12);
        disp = 1 + freqVal * 0.55 + onset * 0.35 + noiseVal * 0.25 * turb + particlePulse * 0.2;
      }
      disp = clamp(disp, 0.7, 2.2);

      _pool.targetPos.copy(vd.base).multiplyScalar(disp);

      if (pMode === 'swarm') {
        const swarmIntensity = turb * freqVal * 1.0;
        _pool.targetPos.x += Math.cos(thetaSym + phase * 0.18) * swarmIntensity;
        _pool.targetPos.y += Math.sin(vd.phi + phase * 0.14) * swarmIntensity * 0.7;
        _pool.targetPos.z += Math.sin(thetaSym - phase * 0.16) * swarmIntensity;
      } else if (pMode === 'explode') {
        _pool.tmp.copy(vd.base).normalize();
        const explodeForce = (particlePulse * 0.8 + particleImpact * 0.5) * 5 * sens;
        _pool.targetPos.addScaledVector(_pool.tmp, explodeForce);
      } else if (pMode === 'orbital') {
        const ang = phase * 0.25 + vd.phase + freqVal * 2.0;
        const r = vd.base.length() * (1 + freqVal * 0.3 * sens);
        _pool.targetPos.set(Math.cos(ang) * r, vd.base.y * (1 + motion.midMotion * 0.35), Math.sin(ang) * r);
      } else if (pMode === 'magnetic') {
        const attractorY = (motion.lowMotion - motion.highMotion) * 6;
        const attractorStrength = motion.swell * 0.12 * sens;
        _pool.tmp.set(0, attractorY, 0).sub(vd.current);
        const dist = Math.max(_pool.tmp.length(), 0.5);
        _pool.targetPos.addScaledVector(_pool.tmp.normalize(), attractorStrength / (dist * 0.08));
        _pool.targetPos.x += Math.sin(phase * 0.2 + vd.phase) * motion.midMotion * 1.2;
        _pool.targetPos.z += Math.cos(phase * 0.2 + vd.phase) * motion.midMotion * 1.2;
      } else if (pMode === 'wave') {
        const wave1 = Math.sin(thetaSym + phase * 0.35) * motion.lowMotion * 2.5;
        const wave2 = Math.sin(thetaSym * 2 + phase * 0.5 + Math.PI / 3) * motion.midMotion * 1.2;
        const wave3 = Math.sin(thetaSym * 3 + phase * 0.7) * motion.highMotion * 0.6;
        _pool.targetPos.y += (wave1 + wave2 + wave3) * sens;
      } else if (pMode === 'vortex') {
        const vAng = phase * 0.35 + vd.phase;
        const vR = vd.base.length() * (1 + motion.lowMotion * 0.2);
        _pool.targetPos.x = Math.cos(vAng + thetaSym * 0.5) * vR;
        _pool.targetPos.z = Math.sin(vAng + thetaSym * 0.5) * vR;
        _pool.targetPos.y = vd.base.y * (1 + motion.midMotion * 0.25) + motion.highMotion * 3 * Math.sin(vAng * 2);
      } else if (pMode === 'aurora') {
        const aWave1 = Math.sin(vd.base.x * 0.15 + phase * 0.12) * Math.cos(vd.base.z * 0.15 + phase * 0.08);
        const aWave2 = Math.sin(vd.base.x * 0.25 + phase * 0.18 + Math.PI / 4) * motion.highMotion;
        _pool.targetPos.y += (aWave1 * motion.midMotion * 3.0 + aWave2 * 1.2) * sens;
        _pool.targetPos.x += Math.sin(phase * 0.08 + vd.base.y * 0.1) * motion.lowMotion * 0.6;
      }

      _pool.tmp.copy(_pool.targetPos).sub(vd.current);

      const effectiveCohesion = cohe * (0.4 - config.smoothness * 0.15);
      vd.velocity.add(_pool.tmp.multiplyScalar(effectiveCohesion));

      const damping = 0.92 + config.smoothness * 0.05;
      vd.velocity.multiplyScalar(damping);

      const maxVel = 2.0 - config.smoothness * 1.0;
      const velMag = vd.velocity.length();
      if (velMag > maxVel) {
        vd.velocity.multiplyScalar(maxVel / velMag);
      }

      vd.current.addScaledVector(vd.velocity, dt);

      pos[i * 3] = vd.current.x;
      pos[i * 3 + 1] = vd.current.y;
      pos[i * 3 + 2] = vd.current.z;

      const colorEnergy = freqVal + onset * 0.3;
      const colorPhase = fract((thetaSym / TAU) + spectralCentroid * 0.25);
      const c = getHarmonizedColor(colorEnergy, colorPhase, config, palette, audio, music);
      const brightness = clamp(0.35 + freqVal * 0.45 + motion.pulse * 0.15, 0.15, 1.0);
      col[i * 3] = c.r * brightness;
      col[i * 3 + 1] = c.g * brightness;
      col[i * 3 + 2] = c.b * brightness;

      const baseSize = 0.12 + freqVal * 0.14;
      const pulseSize = motion.pulse * 0.25;
      sizes[i] = baseSize * (1 + pulseSize);
    }

    particleSystem.geometry.attributes.position.needsUpdate = true;
    particleSystem.geometry.attributes.color.needsUpdate = true;
    particleSystem.geometry.attributes.size.needsUpdate = true;
    particleSystem.rotation.copy(wireframeMesh.rotation);
    particleSystem.scale.copy(wireframeMesh.scale);
    particleSystem.material.uniforms.uTime.value = t;
    particleSystem.material.uniforms.uEnergy.value = motion.swell;
    particleSystem.material.uniforms.uSizeMult.value = config.particleSizeMult;
    particleSystem.material.uniforms.uBrightness.value = config.particleBrightness;
  }

  // Connection lines
  if (connectionLines && config.showConnections && vertexData.length > 1) {
    const linePos = connectionLines.geometry.attributes.position.array;
    const lineCol = connectionLines.geometry.attributes.color.array;
    let lineIdx = 0;
    const maxDist = 3.5 + motion.midMotion * 4.0 + motion.pulse * 2.0;
    _pool.quat.setFromEuler(wireframeMesh.rotation);
    const scale = wireframeMesh.scale.x;
    const limit = Math.min(vertexData.length, 150);

    for (let i = 0; i < limit && lineIdx < linePos.length / 6; i++) {
      for (let j = i + 1; j < limit && lineIdx < linePos.length / 6; j++) {
        _pool.vi.copy(vertexData[i].current).multiplyScalar(scale).applyQuaternion(_pool.quat);
        _pool.vj.copy(vertexData[j].current).multiplyScalar(scale).applyQuaternion(_pool.quat);
        const d = _pool.vi.distanceTo(_pool.vj);
        if (d < maxDist) {
          linePos[lineIdx * 6] = _pool.vi.x;
          linePos[lineIdx * 6 + 1] = _pool.vi.y;
          linePos[lineIdx * 6 + 2] = _pool.vi.z;
          linePos[lineIdx * 6 + 3] = _pool.vj.x;
          linePos[lineIdx * 6 + 4] = _pool.vj.y;
          linePos[lineIdx * 6 + 5] = _pool.vj.z;
          const bright = clamp((maxDist - d) / maxDist, 0, 1) * 0.24 + 0.03;
          const c = getHarmonizedColor(energy, 0.5, config, palette, audio, music);
          lineCol[lineIdx * 6] = lineCol[lineIdx * 6 + 3] = c.r * bright;
          lineCol[lineIdx * 6 + 1] = lineCol[lineIdx * 6 + 4] = c.g * bright;
          lineCol[lineIdx * 6 + 2] = lineCol[lineIdx * 6 + 5] = c.b * bright;
          lineIdx++;
        }
      }
    }
    connectionLines.geometry.setDrawRange(0, lineIdx * 2);
    connectionLines.geometry.attributes.position.needsUpdate = true;
    connectionLines.geometry.attributes.color.needsUpdate = true;
  }

  // Secondary meshes
  if (innerMesh) {
    innerMesh.rotation.y = phase * 0.05;
    innerMesh.rotation.x = phase * 0.03;
    innerMesh.scale.setScalar(1 + motion.lowMotion * 0.25 + motion.pulse * 0.15);
    innerMesh.material.color.copy(getHarmonizedColor(motion.lowMotion, 0.2, config, palette, audio, music));
    innerMesh.material.opacity = 0.12 + motion.swell * 0.12;
  }

  if (outerMesh) {
    outerMesh.rotation.y = -phase * 0.02;
    outerMesh.rotation.z = phase * 0.015;
    outerMesh.scale.setScalar(1 + motion.lowMotion * 0.15 + motion.breathe * 0.08);
    outerMesh.material.opacity = 0.03 + motion.swell * 0.03;
  }

  // Waveform ring
  if (waveformRing && waveformRing.visible && timeData) {
    const wPos = waveformRing.geometry.attributes.position.array;
    const baseRadius = 12;
    const waveAmplitude = 3.5 * (1 + motion.swell * 0.4);

    for (let i = 0; i < 256; i++) {
      const ang = (i / 256) * TAU;
      const dataIdx = Math.floor((i * timeData.length) / 256);
      const sample = timeData[dataIdx] / 128 - 1;
      const prevSample = (timeData[Math.max(0, dataIdx - 1)] / 128 - 1);
      const nextSample = (timeData[Math.min(timeData.length - 1, dataIdx + 1)] / 128 - 1);
      const smoothedSample = (prevSample + sample * 2 + nextSample) / 4;

      const r = baseRadius + smoothedSample * waveAmplitude;
      wPos[i * 3] = Math.cos(ang) * r;
      wPos[i * 3 + 2] = Math.sin(ang) * r;
      wPos[i * 3 + 1] = smoothedSample * 0.4 * motion.highMotion;
    }
    waveformRing.geometry.attributes.position.needsUpdate = true;
    waveformRing.material.color.copy(getHarmonizedColor(motion.midMotion, 0.7, config, palette, audio, music));
    waveformRing.material.opacity = 0.35 + motion.swell * 0.2;
  }

  // Freq bars
  freqBars.forEach((bar, idx) => {
    if (!bar.visible) return;
    const v = audio.getBand(idx);
    const peak = audio.bandPeaks[idx];
    const targetScale = 0.5 + v * 8 + (peak - v) * 1.5;
    bar.scale.y = lerp(bar.scale.y, targetScale, 0.25);
    bar.material.color.copy(getHarmonizedColor(v, idx / 64, config, palette, audio, music));
    bar.material.opacity = 0.35 + v * 0.45;
  });

  // Rings
  rings.forEach((ring, idx) => {
    ring.rotation.x = phase * 0.02 * (idx + 1) + (Math.PI / 2) * (idx % 2);
    ring.rotation.y = phase * 0.015 * (idx + 1);
    const bandVal = audio.getBand(idx * 8);
    ring.scale.setScalar(1 + bandVal * 0.3 + motion.pulse * 0.1);
    ring.material.color.copy(getHarmonizedColor(bandVal, idx / config.ringCount, config, palette, audio, music));
    ring.material.opacity = 0.02 + bandVal * 0.025;
  });

  // Light rays
  lightRays.forEach((ray, i) => {
    ray.rotation.z = ray.userData.baseAngle + t * ray.userData.speed * (1 + motion.lowMotion * 0.3);
    const intensity = 0.1 + motion.midMotion * 0.3 + motion.pulse * 0.15;
    ray.material.uniforms.uIntensity.value = intensity;
    ray.material.uniforms.uColor.value.copy(getHarmonizedColor(motion.midMotion, i / 12, config, palette, audio, music));
  });

  // Aurora
  if (auroraLayer) {
    auroraLayer.material.uniforms.uTime.value = t;
    auroraLayer.material.uniforms.uEnergy.value = motion.swell;
    auroraLayer.material.uniforms.uColorA.value.copy(new THREE.Color(config.colorPrimary));
    auroraLayer.material.uniforms.uColorB.value.copy(new THREE.Color(config.colorSecondary));
  }

  // Energy field
  if (energyFieldMesh) {
    energyFieldMesh.material.uniforms.uTime.value = t;
    energyFieldMesh.material.uniforms.uEnergy.value = motion.swell;
    energyFieldMesh.material.uniforms.uColor.value.copy(getHarmonizedColor(motion.swell, 0.5, config, palette, audio, music));
    energyFieldMesh.rotation.y = t * 0.1;
    energyFieldMesh.rotation.x = t * 0.05;
  }

  // Orbitals
  orbitalRings.forEach((ring, i) => {
    ring.rotation.x = t * ring.userData.speed;
    ring.rotation.z = t * ring.userData.speed * 0.7;
    ring.material.color.copy(getHarmonizedColor(motion.midMotion, i / 3, config, palette, audio, music));
    ring.material.opacity = 0.08 + motion.swell * 0.15;
  });

  // Shockwaves
  shockwaves.forEach(s => {
    if (!s.active) return;
    s.life -= dt * 1.8;
    if (s.life <= 0) {
      s.active = false;
      s.mesh.material.uniforms.uOpacity.value = 0;
      return;
    }
    s.mesh.quaternion.copy(camera.quaternion);
    s.mesh.scale.addScalar(dt * 22);
    s.mesh.material.uniforms.uOpacity.value = s.life * config.shockwaveIntensity * (s.strength || 1.0);
  });

  // Floating particles
  if (floatingParticles) {
    const fp = floatingParticles.geometry.attributes.position.array;
    const fc = floatingParticles.geometry.attributes.color.array;
    floatingData.forEach((fd, i) => {
      fd.theta += fd.speed * dt * 0.25;
      fd.phi += fd.speed * dt * 0.12;
      const bv = audio.getBand(fd.band);
      const rr = fd.r * (1 + bv * 0.2 + motion.swell * 0.1);
      fp[i * 3] = rr * Math.sin(fd.phi) * Math.cos(fd.theta);
      fp[i * 3 + 1] = rr * Math.sin(fd.phi) * Math.sin(fd.theta);
      fp[i * 3 + 2] = rr * Math.cos(fd.phi);
      const c = getHarmonizedColor(bv * 0.7, fd.band / 64, config, palette, audio, music);
      fc[i * 3] = c.r;
      fc[i * 3 + 1] = c.g;
      fc[i * 3 + 2] = c.b;
    });
    floatingParticles.geometry.attributes.position.needsUpdate = true;
    floatingParticles.geometry.attributes.color.needsUpdate = true;
  }

  // Camera
  const mode = config.autoPilot ? camState.autoMode : config.cameraMode;
  const cSpeed = config.cameraSpeed;
  const cShake = config.cameraShake;

  camState.autoAngleOffset = lerp(camState.autoAngleOffset, camState.autoAngleOffsetTarget, dt * 0.5);
  camState.autoHeightBias = lerp(camState.autoHeightBias, camState.autoHeightBiasTarget, dt * 0.5);
  camState.autoRoll = lerp(camState.autoRoll, camState.autoRollTarget, dt * 0.3);

  const camPhase = t * 2.0;
  switch (mode) {
    case 'orbit':
      camState.targetAngle = camPhase * 0.08 * cSpeed + camState.autoAngleOffset;
      camState.targetHeight = Math.sin(camPhase * 0.04 * cSpeed) * 8 + camState.autoHeightBias;
      camState.targetDistance = config.cameraDistance;
      break;
    case 'reactive':
      camState.targetAngle = camPhase * 0.06 * cSpeed + motion.swell * 0.3 + camState.autoAngleOffset;
      camState.targetHeight = motion.midMotion * 6 - 1 + camState.autoHeightBias;
      camState.targetDistance = config.cameraDistance - motion.swell * 4;
      camState.targetRoll = (motion.highMotion - 0.3) * 0.08;
      break;
    case 'cinematic':
      camState.targetAngle = Math.sin(camPhase * 0.02 * cSpeed) * 1.2 + camState.autoAngleOffset;
      camState.targetHeight = Math.cos(camPhase * 0.015 * cSpeed) * 6 + 2 + camState.autoHeightBias;
      camState.targetDistance = config.cameraDistance + Math.sin(camPhase * 0.01) * 5;
      break;
    case 'spiral':
      camState.targetAngle = camPhase * 0.12 * cSpeed + camState.autoAngleOffset;
      camState.targetHeight = Math.sin(camPhase * 0.08 * cSpeed) * 12 + camState.autoHeightBias;
      camState.targetDistance = config.cameraDistance + Math.cos(camPhase * 0.06) * 8;
      break;
    case 'figure8':
      camState.targetAngle = Math.sin(camPhase * 0.05 * cSpeed) * 1.5 + camState.autoAngleOffset;
      camState.targetHeight = Math.sin(camPhase * 0.1 * cSpeed) * Math.cos(camPhase * 0.05 * cSpeed) * 10 + camState.autoHeightBias;
      camState.targetDistance = config.cameraDistance;
      break;
    case 'vortex':
      camState.targetAngle = camPhase * 0.15 * cSpeed + motion.swell * 0.8 + camState.autoAngleOffset;
      camState.targetHeight = motion.highMotion * 5 + camState.autoHeightBias;
      camState.targetDistance = config.cameraDistance - motion.swell * 6;
      camState.targetRoll = camPhase * 0.02 * cSpeed;
      break;
    case 'pendulum':
      camState.targetAngle = Math.sin(camPhase * 0.04 * cSpeed) * 2 + camState.autoAngleOffset;
      camState.targetHeight = Math.abs(Math.sin(camPhase * 0.04 * cSpeed)) * 15 - 5 + camState.autoHeightBias;
      camState.targetDistance = config.cameraDistance;
      break;
    case 'flythrough':
      camState.targetAngle = camPhase * 0.1 * cSpeed + camState.autoAngleOffset;
      camState.targetHeight = Math.sin(camPhase * 0.05 * cSpeed) * 5 + camState.autoHeightBias;
      camState.targetDistance = config.cameraDistance + Math.sin(camPhase * 0.08 * cSpeed) * 15;
      break;
    case 'drunk':
      camState.drunk.x = lerp(camState.drunk.x, (Math.random() - 0.5) * 0.8, dt * 0.5);
      camState.drunk.y = lerp(camState.drunk.y, (Math.random() - 0.5) * 0.6, dt * 0.5);
      camState.drunk.z = lerp(camState.drunk.z, (Math.random() - 0.5) * 0.4, dt * 0.5);
      camState.targetAngle = camPhase * 0.05 * cSpeed + camState.drunk.x + camState.autoAngleOffset;
      camState.targetHeight = camState.drunk.y * 10 + camState.autoHeightBias;
      camState.targetDistance = config.cameraDistance + camState.drunk.z * 10;
      camState.targetRoll = camState.drunk.z * 0.3 + camState.autoRoll;
      break;
  }

  if (config.cameraBeatZoom) {
    camState.targetDistance += motion.zoomSuggestion * 8;
  }

  const camLerpBase = 1.8 - config.smoothness * 1.0;
  const camLerpSlow = camLerpBase * 0.8;

  camState.angle = lerp(camState.angle, camState.targetAngle, dt * camLerpBase);
  camState.height = lerp(camState.height, camState.targetHeight, dt * camLerpSlow);
  camState.distance = lerp(camState.distance, camState.targetDistance, dt * camLerpSlow);
  camState.roll = lerp(camState.roll, camState.targetRoll + camState.autoRoll, dt * camLerpSlow * 0.8);
  camState.look.lerp(camState.targetLook, dt * camLerpSlow);

  const shakeMultiplier = 1.0 - config.smoothness * 0.9;
  if (cShake > 0 && shakeMultiplier > 0.05) {
    const shakeAmt = motion.impact * cShake * 0.12 * shakeMultiplier;
    const shakeLerp = dt * (3.0 - config.smoothness * 2.0);
    camState.shake.x = lerp(camState.shake.x, (Math.random() - 0.5) * shakeAmt, shakeLerp);
    camState.shake.y = lerp(camState.shake.y, (Math.random() - 0.5) * shakeAmt, shakeLerp);
    camState.shake.z = lerp(camState.shake.z, (Math.random() - 0.5) * shakeAmt * 0.2, shakeLerp);
  } else {
    camState.shake.multiplyScalar(0.95);
  }

  camera.position.x = Math.cos(camState.angle) * camState.distance + camState.shake.x;
  camera.position.y = camState.height + camState.shake.y;
  camera.position.z = Math.sin(camState.angle) * camState.distance + camState.shake.z;
  camera.lookAt(camState.look);
  camState.appliedRoll = lerp(camState.appliedRoll, camState.roll, dt * 2);
  camera.rotation.z = camState.appliedRoll;

  // Post-processing
  bloomPass.strength = config.bloomStrength * (1 + motion.pulse * 0.2);
  bloomPass.radius = config.bloomRadius;
  screenFXPass.uniforms.uTime.value = t;
  screenFXPass.uniforms.uVignette.value = config.vignette;
  screenFXPass.uniforms.uGrain.value = config.grain;
  screenFXPass.uniforms.uAberration.value = config.aberration;
  screenFXPass.uniforms.uHigh.value = motion.highMotion;
  screenFXPass.uniforms.uAnamorphic.value = config.anamorphic;
  screenFXPass.uniforms.uScanlines.value = config.scanlines;
  screenFXPass.uniforms.uBeatPulse.value = config.beatFlash ? motion.pulse : 0;
  screenFXPass.uniforms.uGlitch.value = config.glitchAmount * (1 + motion.impact * 0.5);
  screenFXPass.uniforms.uKaleidoscope.value = config.visualMode === 'kaleidoscope' ? 1.0 : 0.0;
  screenFXPass.uniforms.uKaleidoscopeSegments.value = config.symmetry;
  screenFXPass.uniforms.uNegative.value = config.negativeSpace ? 1.0 : 0.0;
  const filmMap = { none: 0, cinematic: 1, vintage: 2, neon: 3, dream: 4 };
  screenFXPass.uniforms.uFilmLook.value = filmMap[config.filmLook] || 0;

  drawSpectrum();
  composer.render();
}

animate();

// ============================================================================
// UI BINDINGS
// ============================================================================

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.querySelector(`.settings-panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
  });
});

document.querySelectorAll('.toggle').forEach(toggle => {
  toggle.addEventListener('click', () => toggle.classList.toggle('active'));
});

// Sync layer sliders
const _psm = document.getElementById('particleSizeMult');
if (_psm) _psm.value = config.particleSizeMult;
const _pbr = document.getElementById('particleBrightness');
if (_pbr) _pbr.value = config.particleBrightness;
const _swi = document.getElementById('shockwaveIntensity');
if (_swi) _swi.value = config.shockwaveIntensity;
const _swt = document.getElementById('shockwaveImpactThreshold');
if (_swt) _swt.value = config.shockwaveImpactThreshold;
const _swc = document.getElementById('shockwaveCooldown');
if (_swc) _swc.value = config.shockwaveCooldown;

// Main controls
document.getElementById('form').addEventListener('change', e => {
  config.form = e.target.value;
  const result = buildMainGeometry(scene, config, vertexData, audio, clamp);
  wireframeMesh = result.wireframeMesh;
  particleSystem = result.particleSystem;
  connectionLines = result.connectionLines;
  rimMesh = result.rimMesh;
});

document.getElementById('density').addEventListener('input', e => {
  config.density = parseInt(e.target.value);
  const result = buildMainGeometry(scene, config, vertexData, audio, clamp);
  wireframeMesh = result.wireframeMesh;
  particleSystem = result.particleSystem;
  connectionLines = result.connectionLines;
  rimMesh = result.rimMesh;
});

document.getElementById('sensitivity').addEventListener('input', e => { config.sensitivity = parseFloat(e.target.value); });
document.getElementById('smoothness').addEventListener('input', e => { config.smoothness = parseFloat(e.target.value); });
document.getElementById('volume').addEventListener('input', e => { config.volume = parseFloat(e.target.value); if (gainNode) gainNode.gain.value = config.volume; });
document.getElementById('visualMode').addEventListener('change', e => { config.visualMode = e.target.value; });

// Model motion controls
document.getElementById('modelSpinSpeed').addEventListener('input', e => { config.modelSpinSpeed = parseFloat(e.target.value); });
document.getElementById('modelSpinAxis').addEventListener('change', e => { config.modelSpinAxis = e.target.value; });
document.getElementById('modelSpinReactivity').addEventListener('input', e => { config.modelSpinReactivity = parseFloat(e.target.value); });
document.getElementById('modelPulseAmount').addEventListener('input', e => { config.modelPulseAmount = parseFloat(e.target.value); });

document.getElementById('toggleModelSpin').addEventListener('click', e => { config.modelSpinEnabled = e.target.classList.contains('active'); });
document.getElementById('toggleModelSpinReactive').addEventListener('click', e => { config.modelSpinReactive = e.target.classList.contains('active'); });
document.getElementById('toggleModelPulse').addEventListener('click', e => { config.modelPulseEnabled = e.target.classList.contains('active'); });

// Color controls
document.getElementById('colorTheme').addEventListener('change', e => { config.colorTheme = e.target.value; applyColorTheme(scene, bgUniforms, config, colorThemes); });
document.getElementById('colorPrimary').addEventListener('input', e => { config.colorPrimary = e.target.value; bgUniforms.uAccentA.value.set(config.colorPrimary); });
document.getElementById('colorSecondary').addEventListener('input', e => { config.colorSecondary = e.target.value; bgUniforms.uAccentB.value.set(config.colorSecondary); });
document.getElementById('colorBg').addEventListener('input', e => { config.colorBg = e.target.value; scene.fog.color.set(config.colorBg); bgUniforms.uBgColor.value.set(config.colorBg); });
document.getElementById('colorReactivity').addEventListener('input', e => { config.colorReactivity = parseFloat(e.target.value); });
document.getElementById('hueRotateSpeed').addEventListener('input', e => { config.hueRotateSpeed = parseFloat(e.target.value); });
document.getElementById('toggleBarLockColors').addEventListener('click', e => { config.barLockColors = e.target.classList.contains('active'); });

// Camera controls
document.getElementById('cameraMode').addEventListener('change', e => { config.cameraMode = e.target.value; camState.autoMode = e.target.value; });
document.getElementById('cameraDistance').addEventListener('input', e => { config.cameraDistance = parseFloat(e.target.value); });
document.getElementById('cameraSpeed').addEventListener('input', e => { config.cameraSpeed = parseFloat(e.target.value); });
document.getElementById('cameraShake').addEventListener('input', e => { config.cameraShake = parseFloat(e.target.value); });
document.getElementById('cameraFov').addEventListener('input', e => { config.cameraFov = parseFloat(e.target.value); camera.fov = config.cameraFov; camera.updateProjectionMatrix(); });
document.getElementById('toggleBeatZoom').addEventListener('click', e => { config.cameraBeatZoom = e.target.classList.contains('active'); });
document.getElementById('toggleAutoAngles').addEventListener('click', e => { config.cameraAutoAngles = e.target.classList.contains('active'); });

// Particle controls
document.getElementById('particleMode').addEventListener('change', e => { config.particleMode = e.target.value; });
document.getElementById('fieldMode').addEventListener('change', e => { config.fieldMode = e.target.value; });
document.getElementById('symmetry').addEventListener('change', e => { config.symmetry = parseInt(e.target.value); });
document.getElementById('turbulence').addEventListener('input', e => { config.turbulence = parseFloat(e.target.value); });
document.getElementById('cohesion').addEventListener('input', e => { config.cohesion = parseFloat(e.target.value); });
document.getElementById('particleCount').addEventListener('change', e => { config.particleCount = parseInt(e.target.value); });

// Layer controls
document.getElementById('toggleInner').addEventListener('click', e => { config.showInner = e.target.classList.contains('active'); if (innerMesh) innerMesh.visible = config.showInner; });
document.getElementById('toggleOuter').addEventListener('click', e => { config.showOuter = e.target.classList.contains('active'); if (outerMesh) outerMesh.visible = config.showOuter; });
document.getElementById('toggleWaveform').addEventListener('click', e => { config.showWaveform = e.target.classList.contains('active'); if (waveformRing) waveformRing.visible = config.showWaveform; });
document.getElementById('toggleBars').addEventListener('click', e => { config.showBars = e.target.classList.contains('active'); freqBars.forEach(b => b.visible = config.showBars); });
document.getElementById('toggleConnections').addEventListener('click', e => { config.showConnections = e.target.classList.contains('active'); if (connectionLines) connectionLines.visible = config.showConnections; });
document.getElementById('toggleParticles').addEventListener('click', e => { config.showParticles = e.target.classList.contains('active'); if (particleSystem) particleSystem.visible = config.showParticles; });
document.getElementById('toggleShockwaves').addEventListener('click', e => { config.showShockwaves = e.target.classList.contains('active'); shockwaves.forEach(s => s.mesh.visible = config.showShockwaves); });
document.getElementById('toggleLightRays').addEventListener('click', e => { config.showLightRays = e.target.classList.contains('active'); buildLightRays(); });
document.getElementById('toggleAurora').addEventListener('click', e => { config.showAurora = e.target.classList.contains('active'); buildAurora(); });
document.getElementById('toggleEnergyField').addEventListener('click', e => { config.showEnergyField = e.target.classList.contains('active'); buildEnergyField(); });
document.getElementById('toggleOrbitals').addEventListener('click', e => { config.showOrbitals = e.target.classList.contains('active'); buildOrbitals(); });

// Effects controls
document.getElementById('bloomStrength').addEventListener('input', e => { config.bloomStrength = parseFloat(e.target.value); });
document.getElementById('bloomRadius').addEventListener('input', e => { config.bloomRadius = parseFloat(e.target.value); });
document.getElementById('trailMode').addEventListener('change', e => { config.trailMode = e.target.value; updateTrailMode(afterimagePass, config.trailMode); });
document.getElementById('glitchAmount').addEventListener('input', e => { config.glitchAmount = parseFloat(e.target.value); });
document.getElementById('vignette').addEventListener('input', e => { config.vignette = parseFloat(e.target.value); });
document.getElementById('grain').addEventListener('input', e => { config.grain = parseFloat(e.target.value); });
document.getElementById('aberration').addEventListener('input', e => { config.aberration = parseFloat(e.target.value); });
document.getElementById('anamorphic').addEventListener('input', e => { config.anamorphic = parseFloat(e.target.value); });
document.getElementById('scanlines').addEventListener('input', e => { config.scanlines = parseFloat(e.target.value); });
document.getElementById('filmLook').addEventListener('change', e => { config.filmLook = e.target.value; });

// Environment controls
document.getElementById('environment').addEventListener('change', e => { config.environment = e.target.value; buildEnvironment(); });
document.getElementById('fogDensity').addEventListener('input', e => { config.fogDensity = parseFloat(e.target.value); scene.fog.density = config.fogDensity; });
document.getElementById('ringCount').addEventListener('input', e => { config.ringCount = parseInt(e.target.value); rings = buildRings(scene, config); });
document.getElementById('bgPattern').addEventListener('change', e => { config.bgPattern = e.target.value; setBgPatternFromConfig(bgUniforms, config); });
document.getElementById('bgPatternStrength').addEventListener('input', e => { config.bgPatternStrength = parseFloat(e.target.value); });

// Extra controls
document.getElementById('toggleSpectrum').addEventListener('click', e => { config.showSpectrum = e.target.classList.contains('active'); });
document.getElementById('toggleAutoPilot').addEventListener('click', e => { config.autoPilot = e.target.classList.contains('active'); });
document.getElementById('toggleBeatFlash').addEventListener('click', e => { config.beatFlash = e.target.classList.contains('active'); });
document.getElementById('toggleColorCycle').addEventListener('click', e => { config.colorCycle = e.target.classList.contains('active'); });
document.getElementById('toggleSynesthesia').addEventListener('click', e => { config.synesthesia = e.target.classList.contains('active'); });
document.getElementById('toggleHarmonicSnap').addEventListener('click', e => { config.harmonicSnap = e.target.classList.contains('active'); });
document.getElementById('toggleNegativeSpace').addEventListener('click', e => { config.negativeSpace = e.target.classList.contains('active'); if (rimMesh) rimMesh.visible = config.negativeSpace; wireframeMesh.material.blending = config.negativeSpace ? THREE.NormalBlending : THREE.AdditiveBlending; });
document.getElementById('toggleReactiveBg').addEventListener('click', e => { config.reactiveBg = e.target.classList.contains('active'); });

// Playback controls
const playBtn = document.getElementById('playBtn');
const playIcon = document.getElementById('playIcon');
const pauseIcon = document.getElementById('pauseIcon');

document.getElementById('file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) {
    audio.setFFTInfo(analyser.fftSize, audioCtx.sampleRate);
    audioEl.src = URL.createObjectURL(file);
    audioEl.load();
  }
});

playBtn.addEventListener('click', () => {
  if (!audioEl.src) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  if (audioEl.paused) {
    audioEl.play();
    playing = true;
    playIcon.style.display = 'none';
    pauseIcon.style.display = 'block';
  } else {
    audioEl.pause();
    playing = false;
    playIcon.style.display = 'block';
    pauseIcon.style.display = 'none';
  }
});

audioEl.addEventListener('ended', () => {
  playing = false;
  playIcon.style.display = 'block';
  pauseIcon.style.display = 'none';
});

// Recording
let mediaRecorder, recordedChunks = [];
document.getElementById('recordBtn').addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    document.getElementById('rec-indicator').classList.remove('active');
    return;
  }

  const canvasStream = renderer.domElement.captureStream(60);
  const audioStream = mediaDest.stream;
  const combined = new MediaStream([...canvasStream.getTracks(), ...audioStream.getTracks()]);
  mediaRecorder = new MediaRecorder(combined, { mimeType: 'video/webm; codecs=vp9', videoBitsPerSecond: 8000000 });
  recordedChunks = [];
  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'geometric_resonance_ultra.webm';
    a.click();
  };
  mediaRecorder.start();
  document.getElementById('rec-indicator').classList.add('active');
});

document.getElementById('randomBtn').addEventListener('click', randomize);
document.getElementById('fullscreenBtn').addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  switch (e.key.toLowerCase()) {
    case ' ':
      e.preventDefault();
      playBtn.click();
      break;
    case 'u':
      document.getElementById('ui').classList.toggle('hidden');
      break;
    case 'r':
      randomize();
      break;
    case 'f':
      document.getElementById('fullscreenBtn').click();
      break;
    case 'p':
      openPresetModal();
      break;
    case '1': case '2': case '3': case '4': case '5': case '6': case '7': case '8':
      const tabs = document.querySelectorAll('.tab');
      const idx = parseInt(e.key) - 1;
      if (tabs[idx]) tabs[idx].click();
      break;
  }
});

// Resize handler
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloomPass.resolution.set(w, h);
  bgUniforms.uResolution.value.set(w, h);
  screenFXPass.uniforms.uResolution.value.set(w, h);
  specCanvas.width = w;
});
