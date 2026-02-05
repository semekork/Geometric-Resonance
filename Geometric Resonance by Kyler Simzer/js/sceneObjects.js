import * as THREE from 'three';
import { TAU, clamp, lerp } from './utils.js';
import { createGeometry } from './geometryBuilders.js';
import { shaders } from './shaders.js';

// ============================================================================
// SCENE OBJECT BUILDERS
// ============================================================================

export function buildMainGeometry(scene, config, vertexData, audio, clampFunc) {
  let wireframeMesh, particleSystem, connectionLines, rimMesh;

  if (wireframeMesh) scene.remove(wireframeMesh);
  if (rimMesh) scene.remove(rimMesh);
  if (particleSystem) scene.remove(particleSystem);
  if (connectionLines) scene.remove(connectionLines);

  const geom = createGeometry(config.form, config.density);

  wireframeMesh = new THREE.LineSegments(
    new THREE.WireframeGeometry(geom),
    new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending
    })
  );
  wireframeMesh.visible = config.showWireframeCore;
  scene.add(wireframeMesh);

  rimMesh = new THREE.Mesh(
    geom,
    new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(1, 1, 1) },
        uIntensity: { value: 1.0 },
        uPower: { value: 2.6 },
        uTime: { value: 0 }
      },
      vertexShader: shaders.rimVert,
      fragmentShader: shaders.rimFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  rimMesh.visible = config.showRimGlow;
  scene.add(rimMesh);

  // Build vertex data
  const posArr = geom.attributes.position.array;
  const uniqueSet = new Set();
  vertexData.length = 0;
  for (let i = 0; i < posArr.length; i += 3) {
    const key = `${posArr[i].toFixed(2)},${posArr[i + 1].toFixed(2)},${posArr[i + 2].toFixed(2)}`;
    if (!uniqueSet.has(key)) {
      uniqueSet.add(key);
      const v = new THREE.Vector3(posArr[i], posArr[i + 1], posArr[i + 2]);
      const norm = v.clone().normalize();
      vertexData.push({
        base: v.clone(),
        current: v.clone(),
        velocity: new THREE.Vector3(),
        band: Math.floor(
          ((Math.atan2(norm.z, norm.x) + Math.PI) / TAU) * 32 + (Math.acos(clampFunc(norm.y, -1, 1)) / Math.PI) * 32
        ) % 64,
        phase: Math.random() * TAU,
        theta: Math.atan2(norm.z, norm.x),
        phi: Math.acos(clampFunc(norm.y, -1, 1)),
        isExtra: false
      });
    }
  }

  while (vertexData.length < config.particleCount) {
    const theta = Math.random() * TAU;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 2 + Math.random() * 8;
    const v = new THREE.Vector3(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi)
    );
    vertexData.push({
      base: v.clone(),
      current: v.clone(),
      velocity: new THREE.Vector3((Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.1),
      band: Math.floor(Math.random() * 64),
      phase: Math.random() * TAU,
      theta: Math.atan2(v.z, v.x),
      phi: Math.acos(clampFunc(v.clone().normalize().y, -1, 1)),
      isExtra: true
    });
  }

  // Create particle system
  const pGeom = new THREE.BufferGeometry();
  const pPos = new Float32Array(vertexData.length * 3);
  const pCol = new Float32Array(vertexData.length * 3);
  const pSize = new Float32Array(vertexData.length);
  vertexData.forEach((vd, i) => {
    pPos[i * 3] = vd.current.x;
    pPos[i * 3 + 1] = vd.current.y;
    pPos[i * 3 + 2] = vd.current.z;
    pCol[i * 3] = pCol[i * 3 + 1] = pCol[i * 3 + 2] = 1;
    pSize[i] = 0.15 + Math.random() * 0.1;
  });
  pGeom.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeom.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  pGeom.setAttribute('size', new THREE.BufferAttribute(pSize, 1));

  particleSystem = new THREE.Points(
    pGeom,
    new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uEnergy: { value: 0 },
        uPixelRatio: { value: window.devicePixelRatio },
        uSizeMult: { value: 1.0 },
        uBrightness: { value: 1.0 }
      },
      vertexShader: shaders.particleVert,
      fragmentShader: shaders.particleFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  scene.add(particleSystem);

  // Connection lines
  const lineGeom = new THREE.BufferGeometry();
  lineGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3000 * 6), 3));
  lineGeom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(3000 * 6), 3));
  lineGeom.setDrawRange(0, 0);
  connectionLines = new THREE.LineSegments(
    lineGeom,
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending
    })
  );
  scene.add(connectionLines);
  connectionLines.visible = config.showConnections;
  particleSystem.visible = config.showParticles;

  return { wireframeMesh, particleSystem, connectionLines, rimMesh, vertexData };
}

