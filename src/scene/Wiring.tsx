// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Html } from "@react-three/drei";
import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three/webgpu";
import type { NamingMode } from "../../cdk-blocks/shared";
import { LEAD_TYPE } from "../connections";
import { IconSprite, iconFor } from "../icons";
import { nodeLabel } from "../naming";
import {
  LABEL_ANCHOR,
  LABEL_SIDE,
  LINK_PATH,
  LINK_WIDTH,
  PART_SHAPE,
  type PartId,
  PLUG_RADIUS,
  type Point,
  type Rect,
  SOCKET_SHAPE,
  type SocketId,
} from "../plate";
import { RoundBox } from "./RoundBox";

// The connections, drawn on the plate. The app core is a set of sockets built into the plate. A part
// that pieces share is one low connector piece between them. Each runtime connection in the
// arrangement's data is one flat lit trace in a channel, with a stud-shaped plug at each end.
// Plain basic materials only, so the traces look the same on WebGPU and on the WebGL 2 fallback.

const TRACE = { idle: "#ffe9a8", lit: "#fffdf2", dim: "#8492b5", channel: "#141a2c" };
const SOCKET_H = 0.24;
// A shared part stands nearly as tall as a brick, so the bricks around it don't hide it.
const PART_H = 0.86;
const DRAW_SECONDS = 0.45;

const press = (run: () => void) => (e: ThreeEvent<MouseEvent>) => {
  e.stopPropagation();
  if (e.delta > 6) return; // an orbit drag ends in a click; ignore it
  run();
};
const hover = {
  onPointerOver: () => {
    document.body.style.cursor = "pointer";
  },
  onPointerOut: () => {
    document.body.style.cursor = "";
  },
};

const colorOfNode = (id: string) => iconFor(LEAD_TYPE[id] ?? "", "exact")?.color ?? "#232F3E";

