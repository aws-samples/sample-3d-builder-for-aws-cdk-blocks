// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Box3, MathUtils, PerspectiveCamera, Vector3 } from "three";
import type { PieceId } from "../../cdk-blocks/shared";
import {
  BRICK,
  LIFT,
  LINK_PATH,
  offerSlots,
  PART_SHAPE,
  type PartId,
  PIECE_SLOT,
  PLATE,
  PLATE_CENTER_X,
  type Point,
  type Rect,
} from "../plate";

// Where the camera sits. No React and no renderer in this file, so the layout tests can run the same
// fit the page runs and check that nothing leaves the plate or the stage.

export const FOV = 30;
// A phone stage is narrow and tall, so the camera looks down more steeply there and the plate fills more of it.
// It also turns the plate further, which makes its picture taller without making it wider.
// The links lie flat on the plate, so the camera looks down more steeply than it did when the plate held bricks alone.
// Since the camera frames the bricks and not the whole plate (2026-11-19), the phone view turns the plate
// less and looks down less steeply: a brick then shows its top and its front face, wide across the stage.
export const VIEW = { desktop: { azimuth: -0.36, elevation: 0.78 }, phone: { azimuth: -0.3, elevation: 0.78 } };
export type View = (typeof VIEW)["desktop"];
const viewDir = ({ azimuth, elevation }: View) =>
  new Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));

export interface Shot {
  position: Vector3;
  target: Vector3;
  distance: number;
}

const FOCUS_LEAST = { w: 4.3, d: 3.3 };

/**
 * The box the camera frames: the footprints given, plus any points on the plate (the ends and corners
 * of link paths), from the plate's surface up to `top`, with `pad` of room around it. The page fits
 * the camera to the bricks that are on the plate and their links, not to the whole plate.
 */
function focusBox(rects: readonly Rect[], points: readonly Point[], top: number, pad = 0.4): Box3 {
  const box = new Box3();
  for (const r of rects) {
    box.expandByPoint(new Vector3(r.x0, 0, r.z0));
    box.expandByPoint(new Vector3(r.x1, top, r.z1));
  }
  for (const [x, z] of points) box.expandByPoint(new Vector3(x, 0, z));
  box.min.x -= pad;
  box.max.x += pad;
  box.min.z -= pad;
  box.max.z += pad;
  // One brick alone doesn't get a closer shot than this: it's large, with its links' first stretch in view.
  const grow = (lo: "x" | "z", least: number) => {
    const short = least - (box.max[lo] - box.min[lo]);
    if (short > 0) {
      box.min[lo] -= short / 2;
      box.max[lo] += short / 2;
    }
  };
  grow("x", FOCUS_LEAST.w);
  grow("z", FOCUS_LEAST.d);
  return box;
}

export const plateBox = (top: number) =>
  new Box3(new Vector3(PLATE_CENTER_X - PLATE.w / 2, -PLATE.h, -PLATE.d / 2), new Vector3(PLATE_CENTER_X + PLATE.w / 2, top, PLATE.d / 2));

/** Camera placement that fits a world-space box into a pixel rect of the canvas. */
export function fitShot(w: number, h: number, rect: { top: number; bottom: number }, box: Box3, view: View, sideMargin?: number): Shot {
  const dir = viewDir(view);
  const cam = new PerspectiveCamera(FOV, w / h, 0.1, 500);
  const center = box.getCenter(new Vector3());
  const corners: Vector3[] = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new Vector3(x, y, z));
  const v = new Vector3();
  const measure = (d: number) => {
    cam.position.copy(center).addScaledVector(dir, d);
    cam.lookAt(center);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const c of corners) {
      v.copy(c).project(cam);
      const px = ((v.x + 1) / 2) * w;
      const py = ((1 - v.y) / 2) * h;
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
    return { minX, maxX, minY, maxY };
  };
  const availW = w - (sideMargin ?? Math.max(24, w * 0.09));
  const availH = Math.max(60, rect.bottom - rect.top);
  let lo = 6;
  let hi = 160;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    const m = measure(mid);
    if (m.maxX - m.minX <= availW && m.maxY - m.minY <= availH) hi = mid;
    else lo = mid;
  }
  const m = measure(hi);
  const upp = (2 * hi * Math.tan(MathUtils.degToRad(FOV) / 2)) / h;
  const dx = w / 2 - (m.minX + m.maxX) / 2;
  const dy = (rect.top + rect.bottom) / 2 - (m.minY + m.maxY) / 2;
  const right = new Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
  const up = new Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
  const offset = right.multiplyScalar(-dx * upp).add(up.multiplyScalar(dy * upp));
  return { position: cam.position.clone().add(offset), target: center.clone().add(offset), distance: hi };
}

/** The stage's caption sits on its top edge and the naming switch and Recenter on its bottom edge. The bricks keep clear of both. */
export const STAGE_INSET = { phone: { top: 46, bottom: 54, side: 14 }, desktop: { top: 58, bottom: 56 } };

export interface StageState {
  /** The stage's size in CSS px. Under 620 px wide it's a phone. */
  w: number;
  h: number;
  /** Piece ids on the plate, the shared parts they bring, and the arrangement's edge ids. */
  on: readonly string[];
  parts: readonly string[];
  edges: readonly string[];
  /** Edge ids lit by a tap. */
  lit: readonly string[];
  /** The open piece while its tiles are fanned out, and the y where its tiles end (CSS px). */
  fanned: string | null;
  hudBottom: number;
}

/**
 * Where the camera sits for what's on the stage. The bricks are the subject, so the camera frames
 * them and not the plate:
 * - nothing on: the seven bricks side by side (offerSlots);
 * - bricks on: those bricks and the parts they share, plus whatever a tap has lit;
 * - a brick open: that brick, lifted with its lid up, and its own links, under its tiles.
 * The plate runs out of the picture where nothing sits on it. Pure, so the tests run the same fit.
 */
export function stageShot({ w, h, on, parts, edges, lit, fanned, hudBottom }: StageState): Shot {
  const phone = w < 620;
  const view = phone ? VIEW.phone : VIEW.desktop;
  const top = phone ? STAGE_INSET.phone.top : STAGE_INSET.desktop.top;
  const bottom = h - (phone ? STAGE_INSET.phone.bottom : STAGE_INSET.desktop.bottom);
  const side = phone ? STAGE_INSET.phone.side : Math.max(48, w * 0.08);
  const pathPoints = (ids: readonly string[]) => ids.flatMap((id) => LINK_PATH[id] ?? []);
  if (on.length === 0) return fitShot(w, h, { top, bottom }, focusBox(Object.values(offerSlots(phone ? 2 : 4)), [], 1.9, 0.7), view, side);
  if (!fanned) {
    const rects = [
      ...on.map((id) => PIECE_SLOT[id as PieceId]),
      ...parts.filter((id) => id in PART_SHAPE).map((id) => PART_SHAPE[id as PartId]),
    ].filter(Boolean);
    // 1.6 is a brick's studs plus most of its name tag.
    return fitShot(w, h, { top, bottom }, focusBox(rects, pathPoints(edges.filter((id) => lit.includes(id))), 1.6, 0.3), view, side);
  }
  const own = edges.filter((id) => lit.includes(id));
  return fitShot(
    w,
    h,
    { top: hudBottom + (phone ? 6 : 14), bottom },
    focusBox([PIECE_SLOT[fanned as PieceId]], pathPoints(own), LIFT + BRICK.body + 1.5, 0.5),
    view,
    side,
  );
}
