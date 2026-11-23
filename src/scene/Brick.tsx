// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { easings, useSpring } from "@react-spring/three";
import { Html } from "@react-three/drei";
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three/webgpu";
import { BRICK, CUSTOM_LAYER, STUD } from "../data";
import { LIFT } from "../plate";
import { RoundBox } from "./RoundBox";

export { LIFT };

interface Props {
  label: string;
  color: string;
  /** The lid and studs: the AWS category color of the Block's lead service. The body keeps `color`. */
  lidColor: string;
  slot: [number, number];
  on: boolean;
  open: boolean;
  reduced: boolean;
  showTag: boolean;
  onPress: () => void;
  /**
   * A custom Block: the brick below is its base Block (body and lid as usual), and a custom layer sits
   * on the lid in a neutral color, with a blank label plate. The plate's words are an HTML label. The
   * layer carries no AWS icon, because a custom Block isn't an AWS service.
   */
  custom?: { layerColor: string; plateColor: string; label: string } | null;
}

const STUD_SPOTS: [number, number][] = [-1, 0, 1].flatMap((i) => [-0.5, 0.5].map((j): [number, number] => [i * STUD, j * STUD]));
// The custom layer keeps the back row of studs. Its front row gives way to the label plate.
const BACK_STUDS = STUD_SPOTS.filter(([, z]) => z < 0);
const LAYER_INSET = 0.12;
const LAYER_TOP = BRICK.lid + CUSTOM_LAYER.gap + CUSTOM_LAYER.h;
const PLATE_SIZE = { w: BRICK.w - 0.46, h: 0.05, d: STUD * 0.78 };

