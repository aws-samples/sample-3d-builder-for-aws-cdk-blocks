// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useSprings } from "@react-spring/three";
import { useFrame, useThree } from "@react-three/fiber";
import { type ComponentType, useEffect, useMemo, useRef } from "react";
import * as THREE from "three/webgpu";
import type { NamingMode } from "../../cdk-blocks/shared";
import type { HudLayout } from "../layout";
import type { Resource } from "../types";
import type { ReliefProps } from "../variants";
import { IconTile } from "./shapes";

const DEPTH = 6;
// A fixed tilt so the tile's thickness shows: the face leans back 0.3 rad and turns a little to the side.
// The order is yaw then pitch with no roll ("YXZ", z = 0), which keeps the icon's horizontal axis
// horizontal on screen. Nothing spins: an icon is never rotated in its plane, mirrored or turned away.
const TILT = { pitch: -0.3, yaw: 0.22 };

interface Props {
  resources: Resource[];
  origin: THREE.Vector3;
  layout: HudLayout;
  show: boolean;
  Relief?: ComponentType<ReliefProps> | null;
  names: NamingMode;
}

/** The open brick's resources as icon tiles, flown from the brick to fixed screen slots in front of the camera. */
export function Pieces({ resources, origin, layout, show, Relief, names }: Props) {
  const root = useRef<THREE.Group>(null);
  const refs = useRef<(THREE.Group | null)[]>([]);
  const { camera, size } = useThree();
  const [springs] = useSprings(
    resources.length,
    (i) => ({
      from: { t: 0 },
      to: { t: show ? 1 : 0 },
      delay: show ? 100 + i * 90 : 0,
      config: show ? { tension: 190, friction: 17 } : { tension: 260, friction: 26 },
    }),
    [show, resources.length],
  );
  const tmp = useMemo(() => ({ from: new THREE.Vector3(), to: new THREE.Vector3() }), []);

  // For a browser check that no tile rotates: the tile groups and the types they carry.
  useEffect(() => {
    const handle = { groups: refs.current, types: resources.map((r) => r.type) };
    window.__tiles = handle;
    return () => {
      if (window.__tiles === handle) window.__tiles = undefined;
    };
  }, [resources]);

  useFrame(({ clock }) => {
    if (!root.current) return;
    const cam = camera as THREE.PerspectiveCamera;
    cam.updateMatrixWorld();
    root.current.position.copy(cam.position);
    root.current.quaternion.copy(cam.quaternion);
    const upp = (2 * DEPTH * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / size.height;
    tmp.from.copy(origin);
    cam.worldToLocal(tmp.from);
    resources.forEach((_r, i) => {
      const g = refs.current[i];
      const slot = layout.items[i];
      if (!g || !slot) return;
      const t = springs[i].t.get();
      const k = Math.min(1, Math.max(0, t));
      tmp.to.set((slot.cx - size.width / 2) * upp, (size.height / 2 - slot.cy) * upp, -DEPTH);
      g.position.lerpVectors(tmp.from, tmp.to, k);
      // A slight bob, a couple of pixels up and down. Position only: the tilt never changes.
      g.position.y += Math.sin(clock.elapsedTime * 1.5 + i * 1.1) * 2.2 * upp * k;
      g.scale.setScalar(Math.max(0.0001, t) * layout.piece * upp * 0.98);
      g.visible = t > 0.01;
    });
  });

  return (
    <group ref={root}>
      {resources.map((r, i) => (
        <group
          key={`${r.type}:${i}`}
          ref={(el) => {
            refs.current[i] = el;
          }}
          rotation={[TILT.pitch, TILT.yaw, 0, "YXZ"]}
          visible={false}
        >
          <IconTile type={r.type} names={names} Relief={Relief} />
        </group>
      ))}
    </group>
  );
}
