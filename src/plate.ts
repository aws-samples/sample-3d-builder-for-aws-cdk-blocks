// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { PIECE_IDS, type PieceId } from "../cdk-blocks/shared";
import raw from "./data/page/connections.json";

// The master layout of the baseplate: one fixed slot for every piece, core socket and shared part,
// and one fixed path for every runtime connection in connections.json. An arrangement is a subset of
// it, so nothing moves when a piece is added. No randomness and no physics: layoutFor() is a pure
// function of the arrangement key. No three.js in this file, so the tests can import it.
//
// Plan coordinates are world units on the plate's top face: x runs left to right, z runs from the
// back of the plate to the front (toward the camera).

export const STUD = 0.8;
const PLATE_STUDS_X = 15;
const PLATE_STUDS_Z = 11;
export const PLATE = { w: PLATE_STUDS_X * STUD + 0.5, d: PLATE_STUDS_Z * STUD + 0.5, h: 0.5 };
/**
 * The plate grew two studs to the right to make room for the custom piece, and nothing that was on
 * it moved: its left edge and every stud stay where they were, so its center sits one stud right of x = 0.
 */
export const PLATE_CENTER_X = STUD;
export const BRICK = { w: 3 * STUD - 0.04, d: 2 * STUD - 0.04, body: 0.82, lid: 0.26 };
/** How far an open brick lifts off the plate. */
export const LIFT = 1.15;
/** The custom layer a custom Block carries on top of its base Block's lid: a thinner plate with a label plate on it. */
export const CUSTOM_LAYER = { h: 0.2, gap: 0.012 };

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
export type Point = [number, number];

// The layout is drawn around the three pieces that share resources, then moved so it sits centered
// and turned so the sharing pieces are nearest the camera. That way a link runs out in front of its
// piece or beside it, and a brick doesn't hide its own links.
const DX = 0.9;
const DZ = 1.15;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const zOf = (z: number) => r4(DZ - z);
const rect = (x0: number, x1: number, z0: number, z1: number): Rect => ({ x0: r4(x0 + DX), x1: r4(x1 + DX), z0: zOf(z1), z1: zOf(z0) });
const brickAt = (cx: number, cz: number): Rect => rect(cx - BRICK.w / 2, cx + BRICK.w / 2, cz - BRICK.d / 2, cz + BRICK.d / 2);
const pt = (x: number, z: number): Point => [r4(x + DX), zOf(z)];

/**
 * Where each piece sits. Agent and Realtime share resources, so they sit touching, with the shared
 * parts between them. Auth sits in front of the two, with a lane between for the Realtime Block's
 * link to the config file. KVStore, Database and the Hosting construct share nothing with another
 * piece, so they sit apart, each next to the core socket it plugs into.
 */
export const PIECE_SLOT: Record<PieceId, Rect> = {
  auth: brickAt(0, -2.28),
  agent: brickAt(-1.6, 0),
  realtime: brickAt(1.6, 0),
  hosting: brickAt(-4.42, 4.58),
  database: brickAt(-1.42, 4.58),
  kvstore: brickAt(1.58, 4.58),
  // The custom Block shares nothing with another piece either. It sits in the back row, next to the
  // corner of the shared role's rail, the only socket it plugs into.
  housebucket: brickAt(4.24, 4.58),
};

/**
 * Where the pieces sit while nothing is snapped on: all seven side by side in rows of `cols`, close
 * together, so an empty stage shows the bricks themselves and not an empty plate. The custom Block
 * comes last, like in the tray. A short last row is centered. Centered on the plate's center.
 */
export function offerSlots(cols: number): Record<PieceId, Rect> {
  const stepX = BRICK.w + 0.55;
  // Two columns is the phone's offer: the rows stand a little further apart there, so a brick hides less of the one behind it.
  const stepZ = BRICK.d + (cols <= 2 ? 1.3 : 1.0);
  const rows = Math.ceil(PIECE_IDS.length / cols);
  const out = {} as Record<PieceId, Rect>;
  PIECE_IDS.forEach((id, i) => {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? PIECE_IDS.length - row * cols : cols;
    const cx = PLATE_CENTER_X + (i - row * cols - (inRow - 1) / 2) * stepX;
    const cz = (row - (rows - 1) / 2) * stepZ;
    out[id] = { x0: r4(cx - BRICK.w / 2), x1: r4(cx + BRICK.w / 2), z0: r4(cz - BRICK.d / 2), z1: r4(cz + BRICK.d / 2) };
  });
  return out;
}

