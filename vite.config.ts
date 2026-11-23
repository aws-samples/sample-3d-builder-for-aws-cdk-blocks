// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const compat = fileURLToPath(new URL('./src/three-compat.ts', import.meta.url));

// Exports of "three" that the production bundle leaves out. fiber registers every export of
// "three" as a JSX element, so anything exported there ships whether the page uses it or not.
// The page extrudes nothing; ObjectLoader and NodeObjectLoader keep a table of every geometry
// class, ExtrudeGeometry included.
const STRIPPED = ['ExtrudeGeometry', 'ObjectLoader', 'NodeObjectLoader'];
const SHAREABLE_THREE = 'virtual:three-shareable';

/**
 * Production build only: "three" resolves to a module that re-exports
 * src/three-compat.ts name by name, leaving out STRIPPED. The names are read from the installed
 * three at build time, so the list can't go stale. A module that names a stripped export itself
 * (three-stdlib's TextGeometry is the only one today) gets src/three-compat.ts, where those names
 * are inert stand-ins; the page never runs it and Rollup drops it.
 */
function shareableThree(): Plugin {
  return {
    name: 'baseplate-shareable-three',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === SHAREABLE_THREE) return `\0${SHAREABLE_THREE}`;
      if (source !== 'three') return undefined;
      if (!importer || importer.startsWith('\0')) return compat;
      let text = '';
      try {
        text = readFileSync(importer.replace(/\?.*$/, ''), 'utf8');
      } catch {
        // Not a file on disk: treat it like any other importer.
      }
      // STRIPPED is a fixed list of class names in this file, so the pattern holds no outside input.
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
      return STRIPPED.some((n) => new RegExp(`\\b${n}\\b`).test(text)) ? compat : `\0${SHAREABLE_THREE}`;
    },
    async load(id) {
      if (id !== `\0${SHAREABLE_THREE}`) return;
      const names = Object.keys(await import('three/webgpu')).filter((n) => n !== 'default' && !STRIPPED.includes(n));
      // The six WebGL-only names three-compat.ts adds for drei and three-stdlib.
      const added = ['WebGLRenderer', 'WebGLCubeRenderTarget', 'UniformsUtils', 'UniformsLib', 'ShaderLib', 'ShaderChunk'].filter(
        (n) => !names.includes(n),
      );
      return `export { ${[...names, ...added].join(', ')} } from ${JSON.stringify(compat)};\n`;
    },
  };
}

/** The build ships the third-party license texts next to the code and fonts they cover. */
function thirdPartyLicenses(): Plugin {
  return {
    name: 'baseplate-third-party-licenses',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD-PARTY-LICENSES.txt',
        source: readFileSync(new URL('./THIRD-PARTY-LICENSES', import.meta.url), 'utf8'),
      });
    },
  };
}

export default defineConfig(({ command }) => {
  const strip = command === 'build';
  return {
    plugins: [react(), thirdPartyLicenses(), ...(strip ? [shareableThree()] : [])],
    resolve: {
      conditions: ['browser'],
      // One copy of three: point the bare "three" import (fiber, drei) at the WebGPU build,
      // which also carries the WebGL 2 fallback backend. It goes through src/three-compat.ts,
      // which re-exports three/webgpu and names the six WebGL-only exports the WebGPU build lacks.
      // The production build resolves "three" in the plugin above instead.
      alias: strip ? [] : [{ find: /^three$/, replacement: compat }],
    },
    build: {
      outDir: 'dist',
      target: 'es2022',
      chunkSizeWarningLimit: 4000,
      // drei and three-stdlib name a few WebGL-only exports in modules this page never runs.
      // Rollup shims them for the build. The dev server needs src/three-compat.ts as well.
      rollupOptions: { shimMissingExports: true },
    },
  };
});
