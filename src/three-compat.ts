// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// The one copy of three this app ships: the WebGPU build, which also carries the WebGL 2 fallback backend.
// vite.config.ts points the bare "three" import (fiber, drei, three-stdlib) here.
//
// drei and three-stdlib name six WebGL-only exports that the WebGPU build doesn't have, in modules this
// page never runs. Rollup can shim those at build time (`shimMissingExports`), but Vite 6's dev server
// pre-bundles dependencies with esbuild, which has no such option and stops with
// `No matching export in "node_modules/three/build/three.webgpu.js" for import "WebGLRenderer"` (55 errors).
//
// The dev server also evaluates whole dependency modules (nothing is tree-shaken), and a few of them
// touch these names at load time, for example `UniformsUtils.clone(ShaderLib.physical.uniforms)`. With
// plain `undefined` the scene failed to start in dev with
// `Cannot read properties of undefined (reading 'clone')`. So each name is one inert stand-in: any
// property read, call or `new` on it gives the stand-in back, and it turns into "" in a string.
// Nothing this page draws uses it. Both renderer paths go through THREE.WebGPURenderer in scene/Stage.tsx.
export * from "three/webgpu";

// biome-ignore lint/suspicious/noExplicitAny: the stand-in has to pass for every class, function and constant it replaces.
const inert: any = new Proxy(function inertThreeExport() {}, {
  get: (_target, key) => (key === Symbol.toPrimitive ? () => "" : inert),
  apply: () => inert,
  construct: () => inert,
});

export const WebGLRenderer = inert;
export const WebGLCubeRenderTarget = inert;
export const UniformsUtils = inert;
export const UniformsLib = inert;
export const ShaderLib = inert;
export const ShaderChunk = inert;

// ExtrudeGeometry, ObjectLoader and NodeObjectLoader are shadowed here on purpose. fiber registers
// every export of "three" as a JSX element, which would keep three's ExtrudeGeometry in the bundle
// even though nothing on the page extrudes anything (ObjectLoader and NodeObjectLoader
// keep a table of every geometry class). A local export wins over `export *`, so three's own
// classes are no longer reachable through "three". The production build goes one step
// further and leaves these three names out altogether (see `shareableThree` in vite.config.ts).
export const ExtrudeGeometry = inert;
export const ObjectLoader = inert;
export const NodeObjectLoader = inert;
