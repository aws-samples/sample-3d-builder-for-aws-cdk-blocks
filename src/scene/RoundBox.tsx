// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { ThreeElements } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

type Props = Omit<ThreeElements["mesh"], "args" | "geometry"> & {
  args: [number, number, number];
  radius: number;
  smoothness?: number;
};

/**
 * A box with rounded edges, built from three's RoundedBoxGeometry (a plain box geometry with its
 * corners pulled in). It replaces drei's RoundedBox, which builds its shape with three's
 * extrude geometry: the production bundle carries no extrusion code at all (vite.config.ts strips that
 * class), so this page doesn't use that component.
 */
export function RoundBox({ args: [w, h, d], radius, smoothness = 4, children, ...mesh }: Props) {
  const geometry = useMemo(() => new RoundedBoxGeometry(w, h, d, smoothness, radius), [w, h, d, smoothness, radius]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} {...mesh}>
      {children}
    </mesh>
  );
}
