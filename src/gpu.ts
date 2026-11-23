// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

type Backend = "webgpu" | "webgl2" | "none";

export interface RendererInfo {
  backend: Backend;
  renderer: string;
}

declare global {
  interface Window {
    __renderer?: RendererInfo;
    __firstFrame?: number;
    __toy?: unknown;
    __tiles?: { groups: unknown[]; types: string[] };
    __atlasReady?: boolean;
    /** The master layout the scene draws from (plan coordinates), for browser checks. */
    __plate?: { slots: unknown; anchors: unknown; paths: unknown };
    /** For browser checks: the footprint each brick stands on right now (its plate slot, or its place in the side-by-side offer). */
    __brickRects?: unknown;
  }
}

interface AdapterLike {
  info?: { vendor?: string; architecture?: string; device?: string; description?: string };
}

export function webglRendererString(gl: WebGL2RenderingContext | WebGLRenderingContext): string {
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
}

/** Which 3D path this browser can run, checked before the canvas mounts. */
export async function probeGpu(): Promise<RendererInfo> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<AdapterLike | null> } }).gpu;
    const adapter = gpu ? await gpu.requestAdapter() : null;
    if (adapter) {
      const i = adapter.info ?? {};
      const parts = [i.vendor, i.architecture, i.device, i.description].filter(Boolean);
      return { backend: "webgpu", renderer: parts.join(" | ") || "unknown adapter" };
    }
  } catch {
    // fall through to WebGL
  }
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (gl) {
      const renderer = webglRendererString(gl);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return { backend: "webgl2", renderer };
    }
  } catch {
    // fall through to the text page
  }
  return { backend: "none", renderer: "none" };
}