export function buildSecondary(scene, config) {
  let innerMesh, outerMesh;

  if (innerMesh) scene.remove(innerMesh);
  if (outerMesh) scene.remove(outerMesh);

  innerMesh = new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(3, 1)),
    new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.15,
      blending: THREE.AdditiveBlending
    })
  );
  innerMesh.visible = config.showInner;
  scene.add(innerMesh);

  outerMesh = new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(16, 0)),
    new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.04,
      blending: THREE.AdditiveBlending
    })
  );
  outerMesh.visible = config.showOuter;
  scene.add(outerMesh);

  return { innerMesh, outerMesh };
}

export function buildWaveformRing(scene, config) {
  let waveformRing;
  if (waveformRing) scene.remove(waveformRing);

  const positions = new Float32Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const ang = (i / 256) * TAU;
    positions[i * 3] = Math.cos(ang) * 12;
    positions[i * 3 + 2] = Math.sin(ang) * 12;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  waveformRing = new THREE.LineLoop(
    geom,
    new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending
    })
  );
  waveformRing.rotation.x = Math.PI / 2;
  waveformRing.visible = config.showWaveform;
  scene.add(waveformRing);

  return waveformRing;
}

export function buildFreqBars(scene, config) {
  let freqBars = [];
  freqBars.forEach(b => scene.remove(b));
  freqBars = [];

  for (let i = 0; i < 64; i++) {
    const ang = (i / 64) * TAU;
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 1, 0.3),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending
      })
    );
    bar.position.set(Math.cos(ang) * 16, -15, Math.sin(ang) * 16);
    bar.rotation.y = -ang;
    bar.userData = { index: i, baseY: -15 };
    bar.visible = config.showBars;
    freqBars.push(bar);
    scene.add(bar);
  }

  return freqBars;
}

export function buildRings(scene, config) {
  let rings = [];
  rings.forEach(r => scene.remove(r));
  rings = [];

  for (let i = 0; i < config.ringCount; i++) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(12 + i * 5, 12.1 + i * 5, 128),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.03,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
      })
    );
    ring.userData = { index: i };
    ring.visible = config.showRings;
    rings.push(ring);
    scene.add(ring);
  }

  return rings;
}

export function buildShockwaves(scene, config) {
  let shockwaves = [];
  shockwaves.forEach(s => scene.remove(s.mesh));
  shockwaves.length = 0;

  if (!config.showShockwaves) return shockwaves;

  const geom = new THREE.RingGeometry(0.9, 1.28, 192, 1);
  for (let i = 0; i < 12; i++) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(1, 1, 1) },
        uOpacity: { value: 0 }
      },
      vertexShader: shaders.shockwaveVert,
      fragmentShader: shaders.shockwaveFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.visible = config.showShockwaves;
    scene.add(mesh);
    shockwaves.push({ mesh, life: 0, active: false, strength: 1.0 });
  }

  return shockwaves;
}

export function spawnShockwave(shockwaves, config, color, strength = 1.0) {
  if (!config.showShockwaves || shockwaves.length === 0) return;

  const s = shockwaves.find(x => !x.active) || shockwaves[0];
  s.active = true;
  s.life = 1.0;
  s.strength = clamp(strength, 0.15, 1.25);
  s.mesh.scale.setScalar(1.0);
  s.mesh.position.set(0, 0, 0);
  s.mesh.material.uniforms.uOpacity.value = config.shockwaveIntensity * s.strength;
  s.mesh.material.uniforms.uColor.value.copy(color);
}
