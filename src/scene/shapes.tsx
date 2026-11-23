// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useThree } from "@react-three/fiber";
import { type ComponentType, Suspense, useMemo } from "react";
import * as THREE from "three/webgpu";
import type { NamingMode } from "../../cdk-blocks/shared";
import { ATLAS, iconFor } from "../icons";
import type { ReliefProps } from "../variants";
import { RoundBox } from "./RoundBox";

// Each resource is one thick rounded tile in its AWS category color with the official icon on its face.
// The icon is a texture cut from the build-time atlas: the whole SVG, uniformly scaled, nothing else.
// It's drawn with a basic material and no tone mapping, so the icon's own colors come out exact.
const TILE = { size: 1, depth: 0.26, radius: 0.08, face: 0.8, edge: 0.83 };
const FACE_WHITE = "#fbfaf6";
const EDGE_DARK = "#1d2336";

let atlas: THREE.Texture | null = null;

/** The one atlas texture: sRGB, mipmapped, anisotropic. Loaded once and shared by every tile. */
export function atlasTexture(maxAnisotropy: number): THREE.Texture {
  if (!atlas) {
    atlas = new THREE.TextureLoader().load(ATLAS.url, () => {
      window.__atlasReady = true;
    });
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.generateMipmaps = true;
    atlas.minFilter = THREE.LinearMipmapLinearFilter;
    atlas.magFilter = THREE.LinearFilter;
    atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
  }
  atlas.anisotropy = Math.max(1, Math.min(8, maxAnisotropy));
  return atlas;
}

function useAtlas(): THREE.Texture {
  const gl = useThree((s) => s.gl) as unknown as { getMaxAnisotropy?: () => number };
  return useMemo(() => atlasTexture(gl.getMaxAnisotropy?.() ?? 1), [gl]);
}

const faces = new Map<string, THREE.PlaneGeometry>();

/** A face plane whose UVs are the icon's own atlas cell: u left to right, v bottom to top, so the icon is upright and never mirrored. */
function faceGeometry(uv: [number, number, number, number]): THREE.PlaneGeometry {
  const key = uv.join(",");
  let geo = faces.get(key);
  if (!geo) {
    geo = new THREE.PlaneGeometry(TILE.face, TILE.face);
    const [u0, v0, u1, v1] = uv;
    // PlaneGeometry vertex order: top-left, top-right, bottom-left, bottom-right.
    geo.setAttribute("uv", new THREE.Float32BufferAttribute([u0, v1, u1, v1, u0, v0, u1, v0], 2));
    faces.set(key, geo);
  }
  return geo;
}

/**
 * One icon tile: the untouched icon as a flat texture. `Relief` comes from a look variant
 * (src/variants.ts) and is usually not set.
 */
export function IconTile({
  type,
  names = "exact",
  Relief,
}: {
  type: string;
  names?: NamingMode;
  Relief?: ComponentType<ReliefProps> | null;
}) {
  // A relief has shapes for the exact icons only, so it always draws those.
  const icon = iconFor(type, Relief ? "exact" : names);
  const map = useAtlas();
  const z = TILE.depth / 2;
  const color = icon?.color ?? "#232F3E";
  // A resource icon is a glyph on clear, and a category icon has a clear ring inside its frame: both sit on a white face.
  const plain = icon?.kind === "resource" || icon?.kind === "category";
  return (
    <group>
      <RoundBox args={[TILE.size, TILE.size, TILE.depth]} radius={TILE.radius} smoothness={4}>
        <meshStandardMaterial color={color} roughness={0.36} metalness={0.02} />
      </RoundBox>
      {/* A thin dark edge between the face and the side hides the seam. It sits outside the icon's box. */}
      <mesh position={[0, 0, z + 0.003]} renderOrder={1}>
        <planeGeometry args={[TILE.edge, TILE.edge]} />
        <meshBasicMaterial color={EDGE_DARK} toneMapped={false} />
      </mesh>
      {(plain || Relief) && (
        <mesh position={[0, 0, z + 0.006]} renderOrder={2}>
          <planeGeometry args={[TILE.face, TILE.face]} />
          <meshBasicMaterial color={plain ? FACE_WHITE : color} toneMapped={false} />
        </mesh>
      )}
      {icon && !Relief && (
        <mesh
          position={[0, 0, z + 0.009]}
          renderOrder={3}
          geometry={faceGeometry(icon.uv)}
          userData={{ iconFace: type, iconKey: icon.key }}
        >
          <meshBasicMaterial map={map} transparent toneMapped={false} />
        </mesh>
      )}
      {Relief && (
        <Suspense fallback={null}>
          <Relief type={type} z={z + 0.006} size={TILE.face} />
        </Suspense>
      )}
    </group>
  );
}