export type SocketId = "core:role" | "core:config" | "core:handler" | "core:api";
export type PartId = "shared:index-setup" | "shared:websocket";

/** The app core, built into the plate. A socket can be more than one box: the shared role is an L-shaped rail. */
export const SOCKET_SHAPE: Record<SocketId, Rect[]> = {
  "core:role": [rect(-2.3, 3.8, 2.65, 3.2), rect(3.25, 3.8, -3.06, 2.65)],
  "core:config": [rect(-4.05, -3.5, -3.06, 2.0)],
  "core:handler": [rect(2.05, 3.05, 1.45, 2.2)],
  "core:api": [rect(-5.6, -4.5, 2.3, 3.05)],
};

/** The parts that two pieces share, each drawn once, touching every piece that brings it. */
export const PART_SHAPE: Record<PartId, Rect> = {
  "shared:index-setup": rect(-0.42, 0.42, -0.78, 0),
  "shared:websocket": rect(-0.42, 0.42, 0, 0.78),
};

/** Where a node's label chip is pinned: its icon sits on this point of the node. Plan coordinates. */
export const LABEL_ANCHOR: Record<SocketId | PartId, Point> = {
  "core:role": pt(3.4, -2.1),
  "core:config": pt(-3.78, -2.2),
  "core:handler": pt(2.9, 2.05),
  "core:api": pt(-5.05, 2.67),
  "shared:index-setup": pt(0, -0.39),
  "shared:websocket": pt(0.26, 0.42),
};
/** Which side of its icon a chip's name sits on, so the name runs off the plate and not over the links. */
export const LABEL_SIDE: Record<SocketId, "left" | "right"> = {
  "core:role": "right",
  "core:config": "left",
  "core:handler": "right",
  "core:api": "left",
};

/**
 * One fixed path for each runtime connection, by edge id, from the piece or shared part to the core
 * socket. Every segment runs along x or along z. A path touches a footprint only at its two ends.
 * The one place two paths cross is in front of the Agent: the config file's link to the shared
 * WebSockets API crosses the Agent's four links to the shared role at right angles. The pieces that
 * share resources have to touch, and with that no flat layout avoids every crossing.
 */
export const LINK_PATH: Record<string, Point[]> = {
  "agent>core:role:runs-as": [pt(-2.15, 0.78), pt(-2.15, 2.65)],
  "core:role>agent:can-invoke": [pt(-1.75, 0.78), pt(-1.75, 2.65)],
  "core:role>agent:can-read-and-write": [pt(-1.35, 0.78), pt(-1.35, 2.65)],
  "core:role>agent:can-read-the-secret-kept-by": [pt(-0.95, 0.78), pt(-0.95, 2.65)],
  "agent>core:config:is-told-where-to-find": [pt(-2.78, -0.3), pt(-3.5, -0.3)],
  "core:config>agent:tells-the-app-s-code-where-to-find": [pt(-2.78, 0.3), pt(-3.5, 0.3)],
  "core:role>auth:can-read-and-write": [pt(1.18, -1.8), pt(3.25, -1.8)],
  "core:role>auth:can-read-the-secret-kept-by": [pt(1.18, -2.28), pt(3.25, -2.28)],
  "core:role>auth:can-sign-users-up-and-in-through": [pt(1.18, -2.76), pt(3.25, -2.76)],
  "core:config>auth:tells-the-app-s-code-where-to-find": [pt(-1.18, -2.28), pt(-3.5, -2.28)],
  "core:role>realtime:can-read-and-write": [pt(2.78, 0.3), pt(3.25, 0.3)],
  "core:role>realtime:can-read-the-secret-kept-by": [pt(2.78, -0.3), pt(3.25, -0.3)],
  // Runs in the lane between Auth and the Agent. Only an arrangement with Realtime and no Agent has it.
  "core:config>realtime:tells-the-app-s-code-where-to-find": [pt(1.6, -0.78), pt(1.6, -1.14), pt(-3.5, -1.14)],
  "core:role>shared:websocket:can-push-messages-through": [pt(0, 0.78), pt(0, 2.65)],
  "shared:websocket>core:handler:invokes": [pt(0.28, 0.78), pt(0.28, 1.82), pt(2.05, 1.82)],
  "core:config>shared:websocket:tells-the-app-s-code-where-to-find": [pt(-0.28, 0.78), pt(-0.28, 1.3), pt(-3.5, 1.3)],
  "core:role>kvstore:can-read-and-write": [pt(1.58, 3.8), pt(1.58, 3.2)],
  "core:role>database:can-run-sql-on": [pt(-0.85, 3.8), pt(-0.85, 3.2)],
  "core:config>database:tells-the-app-s-code-where-to-find": [pt(-2.45, 3.8), pt(-2.45, 3.5), pt(-3.65, 3.5), pt(-3.65, 2.0)],
  "core:config>hosting:tells-the-app-s-code-where-to-find": [pt(-3.9, 3.8), pt(-3.9, 2.0)],
  "hosting>core:api:sends-requests-to": [pt(-5.0, 3.8), pt(-5.0, 3.05)],
  "core:role>housebucket:can-read-and-write": [pt(3.3, 3.8), pt(3.3, 3.2)],
  "core:role>housebucket:can-encrypt-and-decrypt-with": [pt(3.65, 3.8), pt(3.65, 3.2)],
};