export function Brick({ label, color, lidColor, slot, on, open, reduced, showTag, onPress, custom }: Props) {
  const outer = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const lid = useRef<THREE.Group>(null);
  const onRef = useRef(on);
  onRef.current = on;

  const dark = useMemo(() => `#${new THREE.Color(color).multiplyScalar(0.42).getHexString()}`, [color]);
  const spring = useSpring({
    drop: on ? 1 : 0,
    lift: on && open ? 1 : 0,
    immediate: reduced,
    config: (key: string) =>
      key === "drop"
        ? on
          ? { duration: 700, easing: easings.easeOutBounce }
          : { duration: 200, easing: easings.easeInCubic }
        : { tension: 190, friction: 17 },
  });

  // The brick's place on the plate. It slides when its place changes while it's on show (from the
  // side-by-side offer to its slot), and jumps when it isn't on show or motion is reduced.
  const slotRef = useRef(slot);
  slotRef.current = slot;
  const settled = useRef(false);
  const place = (dt: number) => {
    const o = outer.current;
    if (!o) return;
    const [x, z] = slotRef.current;
    if (!settled.current || reduced || !o.visible) {
      o.position.set(x, 0, z);
      settled.current = true;
    } else if (o.position.x !== x || o.position.z !== z) {
      const k = 1 - Math.exp(-dt / 0.09);
      o.position.x = Math.abs(x - o.position.x) < 0.002 ? x : o.position.x + (x - o.position.x) * k;
      o.position.z = Math.abs(z - o.position.z) < 0.002 ? z : o.position.z + (z - o.position.z) * k;
    }
  };

  const apply = () => {
    const d = spring.drop.get();
    const l = spring.lift.get();
    if (!outer.current || !inner.current || !lid.current) return;
    outer.current.visible = d > 0.002;
    inner.current.position.y = (onRef.current ? (1 - d) * 7 : (1 - d) * 1.2) + l * LIFT;
    inner.current.scale.setScalar(onRef.current ? 1 : Math.max(0.001, d));
    lid.current.rotation.x = -l * 1.95;
  };
  useFrame((_, dt) => {
    apply();
    place(Math.min(dt, 0.05));
  });
  useEffect(() => {
    apply();
    if (reduced) place(0);
  });

  const press = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 6) return; // an orbit drag ends in a click; ignore it
    onPress();
  };

  return (
    <group ref={outer} visible={false}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a three.js object, not a DOM element. The same action is on a button in the tray. */}
      <group
        ref={inner}
        onClick={press}
        onPointerOver={() => {
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
        }}
      >
        <RoundBox
          args={[BRICK.w, BRICK.body, BRICK.d]}
          radius={0.07}
          smoothness={4}
          position={[0, BRICK.body / 2, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color={color} roughness={0.32} metalness={0.02} />
        </RoundBox>
        <mesh position={[0, BRICK.body + 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[BRICK.w - 0.3, BRICK.d - 0.3]} />
          <meshStandardMaterial color={dark} roughness={0.8} />
        </mesh>
        <group ref={lid} position={[0, BRICK.body, -BRICK.d / 2]}>
          <RoundBox
            args={[BRICK.w, BRICK.lid, BRICK.d]}
            radius={0.07}
            smoothness={4}
            position={[0, BRICK.lid / 2 + 0.01, BRICK.d / 2]}
            castShadow
          >
            <meshStandardMaterial color={lidColor} roughness={0.32} metalness={0.02} />
          </RoundBox>
          {!custom &&
            STUD_SPOTS.map(([x, z]) => (
              <mesh key={`${x}:${z}`} position={[x, BRICK.lid + 0.09, BRICK.d / 2 + z]} castShadow>
                <cylinderGeometry args={[0.25, 0.25, 0.18, 32]} />
                <meshStandardMaterial color={lidColor} roughness={0.32} metalness={0.02} />
              </mesh>
            ))}
          {custom && (
            <>
              {/* The custom layer: a little smaller than the lid, so the base Block's lid shows as a band under it. */}
              <RoundBox
                args={[BRICK.w - LAYER_INSET, CUSTOM_LAYER.h, BRICK.d - LAYER_INSET]}
                radius={0.06}
                smoothness={4}
                position={[0, BRICK.lid + CUSTOM_LAYER.gap + CUSTOM_LAYER.h / 2, BRICK.d / 2]}
                castShadow
              >
                <meshStandardMaterial color={custom.layerColor} roughness={0.38} metalness={0.02} />
              </RoundBox>
              {BACK_STUDS.map(([x, z]) => (
                <mesh key={`${x}:${z}`} position={[x, LAYER_TOP + 0.08, BRICK.d / 2 + z]} castShadow>
                  <cylinderGeometry args={[0.25, 0.25, 0.16, 32]} />
                  <meshStandardMaterial color={custom.layerColor} roughness={0.38} metalness={0.02} />
                </mesh>
              ))}
              {/* The blank label plate. Plain geometry and a flat color: no texture and no icon. */}
              <RoundBox
                args={[PLATE_SIZE.w, PLATE_SIZE.h, PLATE_SIZE.d]}
                radius={0.02}
                smoothness={3}
                position={[0, LAYER_TOP + PLATE_SIZE.h / 2, BRICK.d / 2 + STUD / 2 - 0.02]}
              >
                <meshStandardMaterial color={custom.plateColor} roughness={0.6} metalness={0} />
              </RoundBox>
              {on && !open && showTag && (
                <Html
                  position={[0, LAYER_TOP + PLATE_SIZE.h + 0.01, BRICK.d / 2 + STUD / 2 - 0.02]}
                  center
                  zIndexRange={[3, 0]}
                  style={{ pointerEvents: "none" }}
                >
                  <span className="team-label" data-testid="team-label" aria-hidden="true">
                    {custom.label}
                  </span>
                </Html>
              )}
            </>
          )}
        </group>
        {on && showTag && (
          <Html
            position={
              open
                ? [0, -0.25, BRICK.d / 2 + 0.5]
                : custom
                  ? [0, BRICK.body + LAYER_TOP + 0.5, -BRICK.d / 2 + 0.1]
                  : [0, BRICK.body + BRICK.lid + 0.36, 0.45]
            }
            center
            zIndexRange={[4, 0]}
            style={{ pointerEvents: "none" }}
          >
            <span className={`brick-tag${open ? " is-open" : ""}`} aria-hidden="true">
              {label}
            </span>
          </Html>
        )}
      </group>
    </group>
  );
}