function Box({ r, h, color, inset, onPress }: { r: Rect; h: number; color: string; inset: string; onPress: () => void }) {
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a three.js object, not a DOM element. The same action is on a button in the connections list.
    <group position={[(r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2]} onClick={press(onPress)} {...hover}>
      <RoundBox args={[w, h, d]} radius={0.05} smoothness={3} position={[0, h / 2, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.02} />
      </RoundBox>
      <mesh position={[0, h + 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[Math.max(0.05, w - 0.16), Math.max(0.05, d - 0.16)]} />
        <meshStandardMaterial color={inset} roughness={0.85} />
      </mesh>
    </group>
  );
}

/** The app core: four sockets built into the plate. They're always there, because every app starts with them. */
export function CoreSockets({ onFocus }: { onFocus: (id: string) => void }) {
  return (
    <>
      {(Object.keys(SOCKET_SHAPE) as SocketId[]).map((id) =>
        SOCKET_SHAPE[id].map((r, i) => (
          <Box key={`${id}:${i}`} r={r} h={SOCKET_H} color={colorOfNode(id)} inset="#1d2336" onPress={() => onFocus(id)} />
        )),
      )}
    </>
  );
}

/** The parts pieces share: one connector piece each, drawn once, in the gap between the pieces that bring it. */
export function SharedParts({ present, onFocus }: { present: readonly string[]; onFocus: (id: string) => void }) {
  return (
    <>
      {(Object.keys(PART_SHAPE) as PartId[])
        .filter((id) => present.includes(id))
        .map((id) => (
          <Box key={id} r={PART_SHAPE[id]} h={PART_H} color="#fdf9f0" inset={colorOfNode(id)} onPress={() => onFocus(id)} />
        ))}
    </>
  );
}

interface Segment {
  from: Point;
  along: "x" | "z";
  sign: number;
  length: number;
  start: number;
}

function segmentsOf(path: Point[]): { segments: Segment[]; total: number } {
  const segments: Segment[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1];
    const [bx, bz] = path[i];
    const along = Math.abs(bx - ax) > Math.abs(bz - az) ? "x" : "z";
    const delta = along === "x" ? bx - ax : bz - az;
    segments.push({ from: path[i - 1], along, sign: Math.sign(delta), length: Math.abs(delta), start: total });
    total += Math.abs(delta);
  }
  return { segments, total };
}

const LINK_IDS = Object.keys(LINK_PATH);
const LINKS = LINK_IDS.map((id) => ({ id, path: LINK_PATH[id], ...segmentsOf(LINK_PATH[id]) }));

declare global {
  interface Window {
    /** For browser checks: how far each link in the master layout is drawn, 0 to 1, by edge id. */
    __links?: { progress: Record<string, number> };
  }
}

interface LinksProps {
  /** Edge ids of the arrangement on the plate, from connections.json. Only these are drawn. */
  present: readonly string[];
  /** Edge ids lit by what the visitor tapped. Empty means nothing is tapped and every link is at rest. */
  lit: readonly string[];
  reduced: boolean;
  onFocus: (edgeId: string) => void;
}

/**
 * One trace per connection in the arrangement's data. A link draws from its piece to its socket when
 * its edge enters the arrangement and retracts when it leaves. With reduced motion it appears and
 * disappears with no animation.
 */
export function Links({ present, lit, reduced, onFocus }: LinksProps) {
  const invalidate = useThree((s) => s.invalidate);
  const progress = useRef<Record<string, number>>(Object.fromEntries(LINK_IDS.map((id) => [id, 0])));
  const groups = useRef<Record<string, THREE.Group | null>>({});
  const materials = useMemo(
    () => ({
      idle: new THREE.MeshBasicMaterial({ color: TRACE.idle, toneMapped: false }),
      lit: new THREE.MeshBasicMaterial({ color: TRACE.lit, toneMapped: false }),
      dim: new THREE.MeshBasicMaterial({ color: TRACE.dim, toneMapped: false }),
    }),
    [],
  );
  useEffect(
    () => () => {
      for (const material of Object.values(materials)) material.dispose();
    },
    [materials],
  );
  const presentRef = useRef(present);
  presentRef.current = present;

  const apply = () => {
    for (const link of LINKS) {
      const g = groups.current[link.id];
      if (!g) continue;
      const p = progress.current[link.id];
      g.visible = p > 0.001;
      const drawn = p * link.total;
      link.segments.forEach((s, i) => {
        const part = g.children[i];
        const k = Math.min(1, Math.max(0, (drawn - s.start) / s.length));
        part.visible = k > 0.001;
        if (s.along === "x") part.scale.x = Math.max(0.0001, k);
        else part.scale.z = Math.max(0.0001, k);
      });
      // The plug at the socket end shows once the trace has reached it.
      g.children[link.segments.length + 1].visible = p > 0.98;
    }
  };

  useEffect(() => {
    window.__links = { progress: progress.current };
    return () => {
      window.__links = undefined;
    };
  }, []);

  useEffect(() => {
    if (reduced) {
      for (const id of LINK_IDS) progress.current[id] = present.includes(id) ? 1 : 0;
      apply();
    }
    invalidate();
  });

  useFrame((_, dt) => {
    if (reduced) return;
    const step = Math.min(dt, 0.05) / DRAW_SECONDS;
    let moved = false;
    for (const id of LINK_IDS) {
      const target = presentRef.current.includes(id) ? 1 : 0;
      const p = progress.current[id];
      if (p === target) continue;
      progress.current[id] = target > p ? Math.min(1, p + step) : Math.max(0, p - step * 1.6);
      moved = true;
    }
    if (moved) apply();
  });

  const anyLit = lit.length > 0;
  return (
    <group>
      {LINKS.map((link) => {
        const isLit = lit.includes(link.id);
        const material = !anyLit ? materials.idle : isLit ? materials.lit : materials.dim;
        const wide = isLit ? 1.55 : 1;
        const y = isLit ? 0.05 : 0.03;
        const end = link.path[link.path.length - 1];
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: a three.js object, not a DOM element. The same action is on a button in the connections list.
          <group
            key={link.id}
            ref={(el) => {
              groups.current[link.id] = el;
            }}
            visible={false}
            userData={{ edgeId: link.id }}
            onClick={press(() => onFocus(link.id))}
            {...hover}
          >
            {link.segments.map((s, i) => {
              // A segment grows from its start point: the group sits there and the boxes are offset by half their length.
              const half = (s.length / 2) * s.sign;
              const size = (w: number): [number, number, number] => (s.along === "x" ? [s.length + w, 0.03, w] : [w, 0.03, s.length + w]);
              const offset: [number, number, number] = s.along === "x" ? [half, 0, 0] : [0, 0, half];
              return (
                <group key={i} position={[s.from[0], 0, s.from[1]]}>
                  <mesh position={[offset[0], 0.006, offset[2]]}>
                    <boxGeometry args={size(LINK_WIDTH + 0.12)} />
                    <meshBasicMaterial color={TRACE.channel} toneMapped={false} />
                  </mesh>
                  <mesh position={[offset[0], y, offset[2]]} material={material}>
                    <boxGeometry args={size(LINK_WIDTH * wide)} />
                  </mesh>
                  {/* A wider, unseen box so a finger can hit a thin trace. */}
                  <mesh position={[offset[0], 0.05, offset[2]]}>
                    <boxGeometry args={size(0.5)} />
                    <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                  </mesh>
                </group>
              );
            })}
            {[link.path[0], end].map(([x, z], i) => (
              <mesh key={i} position={[x, 0.06, z]} material={material}>
                <cylinderGeometry args={[PLUG_RADIUS * (isLit ? 1.25 : 1), PLUG_RADIUS * (isLit ? 1.25 : 1), 0.1, 20]} />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}

interface ChipsProps {
  /** Shared parts on the plate. The core sockets always have their chip. */
  parts: readonly string[];
  names: NamingMode;
  focus: string | null;
  /** True when a piece is open and its icon tiles are fanned out: the chips step back so the tiles read. */
  quiet: boolean;
}

/**
 * The label of each core socket and shared part: its official AWS icon and its name, as HTML pinned to
 * the node. HTML keeps the text sharp, and keeps the icon whole, upright and unrotated however the
 * plate is turned. In Generic naming mode the icon is the category icon where the service's own icon
 * would name the service, and the name is the generic one.
 */
export function NodeChips({ parts, names, focus, quiet }: ChipsProps) {
  const ids = [...(Object.keys(SOCKET_SHAPE) as SocketId[]), ...(Object.keys(PART_SHAPE) as PartId[]).filter((id) => parts.includes(id))];
  const { camera, size } = useThree();
  const spans = useRef<Record<string, HTMLSpanElement | null>>({});
  const widths = useRef<Record<string, number>>({});
  const v = useMemo(() => new THREE.Vector3(), []);
  // The camera frames the bricks, so a socket can be outside the picture or half across its edge.
  // A chip shows only while all of it is on the stage, clear of the caption and the controls.
  useFrame(() => {
    for (const id of ids) {
      const el = spans.current[id];
      if (!el) continue;
      const [x, z] = LABEL_ANCHOR[id];
      v.set(x, id.startsWith("core:") ? SOCKET_H : PART_H, z).project(camera);
      const px = ((v.x + 1) / 2) * size.width;
      const py = ((1 - v.y) / 2) * size.height;
      if (el.offsetWidth > 0) widths.current[id] = el.offsetWidth;
      const w = widths.current[id] ?? 30;
      // On a desktop a core chip's name runs outward from its icon; on a phone a chip is its icon, centered.
      const wide = window.innerWidth >= 1100 && id.startsWith("core:");
      const side = wide ? LABEL_SIDE[id as SocketId] : null;
      const left = side === "right" ? px - 16 : side === "left" ? px + 16 - w : px - w / 2;
      const off = left < 4 || left + w > size.width - 4 || py < 60 || py > size.height - 64;
      if (off !== (el.dataset.off === "")) {
        if (off) el.dataset.off = "";
        else delete el.dataset.off;
      }
    }
  });
  return (
    <>
      {ids.map((id) => {
        const [x, z] = LABEL_ANCHOR[id];
        const core = id.startsWith("core:");
        return (
          <Html key={id} position={[x, (core ? SOCKET_H : PART_H) + 0.05, z]} center zIndexRange={[3, 0]} style={{ pointerEvents: "none" }}>
            <span
              className={`node-chip${core ? ` is-core is-${LABEL_SIDE[id as SocketId]}` : " is-shared"}${focus === id ? " is-focus" : ""}${quiet ? " is-quiet" : ""}`}
              data-chip={id}
              aria-hidden="true"
              ref={(el) => {
                spans.current[id] = el;
              }}
            >
              <IconSprite type={LEAD_TYPE[id]} size={22} mode={names} />
              <span className="node-chip-text">{nodeLabel(id, names)}</span>
            </span>
          </Html>
        );
      })}
    </>
  );
}
