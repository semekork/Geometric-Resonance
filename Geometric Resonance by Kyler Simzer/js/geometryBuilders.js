import * as THREE from 'three';
import { TAU } from './utils.js';

// ============================================================================
// GEOMETRY CREATION
// ============================================================================

export function createParametricGeometry(func, slices, stacks, scale = 8) {
  const geometry = new THREE.BufferGeometry();
  const vertices = [], indices = [];
  for (let i = 0; i <= stacks; i++) {
    const v = i / stacks;
    for (let j = 0; j <= slices; j++) {
      const u = j / slices, point = func(u, v);
      vertices.push(point.x * scale, point.y * scale, point.z * scale);
    }
  }
  for (let i = 0; i < stacks; i++) {
    for (let j = 0; j < slices; j++) {
      const a = i * (slices + 1) + j, b = a + slices + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createGeometry(type, detail) {
  const segments = 8 + detail * 8;
  switch (type) {
    case 'icosahedron':
      return new THREE.IcosahedronGeometry(8, detail);
    case 'octahedron':
      return new THREE.OctahedronGeometry(9, detail);
    case 'tetrahedron':
      return new THREE.TetrahedronGeometry(10, detail);
    case 'dodecahedron':
      return new THREE.DodecahedronGeometry(8, detail);
    case 'torus':
      return new THREE.TorusGeometry(6, 2.5, 12 * detail, 24 * detail);
    case 'torusKnot':
      return new THREE.TorusKnotGeometry(5, 1.5, 64 * detail, 8 * detail);
    case 'sphere':
      return new THREE.SphereGeometry(8, 16 * detail, 16 * detail);
    case 'hyperboloid':
      return createParametricGeometry((u, v) => {
        const theta = u * TAU, t = (v - 0.5) * 3;
        return { x: Math.sqrt(1 + t * t) * Math.cos(theta), y: t, z: Math.sqrt(1 + t * t) * Math.sin(theta) };
      }, segments, segments, 5);
    case 'mobius':
      return createParametricGeometry((u, v) => {
        const theta = u * TAU, w = (v - 0.5) * 2, r = 2 + w * Math.cos(theta / 2);
        return { x: r * Math.cos(theta), y: w * Math.sin(theta / 2), z: r * Math.sin(theta) };
      }, segments * 2, Math.max(4, detail * 2), 3);
    case 'kleinBottle':
      return createParametricGeometry((u, v) => {
        const theta = u * TAU, phi = v * TAU, rr = 4;
        let x, y, z;
        if (theta < Math.PI) {
          x = 6 * Math.cos(theta) * (1 + Math.sin(theta)) + rr * (1 - Math.cos(theta) / 2) * Math.cos(theta) * Math.cos(phi);
          z = 16 * Math.sin(theta) + rr * (1 - Math.cos(theta) / 2) * Math.sin(theta) * Math.cos(phi);
        } else {
          x = 6 * Math.cos(theta) * (1 + Math.sin(theta)) + rr * (1 - Math.cos(theta) / 2) * Math.cos(phi + Math.PI);
          z = 16 * Math.sin(theta);
        }
        y = rr * (1 - Math.cos(theta) / 2) * Math.sin(phi);
        return { x: x * 0.25, y: y * 0.25, z: (z - 8) * 0.25 };
      }, segments * 2, segments, 4);
    case 'gyroid':
      return createParametricGeometry((u, v) => {
        const theta = u * TAU, phi = v * Math.PI;
        const r = 1 + 0.3 * (Math.sin(theta * 2) * Math.cos(phi * 3) + Math.sin(phi * 2) * Math.cos(theta * 3) + Math.sin(theta * 3) * Math.sin(phi * 2));
        return { x: r * Math.sin(phi) * Math.cos(theta), y: r * Math.cos(phi), z: r * Math.sin(phi) * Math.sin(theta) };
      }, segments * 2, segments * 2, 6);
    case 'cliffordTorus':
      return createParametricGeometry((u, v) => {
        const theta = u * TAU, phi = v * TAU, rr = 0.7071;
        const ww = rr * Math.cos(theta), x = rr * Math.sin(theta), y = rr * Math.cos(phi), z = rr * Math.sin(phi);
        const scale = 1 / (1 - ww + 0.01);
        return { x: x * scale, y: y * scale, z: z * scale };
      }, segments * 2, segments * 2, 4);
    case 'hopfFibration':
      return createParametricGeometry((u, v) => {
        const theta = u * TAU * 2, phi = v * TAU, rr = 1.5;
        return {
          x: rr * (Math.cos(theta) + Math.cos(phi) * Math.cos(theta + phi)),
          y: rr * (Math.sin(theta) + Math.cos(phi) * Math.sin(theta + phi)),
          z: rr * Math.sin(phi)
        };
      }, segments * 3, segments * 2, 3);
    case 'seashell':
      return createParametricGeometry((u, v) => {
        const theta = u * TAU * 3, s = v * TAU;
        const W = (s / TAU) * Math.exp(theta / (TAU * 2));
        return {
          x: W * Math.cos(theta) * (1 + Math.cos(s)) * 2,
          y: W * Math.sin(theta) * (1 + Math.cos(s)) * 2,
          z: (W * Math.sin(s) - 0.2 * Math.pow(theta / TAU, 2)) * 2 + 4
        };
      }, segments * 3, segments, 2);
    case 'diniSurface':
      return createParametricGeometry((u, v) => {
        const aa = 1, b = 0.2, uu = u * TAU * 2, vv = 0.01 + v * 1.5;
        return {
          x: aa * Math.cos(uu) * Math.sin(vv),
          y: aa * Math.sin(uu) * Math.sin(vv),
          z: (aa * (Math.cos(vv) + Math.log(Math.tan(vv / 2))) + b * uu) * 0.3
        };
      }, segments * 2, segments, 3);
    default:
      return new THREE.IcosahedronGeometry(8, detail);
  }
}
