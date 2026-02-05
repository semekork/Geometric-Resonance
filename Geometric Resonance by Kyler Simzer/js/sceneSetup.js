import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { config, colorThemes } from './config.js';
import { shaders } from './shaders.js';

// ============================================================================
// SCENE SETUP & RENDERER INITIALIZATION
// ============================================================================

export function initRenderer() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  document.body.appendChild(renderer.domElement);
  renderer.domElement.id = 'canvas';
  return renderer;
}

export function initBackgroundScene(config) {
  const bgScene = new THREE.Scene();
  const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const bgUniforms = {
    uTime: { value: 0 },
    uPhase: { value: 0 },
    uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    uBgColor: { value: new THREE.Color(config.colorBg) },
    uAccentA: { value: new THREE.Color(config.colorPrimary) },
    uAccentB: { value: new THREE.Color(config.colorSecondary) },
    uPattern: { value: 0 },
    uPatternStrength: { value: config.bgPatternStrength },
    uSymmetry: { value: config.symmetry },
    uEnergy: { value: 0 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uHigh: { value: 0 },
    uNegative: { value: 0 },
    uBeatPulse: { value: 0 },
    uReactiveBg: { value: 1 }
  };

  bgScene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: bgUniforms,
        vertexShader: shaders.bgVert,
        fragmentShader: shaders.bgFrag,
        depthTest: false,
        depthWrite: false
      })
    )
  );

  return { scene: bgScene, camera: bgCam, uniforms: bgUniforms };
}

export function initMainScene(config) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(config.colorBg, config.fogDensity);

  const camera = new THREE.PerspectiveCamera(
    config.cameraFov,
    window.innerWidth / window.innerHeight,
    0.1,
    500
  );
  camera.position.set(0, 0, config.cameraDistance);

  scene.add(new THREE.AmbientLight(0xffffff, 0.25));

  const mainLight = new THREE.PointLight(0xffffff, 1.2, 120);
  mainLight.position.set(20, 20, 20);
  scene.add(mainLight);

  const fillLight = new THREE.PointLight(0x4488ff, 0.4, 80);
  fillLight.position.set(-15, -10, -20);
  scene.add(fillLight);

  return { scene, camera };
}

export function initPostProcessing(renderer, bgScene, bgCam, mainScene, mainCamera, config) {
  renderer.autoClear = false;

  const composer = new EffectComposer(renderer);

  // Background pass
  const bgPass = new RenderPass(bgScene, bgCam);
  bgPass.clear = true;
  composer.addPass(bgPass);

  // Main scene pass
  const mainPass = new RenderPass(mainScene, mainCamera);
  mainPass.clear = false;
  composer.addPass(mainPass);

  // Trails
  const afterimagePass = new AfterimagePass();
  afterimagePass.enabled = config.trailMode !== 'none';
  composer.addPass(afterimagePass);

  // Bloom
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    config.bloomStrength,
    config.bloomRadius,
    0.12
  );
  bloomPass.threshold = 0.12;
  composer.addPass(bloomPass);

  // Screen FX
  const screenFXPass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      uVignette: { value: config.vignette },
      uGrain: { value: config.grain },
      uAberration: { value: config.aberration },
      uHigh: { value: 0 },
      uAnamorphic: { value: config.anamorphic },
      uScanlines: { value: config.scanlines },
      uKaleidoscope: { value: 0 },
      uKaleidoscopeSegments: { value: 6 },
      uFilmLook: { value: 0 },
      uBeatPulse: { value: 0 },
      uGlitch: { value: 0 },
      uNegative: { value: 0 }
    },
    vertexShader: shaders.screenVert,
    fragmentShader: shaders.screenFrag
  });
  composer.addPass(screenFXPass);

  return { composer, bloomPass, afterimagePass, screenFXPass };
}

export function updateTrailMode(afterimagePass, trailMode) {
  switch (trailMode) {
    case
 'none':
      afterimagePass.enabled = false;
      break;
    case 'light':
      afterimagePass.enabled = true;
      afterimagePass.uniforms.damp.value = 0.82;
      break;
    case 'medium':
      afterimagePass.enabled = true;
      afterimagePass.uniforms.damp.value = 0.91;
      break;
    case 'heavy':
      afterimagePass.enabled = true;
      afterimagePass.uniforms.damp.value = 0.96;
      break;
    case 'smear':
      afterimagePass.enabled = true;
      afterimagePass.uniforms.damp.value = 0.985;
      break;
  }
}

export function initAudio() {
  const audioEl = document.getElementById('audio');
  if (typeof AudioContext === 'undefined' && typeof webkitAudioContext !== 'undefined') {
    var AudioContext = webkitAudioContext;
  }

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const sourceNode = audioCtx.createMediaElementSource(audioEl);
  const analyser = audioCtx.createAnalyser();

  analyser.fftSize = 8192;
  analyser.smoothingTimeConstant = 0.0;
  analyser.minDecibels = -90;
  analyser.maxDecibels = -10;

  const gainNode = audioCtx.createGain();
  gainNode.gain.value = config.volume;

  const highpass = audioCtx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 20;
  highpass.Q.value = 0.7;

  const compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.knee.value = 30;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;

  const mediaDest = audioCtx.createMediaStreamDestination();

  sourceNode.connect(highpass);
  highpass.connect(compressor);
  compressor.connect(analyser);
  analyser.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  gainNode.connect(mediaDest);

  const freqData = new Uint8Array(analyser.frequencyBinCount);
  const timeData = new Uint8Array(analyser.fftSize);

  return { audioEl, audioCtx, analyser, sourceNode, gainNode, mediaDest, freqData, timeData };
}