export const LINK_WIDTH = 0.13;
export const PLUG_RADIUS = 0.12;

interface DataCombo {
  edgeIds: string[];
  nodes: string[];
}
const combos = (raw as unknown as { combos: Record<string, DataCombo> }).combos;

interface PlacedLink {
  /** The edge id in connections.json. A link with no edge id is never drawn. */
  edgeId: string;
  path: Point[];
}
export interface PlateLayout {
  key: string;
  pieces: { id: PieceId; rect: Rect }[];
  sockets: { id: SocketId; rects: Rect[] }[];
  parts: { id: PartId; rect: Rect }[];
  links: PlacedLink[];
}

const isPart = (id: string): id is PartId => id in PART_SHAPE;

/** The arrangement key for a set of piece ids: the ids in the fixed order, joined with "+". */
export const keyOf = (on: readonly string[]) => PIECE_IDS.filter((id) => on.includes(id)).join("+");

/**
 * Everything drawn for one arrangement. The core sockets are always there (every app starts with
 * them). Pieces, shared parts and links come from the arrangement's entry in connections.json:
 * one link per edge id, and nothing that isn't in the data. An arrangement with the custom piece has
 * one entry per standards key; `edgeIds` is that key's list (from src/custom.ts), and without it the
 * all-on entry is drawn.
 */
export function layoutFor(key: string, edgeIds?: readonly string[]): PlateLayout {
  const sockets = (Object.keys(SOCKET_SHAPE) as SocketId[]).map((id) => ({ id, rects: SOCKET_SHAPE[id] }));
  if (key === "") return { key, pieces: [], sockets, parts: [], links: [] };
  const combo = combos[key];
  if (!combo) throw new Error(`No connection data for arrangement ${key}`);
  const ids = key.split("+") as PieceId[];
  return {
    key,
    pieces: ids.map((id) => ({ id, rect: PIECE_SLOT[id] })),
    sockets,
    parts: combo.nodes.filter(isPart).map((id) => ({ id, rect: PART_SHAPE[id] })),
    links: (edgeIds ?? combo.edgeIds).map((edgeId) => {
      const path = LINK_PATH[edgeId];
      if (!path) throw new Error(`No path in the master layout for connection ${edgeId}`);
      return { edgeId, path };
    }),
  };
}

export const centerOf = (r: Rect): Point => [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2];

/** Stud positions on the plate that sit clear of every slot, socket, part and link path in the master layout. */
export function freeStuds(clearance = 0.36): Point[] {
  const boxes: Rect[] = [...Object.values(PIECE_SLOT), ...Object.values(SOCKET_SHAPE).flat(), ...Object.values(PART_SHAPE)];
  const segments = Object.values(LINK_PATH).flatMap((p) => p.slice(1).map((b, i): [Point, Point] => [p[i], b]));
  const out: Point[] = [];
  for (let i = 0; i < PLATE_STUDS_X; i++)
    for (let j = 0; j < PLATE_STUDS_Z; j++) {
      const x = (i - (PLATE_STUDS_X - 1) / 2) * STUD + PLATE_CENTER_X;
      const z = (j - (PLATE_STUDS_Z - 1) / 2) * STUD;
      const inBox = boxes.some((b) => x > b.x0 - clearance && x < b.x1 + clearance && z > b.z0 - clearance && z < b.z1 + clearance);
      const onLink = segments.some(
        ([a, b]) =>
          x > Math.min(a[0], b[0]) - clearance &&
          x < Math.max(a[0], b[0]) + clearance &&
          z > Math.min(a[1], b[1]) - clearance &&
          z < Math.max(a[1], b[1]) + clearance,
      );
      if (!inBox && !onLink) out.push([x, z]);
    }
  return out;
}
